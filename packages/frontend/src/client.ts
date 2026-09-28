import type {
  ExceptionStackTrace,
  ReportRequest,
  CollectionFrame,
  SessionPayload,
  SessionRecordingPayload,
  LogEvent,
  NetworkEvent,
  NavigationEvent,
  CustomEvent,
  TracewayEvent,
} from "@tracewayapp/core";
import { parseConnectionString, generateUUID, EventBuffer, nowISO } from "@tracewayapp/core";
import { KEEPALIVE_BUDGET_BYTES, sendReport, sendReportKeepalive } from "./transport.js";
import { SessionRecorder } from "./session-recorder.js";
import {
  DEFAULT_INACTIVITY_MS,
  DEFAULT_MAX_DURATION_MS,
  SessionLifecycle,
} from "./session-lifecycle.js";
import { clearStoredSession, readStoredSession, writeStoredSession } from "./session-store.js";
import { collectDefaultAttributes } from "./default-attributes.js";
import { debugIdsForStackTrace } from "./debug-ids.js";

interface RrwebLikeEvent {
  timestamp?: number;
}

const ENTRY_ATTRIBUTE_KEYS = ["url", "path", "referrer"] as const;

function entryAttributes(): Record<string, string> {
  const defaults = collectDefaultAttributes();
  const entry: Record<string, string> = {};
  for (const key of ENTRY_ATTRIBUTE_KEYS) {
    if (defaults[key] !== undefined) entry[key] = defaults[key]!;
  }
  return entry;
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
  // RN-style network error (surfaces here when an app shares code with React Native)
  "Network request failed",
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
  /**
   * Upload every segment of the session regardless of whether an exception
   * fires. Each segment (default ~30 s, see `sessionRecordingSegmentDuration`)
   * becomes its own `session_recordings` row on the backend, all linked to a
   * parent `sessions` row by `sessionId`.
   *
   *   - Inactivity timeout: 15 min ends the session, stamped at the last activity.
   *   - Max duration: 60 min ends the session.
   *   - `pagehide` closes the session and flushes it; a navigation to another
   *     page of the same tab within the inactivity window continues it.
   *   - Hiding the page flushes the in-progress segment.
   *
   * Defaults to false to preserve the existing exception-only behaviour.
   */
  recordAllSessions?: boolean;
  /** Initial attributes for sessions and exceptions; copied when the client starts. */
  attributes?: Record<string, string>;
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
  /**
   * When `true`, every `fetch` / `XHR` response with `status >= 500` is also
   * reported to Traceway as a synthetic exception (in addition to the network
   * action it already records). 4xx responses are intentionally not captured
   * by this flag — see `DEFAULT_IGNORE_PATTERNS`. Default `false`.
   */
  captureHttpServerErrors?: boolean;
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
  private pendingSessions: SessionPayload[] = [];
  private isSyncing = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private recorder: SessionRecorder | null = null;
  private lifecycle: SessionLifecycle | null = null;
  private readonly recordAllSessions: boolean;
  private sessionId: string | null = null;
  private sessionStartedAt: string | null = null;
  private sessionStartedAtMs = 0;
  private sessionActive = false;
  private sessionEntry: Record<string, string> = {};
  private segmentIndex = 0;
  private readonly sessionStoreKey: string;
  private keepaliveInFlightBytes = 0;
  /**
   * App-defined attributes attached to every session and exception emitted by
   * this client. Set via setAttribute() / setAttributes(). Auto-collected
   * defaults take a back seat to these; per-call exception attributes win
   * over both.
   */
  private globalAttributes: Record<string, string> = {};
  /**
   * Set true once the page begins unloading (`pagehide`), so the closing
   * payload goes out through the keepalive path instead of the debounced sync.
   */
  private unloading = false;

  private ignoreErrors: Array<string | RegExp>;
  private beforeCapture:
    | ((exception: ExceptionStackTrace) => boolean)
    | null;

  readonly captureLogs: boolean;
  readonly captureNetwork: boolean;
  readonly captureNavigation: boolean;
  readonly captureHttpServerErrors: boolean;
  private readonly logs: EventBuffer<LogEvent>;
  private readonly actions: EventBuffer<NetworkEvent | NavigationEvent | CustomEvent>;

  constructor(connectionString: string, options: TracewayFrontendOptions = {}) {
    const { token, apiUrl } = parseConnectionString(connectionString);
    this.apiUrl = apiUrl;
    this.token = token;
    this.sessionStoreKey = `traceway:session:${token}`;
    this.debug = options.debug ?? false;
    this.debounceMs = options.debounceMs ?? 1500;
    this.retryDelayMs = options.retryDelayMs ?? 10000;
    this.version = options.version ?? "";
    this.globalAttributes = { ...options.attributes };
    this.ignoreErrors = options.ignoreErrors ?? DEFAULT_IGNORE_PATTERNS;
    this.beforeCapture = options.beforeCapture ?? null;

    this.captureLogs = options.captureLogs ?? true;
    this.captureNetwork = options.captureNetwork ?? true;
    this.captureNavigation = options.captureNavigation ?? true;
    this.captureHttpServerErrors = options.captureHttpServerErrors ?? false;

    // When always-on session recording is on, segments rotate every 30 s and
    // drain the logs/actions buffers on each rotation. The window/cap need to
    // span a full segment so we don't ship a partial slice. When always-on is
    // off, keep the legacy 10 s / 200 cap — the rolling buffer powers the
    // exception-bound clip and shouldn't grow unbounded.
    const alwaysOn = options.recordAllSessions === true;
    const bufferOpts = {
      windowMs: options.eventsWindowMs ?? (alwaysOn ? 30_000 : 10_000),
      maxSize: options.eventsMaxCount ?? (alwaysOn ? 600 : 200),
    };
    this.logs = new EventBuffer<LogEvent>(bufferOpts);
    this.actions = new EventBuffer<NetworkEvent | NavigationEvent | CustomEvent>(bufferOpts);

    this.recordAllSessions = options.recordAllSessions ?? false;
    const hasWindow = typeof window !== "undefined";

    // The always-on session/lifecycle path runs even when sessionRecording is
    // disabled — exceptions still get stamped with sessionId and the parent
    // sessions row is still created. Without a recorder, no rrweb segments
    // ride along, but the linkage in the dashboard remains intact.
    if (this.recordAllSessions && hasWindow) {
      const lastActivityMs = this.openSession();
      this.lifecycle = new SessionLifecycle({
        startedAtMs: this.sessionStartedAtMs,
        lastActivityMs,
        onUnloading: () => {
          this.unloading = true;
        },
        onSessionEnd: (endedAtMs) => this.endSession(endedAtMs),
        onSessionRestart: () => this.restartSession(),
        onSoftFlush: () => this.flushOnHidden(),
        onResume: () => this.resumeVisible(),
      });
      this.lifecycle.install();
    }

    if (options.sessionRecording !== false && hasWindow) {
      const recorderOptions: ConstructorParameters<typeof SessionRecorder>[0] = {
        segmentDuration: options.sessionRecordingSegmentDuration,
      };
      if (this.recordAllSessions) {
        recorderOptions.onSegmentReady = (seg) => this.handleSegmentReady(seg);
        // rrweb's emit fires for every DOM mutation/input event — use it as
        // the lifecycle's activity heartbeat so we don't double-listen on
        // window for mousedown/keydown/scroll/etc.
        recorderOptions.onActivity = () => this.lifecycle?.markActivity();
      }
      this.recorder = new SessionRecorder(recorderOptions);
      this.recorder.start();
    }
  }

  // ── Session lifecycle (always-on) ──────────────────────────────────────

  /**
   * Opens the tab's session: continues the one a previous page of this tab
   * closed within the inactivity window, or starts a new one. Returns the
   * session's last activity for the lifecycle's inactivity clock.
   */
  private openSession(): number {
    const now = Date.now();
    const stored = readStoredSession(this.sessionStoreKey);
    const resumable =
      stored !== null &&
      stored.closedAtMs !== undefined &&
      now - stored.lastActivityMs < DEFAULT_INACTIVITY_MS &&
      now - stored.startedAtMs < DEFAULT_MAX_DURATION_MS;

    let lastActivityMs = now;
    if (resumable) {
      this.sessionId = stored.id;
      this.sessionStartedAt = stored.startedAt;
      this.sessionStartedAtMs = stored.startedAtMs;
      this.segmentIndex = stored.segmentIndex;
      this.sessionEntry = stored.entry ?? {};
      lastActivityMs = stored.lastActivityMs;
    } else {
      this.sessionId = generateUUID();
      this.sessionStartedAtMs = now;
      this.sessionStartedAt = new Date(now).toISOString();
      this.segmentIndex = 0;
      this.sessionEntry = entryAttributes();
    }
    this.sessionActive = true;
    this.persistSession(lastActivityMs);

    this.pendingSessions.push({
      id: this.sessionId,
      startedAt: this.sessionStartedAt,
      attributes: this.composedSessionAttributes(),
    });
    this.scheduleSync();
    return lastActivityMs;
  }

  private persistSession(lastActivityMs: number, closedAtMs?: number): void {
    if (!this.sessionId || !this.sessionStartedAt) return;
    writeStoredSession(this.sessionStoreKey, {
      id: this.sessionId,
      startedAt: this.sessionStartedAt,
      startedAtMs: this.sessionStartedAtMs,
      lastActivityMs,
      segmentIndex: this.segmentIndex,
      entry: this.sessionEntry,
      closedAtMs,
    });
  }

  /**
   * Merge browser defaults with whatever app-level scope was set via
   * setAttribute(). App attrs override defaults on key collision. The page
   * the session started on keeps its url/path/referrer for the whole
   * session, so later pages and routes don't overwrite where the visit came
   * from (the landing URL is what carries campaign parameters).
   */
  private composedSessionAttributes(): Record<string, string> {
    return {
      ...collectDefaultAttributes(),
      ...this.sessionEntry,
      ...this.globalAttributes,
    };
  }

  // ── Global scope ────────────────────────────────────────────────────────

  /**
   * Attach a key/value attribute to every subsequent session and exception
   * emitted by this client. If a session is already open, its attributes are
   * refreshed on the backend immediately. Setting the same key replaces the
   * previous value.
   */
  setAttribute(key: string, value: string): void {
    if (!key) return;
    this.globalAttributes[key] = value;
    this.refreshOpenSessionAttributes();
  }

  /**
   * Bulk version of setAttribute. Caller's keys override existing scope.
   * Triggers one session refresh after the merge, not one per key.
   */
  setAttributes(attrs: Record<string, string>): void {
    if (!attrs) return;
    let changed = false;
    for (const k of Object.keys(attrs)) {
      if (!k) continue;
      this.globalAttributes[k] = attrs[k]!;
      changed = true;
    }
    if (changed) this.refreshOpenSessionAttributes();
  }

  removeAttribute(key: string): void {
    if (key in this.globalAttributes) {
      delete this.globalAttributes[key];
      this.refreshOpenSessionAttributes();
    }
  }

  clearAttributes(): void {
    if (Object.keys(this.globalAttributes).length === 0) return;
    this.globalAttributes = {};
    this.refreshOpenSessionAttributes();
  }

  /** @internal — exposed for tests. */
  currentAttributes(): Record<string, string> {
    return { ...this.globalAttributes };
  }

  /**
   * When the global scope changes mid-session, push a session-refresh
   * payload (no endedAt) so the backend's ON CONFLICT update writes the new
   * attribute blob into the existing row. Without this the new attrs would
   * only land at session close.
   */
  private refreshOpenSessionAttributes(): void {
    if (!this.sessionId || !this.sessionStartedAt) return;
    if (this.recordAllSessions !== true || !this.sessionActive) return;
    this.pendingSessions.push({
      id: this.sessionId,
      startedAt: this.sessionStartedAt,
      attributes: this.composedSessionAttributes(),
    });
    this.scheduleSync();
  }

  private endSession(endedAtMs: number): void {
    if (!this.sessionId || !this.sessionStartedAt || !this.sessionActive) return;

    if (this.recorder) {
      const drained = this.recorder.drainCurrent();
      if (drained && drained.events.length > 0) {
        this.queueSegment(drained);
      }
    }

    this.pendingSessions.push({
      id: this.sessionId,
      startedAt: this.sessionStartedAt,
      endedAt: new Date(endedAtMs).toISOString(),
      // Re-snapshot attributes so the upsert doesn't clobber the opening
      // attribute blob with an empty map. Also picks up URL changes and any
      // global-scope attributes set during the session.
      attributes: this.composedSessionAttributes(),
    });
    this.sessionActive = false;

    // On unload the debounce timer never fires and an in-flight sync would
    // hold the closing payload back, so it leaves on the keepalive path now.
    // The stored session stays resumable for the next page of this tab.
    if (this.unloading) {
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.persistSession(this.lifecycle?.lastActivity() ?? endedAtMs, Date.now());
      this.flushKeepalive();
    } else {
      clearStoredSession(this.sessionStoreKey);
      this.scheduleSync();
    }
  }

  /**
   * Opens a session again after the previous one ended: continues it when
   * the page came back from bfcache within the inactivity window, otherwise
   * starts a new one. The recorder restarts from a full snapshot so the new
   * segment replays on its own.
   */
  private restartSession(): void {
    this.unloading = false;
    const lastActivityMs = this.openSession();
    this.lifecycle?.continueFrom(this.sessionStartedAtMs, lastActivityMs);
    this.recorder?.startFresh();
  }

  /**
   * The page was hidden: the OS may freeze or kill it without a `pagehide`
   * (mobile browsers routinely do), so the in-progress segment and anything
   * pending leave on the keepalive path while the page can still send.
   */
  private flushOnHidden(): void {
    if (this.sessionActive) {
      if (this.recorder) {
        const drained = this.recorder.drainCurrent();
        if (drained && drained.events.length > 0) {
          this.queueSegment(drained);
        }
      }
      this.persistSession(this.lifecycle?.lastActivity() ?? Date.now(), Date.now());
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.flushKeepalive();
    if (this.hasPending()) {
      this.scheduleSync();
    }
  }

  private resumeVisible(): void {
    if (!this.sessionActive) return;
    this.persistSession(this.lifecycle?.lastActivity() ?? Date.now());
    this.recorder?.startFresh();
  }

  private handleSegmentReady(segment: { events: unknown[]; startedAt: string; endedAt: string }): void {
    if (!this.sessionId || !this.sessionActive) return;
    this.queueSegment(segment);
    this.scheduleSync();
  }

  private queueSegment(segment: { events: unknown[]; startedAt: string; endedAt: string }): void {
    if (!this.sessionId) return;
    // Drain the rolling logs/actions buffers and attach them to this segment.
    // Clearing prevents segment N+1 from re-shipping the same entries.
    const logs = this.logs.snapshot();
    const actions = this.actions.snapshot();
    if (logs.length > 0) this.logs.clear();
    if (actions.length > 0) this.actions.clear();

    const payload: SessionRecordingPayload = {
      sessionId: this.sessionId,
      segmentIndex: this.segmentIndex++,
      events: segment.events,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
    };
    if (logs.length > 0) payload.logs = logs;
    if (actions.length > 0) payload.actions = actions;
    this.pendingRecordings.push(payload);
    if (this.sessionActive) {
      this.persistSession(this.lifecycle?.lastActivity() ?? Date.now());
    }
  }

  /** @internal — exposed for tests. */
  currentSessionId(): string | null {
    return this.sessionId;
  }

  // ── Timeline event recording ────────────────────────────────────────────

  recordLog(level: LogEvent["level"], message: string): void {
    if (!this.captureLogs) return;
    this.logs.add({ type: "log", timestamp: nowISO(), level, message });
  }

  recordNetworkEvent(event: Omit<NetworkEvent, "type" | "timestamp"> & { timestamp?: string }): void {
    if (!this.captureNetwork) return;
    // Don't record the SDK's own report uploads — otherwise every segment
    // flush would be captured as a "network action" and end up in the next
    // segment's actions buffer, creating a self-referential tail.
    if (this.isOwnReportUrl(event.url)) return;
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

  private isOwnReportUrl(url: string): boolean {
    if (!url) return false;
    if (url === this.apiUrl) return true;
    // Defensive: match URLs that start with apiUrl plus a query/fragment
    // suffix, in case the transport ever appends one for diagnostics.
    if (url.startsWith(this.apiUrl + "?") || url.startsWith(this.apiUrl + "#")) return true;
    return false;
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

    // Merge in browser-context defaults plus the global scope. Caller-
    // supplied keys win over both. Order matters: defaults < global < caller.
    exception.attributes = {
      ...collectDefaultAttributes(),
      ...this.globalAttributes,
      ...(exception.attributes ?? {}),
    };

    if (!exception.isMessage && !exception.debugIds) {
      const debugIds = debugIdsForStackTrace(exception.stackTrace);
      if (debugIds) {
        exception.debugIds = debugIds;
      }
    }

    const recorderEvents =
      this.recorder && this.recorder.hasSegments()
        ? this.recorder.getClipEvents()
        : [];
    const logSnapshot = this.logs.snapshot();
    const actionSnapshot = this.actions.snapshot();
    const hasTimelineData =
      recorderEvents.length > 0 ||
      logSnapshot.length > 0 ||
      actionSnapshot.length > 0;

    // Tag the exception with the parent session id (if always-on is on) so
    // the dashboard can show a "View full session" link. Sessions and the
    // per-exception clip are independent attachments; both ride along. The
    // rrweb clip is a single segment (see getClipEvents), so it is bounded to
    // `sessionRecordingSegmentDuration` (default 30 s). The logs/actions that
    // ride with it stay on their own ~10 s rolling window (see EventBuffer).
    if (this.recordAllSessions && this.sessionId && this.sessionActive) {
      exception.sessionId = this.sessionId;
    }

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
    if (
      this.pendingExceptions.length === 0 &&
      this.pendingRecordings.length === 0 &&
      this.pendingSessions.length === 0
    ) {
      return;
    }

    this.isSyncing = true;
    const batch = this.pendingExceptions.splice(0);
    const recordings = this.pendingRecordings.splice(0);
    const sessions = this.pendingSessions.splice(0);

    const frame: CollectionFrame = {
      stackTraces: batch,
      metrics: [],
      traces: [],
      sessionRecordings: recordings.length > 0 ? recordings : undefined,
      sessions: sessions.length > 0 ? sessions : undefined,
    };

    const payload: ReportRequest = {
      collectionFrames: [frame],
      appVersion: this.version,
      serverName: "",
    };

    let failed = false;
    try {
      const success = await sendReport(this.apiUrl, this.token, JSON.stringify(payload));
      if (!success) {
        failed = true;
        this.pendingExceptions.unshift(...batch);
        this.pendingRecordings.unshift(...recordings);
        this.pendingSessions.unshift(...sessions);
        if (this.debug) {
          console.error("Traceway: sync failed, re-queued exceptions");
        }
      }
    } catch (err) {
      failed = true;
      this.pendingExceptions.unshift(...batch);
      this.pendingRecordings.unshift(...recordings);
      this.pendingSessions.unshift(...sessions);
      if (this.debug) {
        console.error("Traceway: sync error:", err);
      }
    } finally {
      this.isSyncing = false;
      if (
        this.pendingExceptions.length > 0 ||
        this.pendingRecordings.length > 0 ||
        this.pendingSessions.length > 0
      ) {
        if (failed) {
          this.scheduleRetry();
        } else {
          this.doSync();
        }
      }
    }
  }

  private hasPending(): boolean {
    return (
      this.pendingExceptions.length > 0 ||
      this.pendingRecordings.length > 0 ||
      this.pendingSessions.length > 0
    );
  }

  private reportFor(frame: Partial<CollectionFrame>): ReportRequest {
    return {
      collectionFrames: [{ stackTraces: [], metrics: [], traces: [], ...frame }],
      appVersion: this.version,
      serverName: "",
    };
  }

  /**
   * Sends what is pending through keepalive requests, which survive the page
   * being unloaded or killed. Browsers reject keepalive bodies beyond a shared
   * 64 KiB budget, so nothing is bundled: session rows go first on their own
   * (the closing row must never share a fate with a large replay segment),
   * then each exception with its own clip (the backend links a clip to its
   * exception only within one request), then each segment. What does not fit
   * stays pending for the regular sync, and a failed delivery is re-queued.
   */
  private flushKeepalive(): void {
    const send = (frame: Partial<CollectionFrame>, requeue: () => void): boolean => {
      const budget = KEEPALIVE_BUDGET_BYTES - this.keepaliveInFlightBytes;
      const { bytes, delivered } = sendReportKeepalive(
        this.apiUrl,
        this.token,
        JSON.stringify(this.reportFor(frame)),
        budget,
      );
      if (bytes === 0) return false;
      this.keepaliveInFlightBytes += bytes;
      void delivered.then((ok) => {
        this.keepaliveInFlightBytes -= bytes;
        if (!ok) {
          requeue();
          this.scheduleRetry();
        }
      });
      return true;
    };

    const sessions = this.pendingSessions.splice(0);
    if (sessions.length > 0 && !send({ sessions }, () => this.pendingSessions.unshift(...sessions))) {
      this.pendingSessions.unshift(...sessions);
    }

    const recordings = this.pendingRecordings.splice(0);
    const unsentExceptions: ExceptionStackTrace[] = [];
    for (const exception of this.pendingExceptions.splice(0)) {
      const clipIndex = recordings.findIndex(
        (r) => r.exceptionId !== undefined && r.exceptionId === exception.sessionRecordingId,
      );
      const clip = clipIndex >= 0 ? recordings.splice(clipIndex, 1)[0]! : undefined;
      const frame: Partial<CollectionFrame> = {
        stackTraces: [exception],
        sessionRecordings: clip ? [clip] : undefined,
      };
      const requeue = () => {
        this.pendingExceptions.push(exception);
        if (clip) this.pendingRecordings.push(clip);
      };
      if (!send(frame, requeue)) {
        unsentExceptions.push(exception);
        if (clip) recordings.push(clip);
      }
    }
    this.pendingExceptions.unshift(...unsentExceptions);

    const unsentRecordings: SessionRecordingPayload[] = [];
    for (const recording of recordings) {
      if (!send({ sessionRecordings: [recording] }, () => this.pendingRecordings.push(recording))) {
        unsentRecordings.push(recording);
      }
    }
    this.pendingRecordings.unshift(...unsentRecordings);
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
    if (this.lifecycle) {
      this.lifecycle.uninstall();
    }
    if (this.recordAllSessions) {
      this.endSession(Date.now());
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
