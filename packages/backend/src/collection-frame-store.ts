import * as zlib from "zlib";
import {
  nowISO,
  generateUUID,
  msToNanoseconds,
} from "@traceway/core";
import { TypedRing } from "./typed-ring.js";
import type {
  CollectionFrame,
  ExceptionStackTrace,
  MetricRecord,
  Trace,
  Span,
  ReportRequest,
} from "@traceway/core";
import { collectMetrics } from "./metrics.js";

export interface CollectionFrameStoreOptions {
  apiUrl: string;
  token: string;
  debug: boolean;
  maxCollectionFrames: number;
  collectionInterval: number;
  uploadThrottle: number;
  metricsInterval: number;
  version: string;
  serverName: string;
  sampleRate: number;
  errorSampleRate: number;
}

export class CollectionFrameStore {
  private current: CollectionFrame | null = null;
  private currentSetAt: number = Date.now();
  private sendQueue: TypedRing<CollectionFrame>;
  private lastUploadStarted: number | null = null;

  private collectionTimer: ReturnType<typeof setInterval> | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;

  private readonly apiUrl: string;
  private readonly token: string;
  private readonly debug: boolean;
  private readonly collectionInterval: number;
  private readonly uploadThrottle: number;
  private readonly metricsInterval: number;
  private readonly version: string;
  private readonly serverName: string;

  readonly sampleRate: number;
  readonly errorSampleRate: number;

  constructor(options: CollectionFrameStoreOptions) {
    this.apiUrl = options.apiUrl;
    this.token = options.token;
    this.debug = options.debug;
    this.collectionInterval = options.collectionInterval;
    this.uploadThrottle = options.uploadThrottle;
    this.metricsInterval = options.metricsInterval;
    this.version = options.version;
    this.serverName = options.serverName;
    this.sampleRate = options.sampleRate;
    this.errorSampleRate = options.errorSampleRate;
    this.sendQueue = new TypedRing<CollectionFrame>(
      options.maxCollectionFrames,
    );

    this.collectionTimer = setInterval(() => {
      this.tick();
    }, this.collectionInterval);
    if (this.collectionTimer && typeof this.collectionTimer.unref === "function") {
      this.collectionTimer.unref();
    }

    this.metricsTimer = setInterval(() => {
      this.collectSystemMetrics();
    }, this.metricsInterval);
    if (this.metricsTimer && typeof this.metricsTimer.unref === "function") {
      this.metricsTimer.unref();
    }
  }

  private tick(): void {
    if (this.current !== null) {
      if (this.currentSetAt < Date.now() - this.collectionInterval) {
        this.rotateCurrentCollectionFrame();
        this.processSendQueue();
      }
    } else if (this.sendQueue.length > 0) {
      this.processSendQueue();
    }
  }

  private ensureCurrent(): CollectionFrame {
    if (this.current === null) {
      this.current = { stackTraces: [], metrics: [], traces: [] };
      this.currentSetAt = Date.now();
    }
    return this.current;
  }

  addException(exception: ExceptionStackTrace): void {
    this.ensureCurrent().stackTraces.push(exception);
  }

  addMetric(metric: MetricRecord): void {
    this.ensureCurrent().metrics.push(metric);
  }

  addTrace(trace: Trace): void {
    this.ensureCurrent().traces.push(trace);
  }

  private rotateCurrentCollectionFrame(): void {
    if (this.current !== null) {
      this.sendQueue.push(this.current);
      this.current = null;
    }
  }

  private processSendQueue(): void {
    if (
      this.lastUploadStarted === null ||
      this.lastUploadStarted < Date.now() - this.uploadThrottle
    ) {
      this.lastUploadStarted = Date.now();
      const frames = this.sendQueue.readAll();
      if (frames.length > 0) {
        this.triggerUpload(frames);
      }
    }
  }

  private triggerUpload(framesToSend: CollectionFrame[]): void {
    const payload: ReportRequest = {
      collectionFrames: framesToSend,
      appVersion: this.version,
      serverName: this.serverName,
    };

    let jsonData: string;
    try {
      jsonData = JSON.stringify(payload);
    } catch (err) {
      if (this.debug) {
        console.error("Traceway: failed to serialize frames:", err);
      }
      return;
    }

    let gzipped: Uint8Array;
    try {
      gzipped = new Uint8Array(zlib.gzipSync(Buffer.from(jsonData)));
    } catch (err) {
      if (this.debug) {
        console.error("Traceway: failed to gzip:", err);
      }
      return;
    }

    fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        Authorization: `Bearer ${this.token}`,
      },
      body: gzipped as unknown as BodyInit,
    })
      .then((resp) => {
        if (resp.status === 200) {
          this.sendQueue.remove(framesToSend);
        } else if (this.debug) {
          console.error(`Traceway: upload returned status ${resp.status}`);
        }
      })
      .catch((err) => {
        if (this.debug) {
          console.error("Traceway: upload failed:", err);
        }
      });
  }

  private collectSystemMetrics(): void {
    try {
      const metrics = collectMetrics();
      for (const metric of metrics) {
        this.addMetric(metric);
      }
    } catch (err) {
      if (this.debug) {
        console.error("Traceway: failed to collect metrics:", err);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.collectionTimer !== null) {
      clearInterval(this.collectionTimer);
      this.collectionTimer = null;
    }
    if (this.metricsTimer !== null) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    this.rotateCurrentCollectionFrame();

    const frames = this.sendQueue.readAll();
    if (frames.length === 0) return;

    const payload: ReportRequest = {
      collectionFrames: frames,
      appVersion: this.version,
      serverName: this.serverName,
    };

    try {
      const jsonData = JSON.stringify(payload);
      const gzipped = new Uint8Array(zlib.gzipSync(Buffer.from(jsonData)));

      const resp = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          Authorization: `Bearer ${this.token}`,
        },
        body: gzipped as unknown as BodyInit,
      });

      if (resp.status === 200) {
        this.sendQueue.remove(frames);
      }
    } catch (err) {
      if (this.debug) {
        console.error("Traceway: shutdown upload failed:", err);
      }
    }
  }
}
