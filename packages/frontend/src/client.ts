import type {
  ExceptionStackTrace,
  ReportRequest,
  CollectionFrame,
  SessionRecordingPayload,
} from "@tracewayapp/core";
import { parseConnectionString, generateUUID } from "@tracewayapp/core";
import { sendReport } from "./transport.js";
import { SessionRecorder } from "./session-recorder.js";

export interface TracewayFrontendOptions {
  debug?: boolean;
  debounceMs?: number;
  retryDelayMs?: number;
  version?: string;
  sessionRecording?: boolean;
  sessionRecordingSegmentDuration?: number;
}

export class TracewayFrontendClient {
  private apiUrl: string;
  private token: string;
  private debug: boolean;
  private debounceMs: number;
  private retryDelayMs: number;
  private version: string;

  private pendingExceptions: ExceptionStackTrace[] = [];
  private pendingRecordings: SessionRecordingPayload[] = [];
  private isSyncing = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private recorder: SessionRecorder | null = null;

  constructor(connectionString: string, options: TracewayFrontendOptions = {}) {
    const { token, apiUrl } = parseConnectionString(connectionString);
    this.apiUrl = apiUrl;
    this.token = token;
    this.debug = options.debug ?? false;
    this.debounceMs = options.debounceMs ?? 1500;
    this.retryDelayMs = options.retryDelayMs ?? 10000;
    this.version = options.version ?? "";

    if (options.sessionRecording !== false && typeof window !== "undefined") {
      this.recorder = new SessionRecorder({
        segmentDuration: options.sessionRecordingSegmentDuration,
      });
      this.recorder.start();
    }
  }

  addException(exception: ExceptionStackTrace): void {
    if (this.recorder && this.recorder.hasSegments()) {
      const segments = this.recorder.getSegments();
      const allEvents = segments.flatMap((s) => s.events);
      const exceptionId = generateUUID();
      exception.sessionRecordingId = exceptionId;
      this.pendingRecordings.push({ exceptionId, events: allEvents });
    }

    this.pendingExceptions.push(exception);
    this.scheduleSync();
  }

  private scheduleSync(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.doSync();
    }, this.debounceMs);
  }

  private async doSync(): Promise<void> {
    if (this.isSyncing) return;
    if (this.pendingExceptions.length === 0) return;

    this.isSyncing = true;
    const batch = this.pendingExceptions.splice(0);
    const recordings = this.pendingRecordings.splice(0);

    const frame: CollectionFrame = {
      stackTraces: batch,
      metrics: [],
      traces: [],
      sessionRecordings: recordings.length > 0 ? recordings : undefined,
    };

    const payload: ReportRequest = {
      collectionFrames: [frame],
      appVersion: this.version,
      serverName: "",
    };

    let failed = false;
    try {
      const success = await sendReport(
        this.apiUrl,
        this.token,
        JSON.stringify(payload),
      );
      if (!success) {
        failed = true;
        this.pendingExceptions.unshift(...batch);
        this.pendingRecordings.unshift(...recordings);
        if (this.debug) {
          console.error("Traceway: sync failed, re-queued exceptions");
        }
      }
    } catch (err) {
      failed = true;
      this.pendingExceptions.unshift(...batch);
      this.pendingRecordings.unshift(...recordings);
      if (this.debug) {
        console.error("Traceway: sync error:", err);
      }
    } finally {
      this.isSyncing = false;
      if (this.pendingExceptions.length > 0) {
        if (failed) {
          this.scheduleRetry();
        } else {
          this.doSync();
        }
      }
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.doSync();
    }, this.retryDelayMs);
  }

  async flush(timeoutMs?: number): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.recorder) {
      this.recorder.stop();
    }

    const syncPromise = this.doSync();

    if (timeoutMs !== undefined) {
      await Promise.race([
        syncPromise,
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    } else {
      await syncPromise;
    }
  }
}
