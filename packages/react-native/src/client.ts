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
import {
  parseConnectionString,
  generateUUID,
  EventBuffer,
  nowISO,
} from "@tracewayapp/core";
import { sendReport } from "./transport.js";

function epochMsToISO(ms: number): string {
  return new Date(ms).toISOString();
}

function computeRecordingAnchors(
  logs: LogEvent[],
  actions: Array<NetworkEvent | NavigationEvent | CustomEvent>,
): { startedAt?: string; endedAt?: string } {
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
  "Network request failed",
  "Failed to fetch",
  "NetworkError when attempting to fetch resource",
  "Load failed",
  "Network Error",
  "The operation was aborted",
  /timeout/i,
  /status code 4\d{2}/,
  /failed: 4\d{2}/,
];

export interface TracewayReactNativeOptions {
  debug?: boolean;
  debounceMs?: number;
  retryDelayMs?: number;
  version?: string;
  ignoreErrors?: Array<string | RegExp>;
  beforeCapture?: (exception: ExceptionStackTrace) => boolean;
  /** Mirror console.{log,info,warn,error,debug} into the rolling log buffer. Default true. */
  captureLogs?: boolean;
  /** Record fetch / XHR requests as network actions. Default true. */
  captureNetwork?: boolean;
  /** Record manual `recordNavigation()` calls into the action buffer. Default true. */
  captureNavigation?: boolean;
  /**
   * Auto-collect device attributes (`os.name`, `os.version`,
   * `screen.resolution`, `screen.density`, `device.locale`, `runtime.engine`)
   * at init and attach them to every captured exception. Default true.
   */
  captureDeviceInfo?: boolean;
  /** Window kept in the rolling log/action buffers. Default 10_000ms. */
  eventsWindowMs?: number;
  /** Hard cap applied independently to logs and actions. Default 200. */
  eventsMaxCount?: number;
  /**
   * Hostnames that should receive an outgoing `traceway-trace-id` header so
   * server-side captures can be linked to the client request. React Native
   * has no `window.location.origin`, so distributed tracing is opt-in:
   * pass the hosts of your own backend(s) here (e.g. `["api.example.com"]`).
   * Each entry can be an exact hostname string or a RegExp tested against
   * the URL's host. Default: empty (no injection).
   */
  distributedTraceHosts?: Array<string | RegExp>;
  /**
   * When `true`, every `fetch` / `XHR` response with `status >= 500` is also
   * reported to Traceway as a synthetic exception (in addition to the network
   * action it already records). 4xx responses are intentionally not captured
   * by this flag — see `DEFAULT_IGNORE_PATTERNS`. Default `false`.
   */
  captureHttpServerErrors?: boolean;
}

export class TracewayReactNativeClient {
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

  private ignoreErrors: Array<string | RegExp>;
  private beforeCapture:
    | ((exception: ExceptionStackTrace) => boolean)
    | null;

  readonly captureLogs: boolean;
  readonly captureNetwork: boolean;
  readonly captureNavigation: boolean;
  readonly captureDeviceInfo: boolean;
  readonly distributedTraceHosts: Array<string | RegExp>;
  readonly captureHttpServerErrors: boolean;
  private deviceAttributes: Record<string, string> = {};
  private readonly logs: EventBuffer<LogEvent>;
  private readonly actions: EventBuffer<
    NetworkEvent | NavigationEvent | CustomEvent
  >;

  constructor(
    connectionString: string,
    options: TracewayReactNativeOptions = {},
  ) {
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
    this.captureDeviceInfo = options.captureDeviceInfo ?? true;
    this.distributedTraceHosts = options.distributedTraceHosts ?? [];
    this.captureHttpServerErrors = options.captureHttpServerErrors ?? false;

    const bufferOpts = {
      windowMs: options.eventsWindowMs ?? 10_000,
      maxSize: options.eventsMaxCount ?? 200,
    };
    this.logs = new EventBuffer<LogEvent>(bufferOpts);
    this.actions = new EventBuffer<
      NetworkEvent | NavigationEvent | CustomEvent
    >(bufferOpts);
  }

  // ── Device / global attributes ──────────────────────────────────────────

  /**
   * Replaces the auto-attached attribute map. Every subsequent
   * `addException` merges these into the exception's attributes (per-call
   * attributes win on key collision). Pass `{}` to clear.
   */
  setDeviceAttributes(attributes: Record<string, string>): void {
    this.deviceAttributes = { ...attributes };
    if (this.debug) {
      console.debug("Traceway: device attributes:", this.deviceAttributes);
    }
  }

  /** @internal — exposed for tests. */
  bufferedDeviceAttributes(): Record<string, string> {
    return { ...this.deviceAttributes };
  }

  /**
   * App-defined attributes attached to every exception emitted by this
   * client. Layered on top of the device attributes (which carry OS / app
   * version metadata). Per-call exception attributes win over both.
   */
  private globalAttributes: Record<string, string> = {};

  setAttribute(key: string, value: string): void {
    if (!key) return;
    this.globalAttributes[key] = value;
  }

  setAttributes(attrs: Record<string, string>): void {
    if (!attrs) return;
    for (const k of Object.keys(attrs)) {
      if (!k) continue;
      this.globalAttributes[k] = attrs[k]!;
    }
  }

  removeAttribute(key: string): void {
    delete this.globalAttributes[key];
  }

  clearAttributes(): void {
    this.globalAttributes = {};
  }

  /** @internal — exposed for tests. */
  currentAttributes(): Record<string, string> {
    return { ...this.globalAttributes };
  }

  // ── Timeline event recording ────────────────────────────────────────────

  recordLog(level: LogEvent["level"], message: string): void {
    if (!this.captureLogs) return;
    this.logs.add({ type: "log", timestamp: nowISO(), level, message });
  }

  recordNetworkEvent(
    event: Omit<NetworkEvent, "type" | "timestamp"> & { timestamp?: string },
  ): void {
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

  recordNavigationEvent(
    event: Omit<NavigationEvent, "type" | "timestamp"> & { timestamp?: string },
  ): void {
    if (!this.captureNavigation) return;
    this.actions.add({
      type: "navigation",
      timestamp: event.timestamp ?? nowISO(),
      action: event.action,
      from: event.from,
      to: event.to,
    });
  }

  recordAction(
    category: string,
    name: string,
    data?: Record<string, unknown>,
  ): void {
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

  /**
   * Promote a 5xx HTTP response into a captured exception. Called from the
   * fetch / XHR wrappers when `captureHttpServerErrors` is enabled.
   */
  captureHttpServerError(
    method: string,
    url: string,
    statusCode: number,
  ): void {
    this.addException({
      traceId: null,
      stackTrace: `HTTP ${statusCode} ${method} ${url}`,
      recordedAt: nowISO(),
      attributes: {
        "http.method": method,
        "http.url": url,
        "http.status_code": String(statusCode),
      },
      isMessage: true,
    });
  }

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

    if (
      Object.keys(this.deviceAttributes).length > 0 ||
      Object.keys(this.globalAttributes).length > 0
    ) {
      // Layering: device < global < per-call. Caller wins on key collision.
      exception.attributes = {
        ...this.deviceAttributes,
        ...this.globalAttributes,
        ...(exception.attributes ?? {}),
      };
    }

    const logSnapshot = this.logs.snapshot();
    const actionSnapshot = this.actions.snapshot();
    const hasTimelineData =
      logSnapshot.length > 0 || actionSnapshot.length > 0;

    if (hasTimelineData) {
      const exceptionId = generateUUID();
      exception.sessionRecordingId = exceptionId;
      const payload: SessionRecordingPayload = {
        exceptionId,
        events: [],
      };
      const anchors = computeRecordingAnchors(logSnapshot, actionSnapshot);
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
