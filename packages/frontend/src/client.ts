import type {
  ExceptionStackTrace,
  ReportRequest,
  CollectionFrame,
  SessionRecordingPayload,
  LogEvent,
  NetworkEvent,
  NavigationEvent,
  CustomEvent,
  TracewayEvent,
} from "@tracewayapp/core";
import { parseConnectionString, generateUUID, EventBuffer, nowISO } from "@tracewayapp/core";
import { sendReport } from "./transport.js";
import { SessionRecorder } from "./session-recorder.js";

interface RrwebLikeEvent {
  timestamp?: number;
}

function epochMsToISO(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Computes the wall-clock window covered by a recording. Prefers rrweb events
 * (each carries a `timestamp` epoch ms); falls back to the timestamp range of
 * the buffered logs/actions when there's no replay data — that path is what
 * fires when `sessionRecording: false` but logs/actions are still being kept.
 */
function computeRecordingAnchors(
  recorderEvents: unknown[],
  logs: LogEvent[],
  actions: Array<NetworkEvent | NavigationEvent | CustomEvent>,
): { startedAt?: string; endedAt?: string } {
  if (recorderEvents.length > 0) {
    const stamps: number[] = [];
    for (const e of recorderEvents) {
      const ts = (e as RrwebLikeEvent)?.timestamp;
      if (typeof ts === "number" && Number.isFinite(ts)) stamps.push(ts);
    }
    if (stamps.length > 0) {
      return {
        startedAt: epochMsToISO(Math.min(...stamps)),
        endedAt: epochMsToISO(Math.max(...stamps)),
      };
    }
  }

  const eventStamps = [
    ...logs.map((e) => Date.parse(e.timestamp)),
    ...actions.map((e) => Date.parse(e.timestamp)),
  ].filter((n) => Number.isFinite(n));
  if (eventStamps.length === 0) return {};
  return {
    startedAt: epochMsToISO(Math.min(...eventStamps)),
    endedAt: epochMsToISO(Math.max(...eventStamps)),
  };
}

export const DEFAULT_IGNORE_PATTERNS: Array<string | RegExp> = [
  // Network errors (browser-specific messages)
  "Failed to fetch",
  "NetworkError when attempting to fetch resource",
  "Load failed",
  "Network Error",
  // Timeout / Abort
  "The operation was aborted",
  /timeout/i,
  // 4xx HTTP errors (common library patterns)
  /status code 4\d{2}/,
  /failed: 4\d{2}/,
];

export interface TracewayFrontendOptions {
  debug?: boolean;
  debounceMs?: number;
  retryDelayMs?: number;
  version?: string;
  sessionRecording?: boolean;
  sessionRecordingSegmentDuration?: number;
  ignoreErrors?: Array<string | RegExp>;
  beforeCapture?: (exception: ExceptionStackTrace) => boolean;
  /** Mirror console.{log,info,warn,error,debug} into the rolling log buffer. Default true. */
  captureLogs?: boolean;
  /** Record fetch / XHR requests as network actions. Default true. */
  captureNetwork?: boolean;
  /** Record History API push/replace/pop as navigation actions. Default true. */
  captureNavigation?: boolean;
  /** Window kept in the rolling log/action buffers. Default 10_000ms. */
  eventsWindowMs?: number;
  /** Hard cap applied independently to logs and actions. Default 200. */
  eventsMaxCount?: number;
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

  private ignoreErrors: Array<string | RegExp>;
  private beforeCapture:
    | ((exception: ExceptionStackTrace) => boolean)
    | null;

  readonly captureLogs: boolean;
  readonly captureNetwork: boolean;
  readonly captureNavigation: boolean;
  private readonly logs: EventBuffer<LogEvent>;
  private readonly actions: EventBuffer<NetworkEvent | NavigationEvent | CustomEvent>;

  constructor(connectionString: string, options: TracewayFrontendOptions = {}) {
    const { token, apiUrl } = parseConnectionString(connectionString);
    this.apiUrl = apiUrl;
    this.token = token;
    this.debug = options.debug ?? false;
    this.debounceMs = options.debounceMs ?? 1500;
    this.retryDelayMs = options.retryDelayMs ?? 10000;
    this.version = options.version ?? "";
    this.ignoreErrors = options.ignoreErrors ?? DEFAULT_IGNORE_PATTERNS;
    this.beforeCapture = options.beforeCapture ?? null;

    this.captureLogs = options.captureLogs ?? true;
    this.captureNetwork = options.captureNetwork ?? true;
    this.captureNavigation = options.captureNavigation ?? true;

    const bufferOpts = {
      windowMs: options.eventsWindowMs ?? 10_000,
      maxSize: options.eventsMaxCount ?? 200,
    };
    this.logs = new EventBuffer<LogEvent>(bufferOpts);
    this.actions = new EventBuffer<NetworkEvent | NavigationEvent | CustomEvent>(bufferOpts);

    if (options.sessionRecording !== false && typeof window !== "undefined") {
      this.recorder = new SessionRecorder({
        segmentDuration: options.sessionRecordingSegmentDuration,
      });
      this.recorder.start();
    }
  }

  // ── Timeline event recording ────────────────────────────────────────────

  recordLog(level: LogEvent["level"], message: string): void {
    if (!this.captureLogs) return;
    this.logs.add({ type: "log", timestamp: nowISO(), level, message });
  }

  recordNetworkEvent(event: Omit<NetworkEvent, "type" | "timestamp"> & { timestamp?: string }): void {
    if (!this.captureNetwork) return;
    this.actions.add({
      type: "network",
      timestamp: event.timestamp ?? nowISO(),
      method: event.method,
      url: event.url,
      durationMs: event.durationMs,
      statusCode: event.statusCode,
      requestBytes: event.requestBytes,
      responseBytes: event.responseBytes,
      error: event.error,
    });
  }

  recordNavigationEvent(event: Omit<NavigationEvent, "type" | "timestamp"> & { timestamp?: string }): void {
    if (!this.captureNavigation) return;
    this.actions.add({
      type: "navigation",
      timestamp: event.timestamp ?? nowISO(),
      action: event.action,
      from: event.from,
      to: event.to,
    });
  }

  /**
   * Records a custom user-defined breadcrumb. Use to log any app-level action
   * that should ride along with the next exception ("user_tapped_pay",
   * "cart_synced", etc.). Always recorded — there is no per-category opt-out.
   */
  recordAction(category: string, name: string, data?: Record<string, unknown>): void {
    this.actions.add({
      type: "custom",
      timestamp: nowISO(),
      category,
      name,
      data,
    });
  }

  /** @internal — exposed for tests. */
  bufferedLogs(): LogEvent[] {
    return this.logs.snapshot();
  }

  /** @internal — exposed for tests. */
  bufferedActions(): TracewayEvent[] {
    return this.actions.snapshot();
  }

  // ── Exception lifecycle ─────────────────────────────────────────────────

  addException(exception: ExceptionStackTrace): void {
    if (this.shouldIgnore(exception)) {
      if (this.debug) {
        console.debug(
          "Traceway: exception suppressed by filter",
          exception.stackTrace.slice(0, 120),
        );
      }
      return;
    }

    const recorderEvents =
      this.recorder && this.recorder.hasSegments()
        ? this.recorder.getSegments().flatMap((s) => s.events)
        : [];
    const logSnapshot = this.logs.snapshot();
    const actionSnapshot = this.actions.snapshot();
    const hasTimelineData =
      recorderEvents.length > 0 ||
      logSnapshot.length > 0 ||
      actionSnapshot.length > 0;

    if (hasTimelineData) {
      const exceptionId = generateUUID();
      exception.sessionRecordingId = exceptionId;
      const payload: SessionRecordingPayload = {
        exceptionId,
        events: recorderEvents,
      };
      const anchors = computeRecordingAnchors(
        recorderEvents,
        logSnapshot,
        actionSnapshot,
      );
      if (anchors.startedAt) payload.startedAt = anchors.startedAt;
      if (anchors.endedAt) payload.endedAt = anchors.endedAt;
      if (logSnapshot.length > 0) payload.logs = logSnapshot;
      if (actionSnapshot.length > 0) payload.actions = actionSnapshot;
      this.pendingRecordings.push(payload);
    }

    this.pendingExceptions.push(exception);
    this.scheduleSync();
  }

  private shouldIgnore(exception: ExceptionStackTrace): boolean {
    if (this.ignoreErrors.length > 0) {
      const text = exception.stackTrace;
      for (const pattern of this.ignoreErrors) {
        if (typeof pattern === "string") {
          if (text.includes(pattern)) return true;
        } else {
          pattern.lastIndex = 0;
          if (pattern.test(text)) return true;
        }
      }
    }

    if (this.beforeCapture !== null) {
      try {
        const result = this.beforeCapture(exception);
        if (result === false) return true;
      } catch (err) {
        if (this.debug) {
          console.error("Traceway: beforeCapture callback threw:", err);
        }
      }
    }

    return false;
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
