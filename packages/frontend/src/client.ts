import type {
  ExceptionStackTrace,
  ReportRequest,
  CollectionFrame,
} from "@traceway/core";
import { parseConnectionString, nowISO } from "@traceway/core";
import { sendReport } from "./transport.js";

export interface TracewayFrontendOptions {
  debug?: boolean;
  debounceMs?: number;
  retryDelayMs?: number;
  version?: string;
}

export class TracewayFrontendClient {
  private apiUrl: string;
  private token: string;
  private debug: boolean;
  private debounceMs: number;
  private retryDelayMs: number;
  private version: string;

  private pendingExceptions: ExceptionStackTrace[] = [];
  private isSyncing = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(connectionString: string, options: TracewayFrontendOptions = {}) {
    const { token, apiUrl } = parseConnectionString(connectionString);
    this.apiUrl = apiUrl;
    this.token = token;
    this.debug = options.debug ?? false;
    this.debounceMs = options.debounceMs ?? 1500;
    this.retryDelayMs = options.retryDelayMs ?? 10000;
    this.version = options.version ?? "";
  }

  addException(exception: ExceptionStackTrace): void {
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

    const frame: CollectionFrame = {
      stackTraces: batch,
      metrics: [],
      traces: [],
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
        if (this.debug) {
          console.error("Traceway: sync failed, re-queued exceptions");
        }
      }
    } catch (err) {
      failed = true;
      this.pendingExceptions.unshift(...batch);
      if (this.debug) {
        console.error("Traceway: sync error:", err);
      }
    } finally {
      this.isSyncing = false;
      if (this.pendingExceptions.length > 0) {
        if (failed) {
          // On failure, wait before retrying to avoid hammering the server
          this.scheduleRetry();
        } else {
          // On success, process remaining items immediately
          this.doSync();
        }
      }
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return; // Already scheduled
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.doSync();
    }, this.retryDelayMs);
  }

  async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    await this.doSync();
  }
}
