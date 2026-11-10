import { LegacyTransport } from "./transport/legacy.js";
import { logsToJson, spansToJson } from "./persistence/otlp-json.js";
import {
  trace,
  SpanStatusCode,
  context,
  propagation,
} from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { ConsoleInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/console";
import { ErrorsInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/errors";
import { FetchInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/fetch";
import { NavigationInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/navigation";
import { NavigationTimingInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/navigation-timing";
import { ResourceTimingInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/resource-timing";
import { UserActionInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/user-action";
import { WebVitalsInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/web-vitals";
import { XhrInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/xhr";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import type { LogRecordExporter, SdkLogRecord } from "@opentelemetry/sdk-logs";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import type { SpanExporter } from "@opentelemetry/sdk-trace";
import {
  BatchSpanProcessor,
  StackContextManager,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import type {
  FiredTrigger,
  Settings,
  SignalName,
  SignalSelector,
  TracewayEndpoints,
  TriggerAction,
} from "@tracewayapp/core";
import {
  ceilingsFrom,
  ControlState,
  defaultSettings,
  generateUUID,
  parseConnectionString,
  parseSettingsDocument,
  resolveEndpoints,
  RingBuffer,
  TriggerEngine,
  unitHash,
  uuidToBytes,
  uuidv7,
} from "@tracewayapp/core";
import type { AttributeValue, RemoteConfig } from "@tracewayapp/opamp";
import { AgentCapabilities, OpampHttpClient } from "@tracewayapp/opamp";
import {
  CollectionBudget,
  type CollectionLimits,
} from "./collection-budget.js";
import { ErrorLimiter, type ErrorLimits } from "./error-limiter.js";
import { debugIdsForStackTrace } from "./debug-ids.js";
import { collectDefaultAttributes } from "./default-attributes.js";
import { browserResourceAttributes } from "./otel/browser-resource.js";
import type { RecordSignal } from "./otel/events.js";
import {
  ATTR_DEBUG_IDS,
  ATTR_EXCEPTION_ID,
  ATTR_SESSION_ID,
  ATTR_SESSION_STARTED_AT,
  EVENT_ACTION,
  EVENT_CAPTURE_STARTED,
  EVENT_CONFIG_APPLIED,
  EVENT_EXCEPTION,
  EVENT_MESSAGE,
  EVENT_SESSION_END,
  EVENT_SESSION_START,
  EVENT_SESSION_UPDATE,
  EVENT_TRIGGER_FIRED,
  classifyLog,
} from "./otel/events.js";
import type { BufferedItem, ObservedRecord } from "./otel/router.js";
import {
  ControlLogProcessor,
  ControlSpanProcessor,
  TelemetryRouter,
} from "./otel/router.js";
import { ReplayController } from "./replay/replay-controller.js";
import type { SessionInfo } from "./session/session-manager.js";
import { SessionManager } from "./session/session-manager.js";
import { RecordingsTransport } from "./transport/recordings.js";
import { TelemetryPersistence } from "./persistence/telemetry-persistence.js";
import type { StoredBatch } from "./persistence/idb.js";
import { filterRequest } from "./persistence/otlp-json.js";
import type { SendResult } from "./persistence/outbox.js";
import {
  PersistingLogExporter,
  PersistingSpanExporter,
} from "./persistence/persisting-exporters.js";

export const SDK_VERSION = "2.0.0";
const SCOPE_NAME = "@tracewayapp/frontend";

export const DEFAULT_IGNORE_PATTERNS: Array<string | RegExp> = [
  "Failed to fetch",
  "NetworkError when attempting to fetch resource",
  "Load failed",
  "Network Error",
  "Network request failed",
  "The operation was aborted",
  /timeout/i,
  /status code 4\d{2}/,
  /failed: 4\d{2}/,
];

/** What `beforeCapture` sees of an exception before it is recorded. */
export interface CapturedException {
  type?: string;
  message?: string;
  stack?: string;
  attributes: Record<string, unknown>;
}

export interface TracewayFrontendOptions {
  debug?: boolean;
  /** `service.name` of this app. Defaults to the page's host name. */
  serviceName?: string;
  /** `service.version`, used to group releases and to target remote config. */
  version?: string;
  /** `deployment.environment.name`, e.g. "production". */
  environment?: string;
  /** Initial attributes for sessions and exceptions; copied when the client starts. */
  attributes?: Record<string, string>;
  ignoreErrors?: Array<string | RegExp>;
  /** Return false to drop an exception. */
  beforeCapture?: (exception: CapturedException) => boolean;

  /** Allow session replay at all. Remote config decides between buffering and streaming it. Default true. */
  sessionRecording?: boolean;
  sessionRecordingSegmentDuration?: number;
  /** Stream every replay segment by default instead of keeping them for error clips. Default false. */
  recordAllSessions?: boolean;
  /** Record session start and end. Default true. */
  sessions?: boolean;
  /** Share of sessions streaming buffered breadcrumbs and network spans; replay is unaffected. Default 0. */
  baselineSampleRate?: number;
  /** Local protection against repeated errors and error storms. */
  errorLimits?: Partial<ErrorLimits>;
  /** Diagnostic uploads per session: 50 MiB and 10,000 events by default. Developer options may lower these ceilings. */
  collectionLimits?: Partial<CollectionLimits>;

  /** The following allow a signal at all; remote config can only restrict them further. All default true. */
  captureLogs?: boolean;
  captureNetwork?: boolean;
  captureNavigation?: boolean;
  captureUserActions?: boolean;
  captureWebVitals?: boolean;
  captureResourceTiming?: boolean;

  /** Report fetch/XHR responses with status >= 500 as message issues. Default false. */
  captureHttpServerErrors?: boolean;
  /** Cross-origin URLs that receive the W3C `traceparent` header (same-origin requests always do). */
  propagateTraceHeaderCorsUrls?: Array<string | RegExp>;
  /**
   * Fetch collection settings from Traceway over OpAMP, so the dashboard can change what this app sends without a
   * release. The options above stay the ceiling: remote settings can only restrict them. Default true.
   */
  remoteConfig?: boolean;
  /** Auto detects pre-OpAMP servers; legacy forces /api/report without a probe. */
  transport?: "auto" | "legacy" | "otlp";
  /** Delay between OTLP exports, in milliseconds. Default 1000. */
  exportDelayMs?: number;

  /**
   * OTLP/HTTP base URL (appends /v1/logs and /v1/traces) and optional headers.
   * OpAMP and replay stay on Traceway. Traceway credentials are never forwarded.
   */
  telemetry?: { url: string; headers?: Record<string, string> };

  /** Advanced: export somewhere else than Traceway's OTLP endpoints, e.g. an in-memory exporter in tests. */
  logExporter?: LogRecordExporter;
  spanExporter?: SpanExporter;
}

function storageGet(key: string, perTab = false): string | null {
  try {
    if (perTab)
      return typeof sessionStorage === "undefined"
        ? null
        : sessionStorage.getItem(key);
    return typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string, perTab = false): void {
  try {
    if (perTab) {
      if (typeof sessionStorage !== "undefined")
        sessionStorage.setItem(key, value);
    } else if (typeof localStorage !== "undefined")
      localStorage.setItem(key, value);
  } catch {
    // Blocked storage only means a new instance id per page.
  }
}

interface LocalCapture {
  id: string;
  triggerId: string;
  untilMs: number;
  signals: SignalSelector;
  replay: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectorSet(
  signals: SignalSelector | undefined,
): ReadonlySet<string> | "*" {
  if (!signals || signals.includes("*")) return "*";
  return new Set(signals);
}

export class TracewayFrontendClient {
  readonly endpoints: TracewayEndpoints;
  readonly instanceId: string;
  readonly control: ControlState;

  private readonly token: string;
  private readonly options: TracewayFrontendOptions;
  private readonly ignoreErrors: Array<string | RegExp>;
  private readonly buffer: RingBuffer<BufferedItem>;
  private readonly triggers = new TriggerEngine();
  private readonly sessions: SessionManager;
  private readonly replay: ReplayController;
  private readonly recordings: RecordingsTransport;
  private sessionSink: BatchLogRecordProcessor | null = null;
  private sessionPersistence: TelemetryPersistence | null = null;
  private readonly errorLimiter: ErrorLimiter;
  private readonly collectionBudget: CollectionBudget;
  private healthTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly logSink: BatchLogRecordProcessor;
  private readonly spanSink: BatchSpanProcessor;
  private globalAttributes: Record<string, string>;
  private router: TelemetryRouter | null = null;
  private logger: Logger | null = null;
  private loggerProvider: LoggerProvider | null = null;
  private tracerProvider: TracerProvider | null = null;
  private deregisterInstrumentations: (() => void) | null = null;
  private ownsPropagator = false;
  private ownsContextManager = false;
  private unloading = false;
  private started = false;
  private readonly legacy: LegacyTransport;
  private opamp: OpampHttpClient | null = null;
  private resourceAttributes: Record<string, unknown> = {};
  private appliedConfigHash: Uint8Array | undefined;
  private describeTimer: ReturnType<typeof setTimeout> | null = null;
  private overrideTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly persistence: TelemetryPersistence;

  constructor(connectionString: string, options: TracewayFrontendOptions = {}) {
    const { token, apiUrl } = parseConnectionString(connectionString);
    this.token = token;
    this.options = options;
    this.errorLimiter = new ErrorLimiter(options.errorLimits);
    this.collectionBudget = new CollectionBudget(
      token,
      options.collectionLimits,
    );
    this.endpoints = resolveEndpoints(apiUrl);
    this.legacy = new LegacyTransport(
      this.endpoints.base,
      token,
      options.version ?? "",
    );
    this.legacy.enabled = options.transport === "legacy";
    if (options.telemetry) {
      const url = new URL(options.telemetry.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error(
          "telemetry.url must be an HTTP(S) base URL without credentials, query, or fragment",
        );
      }
      const base = url.toString().replace(/\/+$/, "");
      this.endpoints.logs = base + "/v1/logs";
      this.endpoints.traces = base + "/v1/traces";
    }
    const instanceKey = `traceway:instance:${this.token}`;
    const storedInstanceId = storageGet(instanceKey);
    this.instanceId =
      storedInstanceId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        storedInstanceId,
      )
        ? storedInstanceId
        : uuidv7();
    if (this.instanceId !== storedInstanceId)
      storageSet(instanceKey, this.instanceId);
    this.ignoreErrors = options.ignoreErrors ?? DEFAULT_IGNORE_PATTERNS;
    this.globalAttributes = { ...options.attributes };

    this.control = new ControlState(
      defaultSettings({
        recordAllSessions: options.recordAllSessions,
        baselineSampleRate: options.baselineSampleRate,
      }),
      ceilingsFrom({
        sessionRecording: options.sessionRecording,
        captureLogs: options.captureLogs,
        captureNetwork: options.captureNetwork,
        captureNavigation: options.captureNavigation,
        captureUserActions: options.captureUserActions,
        captureWebVitals: options.captureWebVitals,
        captureResourceTiming: options.captureResourceTiming,
        sessions: options.sessions,
      }),
    );
    const settings = this.control.settings();
    this.buffer = new RingBuffer<BufferedItem>({
      maxBytes: settings.buffer.maxBytes,
      maxAgeMs: settings.buffer.maxAgeSeconds * 1000,
    });
    this.recordings = new RecordingsTransport(
      this.endpoints.recordings,
      token,
      (url, init) => this.legacy.recordings(String(url), init),
      (segment) => {
        const accepted = this.collectionBudget.admit(
          segment.sessionId ?? null,
          new TextEncoder().encode(JSON.stringify(segment)).byteLength,
          segment.events.length,
        );
        if (!accepted) this.scheduleHealth();
        return accepted;
      },
      () => this.scheduleHealth(),
    );
    this.sessions = new SessionManager({
      storeKey: `traceway:session:${token}`,
      onStart: (session, resumed) => this.onSessionStart(session, resumed),
      onEnd: (session, endedAtMs, unloading) =>
        this.onSessionEnd(session, endedAtMs, unloading),
      onHidden: () => this.onHidden(),
      onVisible: () => this.onVisible(),
    });
    this.replay = new ReplayController(
      this.sessions,
      this.recordings,
      options.sessionRecordingSegmentDuration,
    );

    const authHeaders = this.telemetryHeaders();
    const exportDelay = options.exportDelayMs ?? 1000;
    this.persistence = new TelemetryPersistence(
      options.telemetry
        ? JSON.stringify([token, this.endpoints.logs, this.endpoints.traces])
        : token,
      this.control,
      this.buffer,
      (kind, body) => this.sendOtlpJson(kind, body),
    );
    this.logSink = new BatchLogRecordProcessor({
      exporter: new PersistingLogExporter(
        options.logExporter ??
          this.legacy.wrapLogs(
            new OTLPLogExporter({
              url: this.endpoints.logs,
              headers: authHeaders,
            }),
          ),
        () => this.persistence.exporterOutbox(),
        (eventName) => this.canExportLog(eventName),
      ),
      scheduledDelayMillis: exportDelay,
    });
    this.spanSink = new BatchSpanProcessor({
      exporter: new PersistingSpanExporter(
        options.spanExporter ??
          this.legacy.wrapSpans(
            new OTLPTraceExporter({
              url: this.endpoints.traces,
              headers: authHeaders,
            }),
          ),
        () => this.persistence.exporterOutbox(),
        () => this.control.canExport("network"),
      ),
      scheduledDelayMillis: exportDelay,
    });
    if (options.telemetry) {
      this.sessionPersistence = new TelemetryPersistence(
        JSON.stringify([
          token,
          resolveEndpoints(apiUrl).logs,
          "session-metadata",
        ]),
        this.control,
        new RingBuffer<BufferedItem>({ maxBytes: 0, maxAgeMs: 0 }),
        (kind, body) => this.sendOtlpJson(kind, body, false, true),
      );
      this.sessionSink = new BatchLogRecordProcessor({
        exporter: new PersistingLogExporter(
          new OTLPLogExporter({
            url: resolveEndpoints(apiUrl).logs,
            headers: { Authorization: `Bearer ${token}` },
          }),
          () => this.sessionPersistence?.exporterOutbox() ?? null,
          (name) => this.isSessionEvent(name) && this.canExportLog(name),
        ),
        scheduledDelayMillis: exportDelay,
      });
    }
    this.control.onChange(() => this.applySettings());
    if (options.remoteConfig !== false && options.transport !== "legacy")
      this.applyCachedConfig();
  }

  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    this.router = new TelemetryRouter(
      this.control,
      this.buffer,
      { logs: this.logSink, spans: this.spanSink },
      {
        sessionId: () => this.sessions.currentId(),
        globalAttribute: (key) => this.globalAttributes[key],
        enrichLog: (record, signal) => this.enrichLog(record, signal),
        admit: (item) => {
          if (
            item.kind === "log" &&
            ["errors", "control", "webVitals"].includes(
              classifyLog(item.record.eventName),
            )
          )
            return true;
          const body =
            item.kind === "log"
              ? logsToJson([item.record])
              : item.kind === "span"
                ? spansToJson([item.span])
                : item.batch.body;
          let events = 1;
          if (item.kind === "stored") {
            const request = JSON.parse(body);
            events =
              item.batch.kind === "logs"
                ? (request.resourceLogs ?? []).reduce(
                    (n: number, resource: any) =>
                      n +
                      (resource.scopeLogs ?? []).reduce(
                        (m: number, scope: any) =>
                          m + (scope.logRecords ?? []).length,
                        0,
                      ),
                    0,
                  )
                : (request.resourceSpans ?? []).reduce(
                    (n: number, resource: any) =>
                      n +
                      (resource.scopeSpans ?? []).reduce(
                        (m: number, scope: any) =>
                          m + (scope.spans ?? []).length,
                        0,
                      ),
                    0,
                  );
          }
          const accepted = this.collectionBudget.admit(
            this.sessions.currentId(),
            new TextEncoder().encode(body).byteLength,
            events,
          );
          if (!accepted) this.scheduleHealth();
          return accepted;
        },
        observe: (observed) => this.observe(observed),
        sendStored: (batch) => this.persistence.sendStored(batch),
      },
    );

    // Providers are this SDK's own and the instrumentations are bound to them, so an app that runs its own
    // OpenTelemetry keeps its globals and never receives Traceway's records. Only W3C propagation and the context
    // manager are global by nature; they are set when the page has none.
    const attributes: Record<string, string | boolean | string[]> = {
      ...browserResourceAttributes(),
      "service.name":
        this.options.serviceName ||
        (typeof location !== "undefined" && location.hostname) ||
        "browser",
      "service.instance.id": this.instanceId,
      "traceway.sdk.name": SCOPE_NAME,
      "traceway.sdk.version": SDK_VERSION,
    };
    if (this.options.version)
      attributes["service.version"] = this.options.version;
    if (this.options.environment)
      attributes["deployment.environment.name"] = this.options.environment;
    const resource = defaultResource().merge(
      resourceFromAttributes(attributes),
    );
    this.resourceAttributes = { ...resource.attributes };

    this.loggerProvider = new LoggerProvider({
      resource,
      processors: [new ControlLogProcessor(() => this.router, this.logSink)],
    });
    this.tracerProvider = new TracerProvider({
      resource,
      spanProcessors: [
        new ControlSpanProcessor(() => this.router, this.spanSink),
      ],
    });
    this.logger = this.loggerProvider.getLogger(SCOPE_NAME, SDK_VERSION);
    this.ownsPropagator = propagation.setGlobalPropagator(
      new W3CTraceContextPropagator(),
    );
    const contextManager = new StackContextManager();
    contextManager.enable();
    this.ownsContextManager = context.setGlobalContextManager(contextManager);

    this.sessions.start();
    this.persistence.start(this.sessions.currentId());
    this.sessionPersistence?.start(null);

    const telemetryUrls = [
      `${this.endpoints.base}/api/otel/v1/logs`,
      this.endpoints.logs,
      this.endpoints.traces,
      this.endpoints.opamp,
      this.endpoints.recordings,
      `${this.endpoints.base}/api/report`,
    ];
    const ownUrls = new RegExp(
      `^(?:${telemetryUrls.map(escapeRegExp).join("|")})(?:[?#]|$)`,
    );
    const instrumentations: Instrumentation[] = [new ErrorsInstrumentation()];
    if (this.options.captureNetwork !== false) {
      const networkConfig = {
        ignoreUrls: [ownUrls],
        propagateTraceHeaderCorsUrls: this.options.propagateTraceHeaderCorsUrls,
      };
      instrumentations.push(
        new FetchInstrumentation(networkConfig),
        new XhrInstrumentation(networkConfig),
      );
    }
    if (this.options.captureLogs !== false)
      instrumentations.push(new ConsoleInstrumentation());
    if (this.options.captureNavigation !== false)
      instrumentations.push(new NavigationInstrumentation());
    if (this.options.captureUserActions !== false)
      instrumentations.push(new UserActionInstrumentation());
    if (this.options.captureWebVitals !== false)
      instrumentations.push(new WebVitalsInstrumentation());
    if (this.options.captureResourceTiming !== false) {
      instrumentations.push(
        new ResourceTimingInstrumentation(),
        new NavigationTimingInstrumentation(),
      );
    }
    this.deregisterInstrumentations = registerInstrumentations({
      instrumentations,
      tracerProvider: this.tracerProvider,
      loggerProvider: this.loggerProvider,
    });

    this.applySettings();
    if (
      this.options.remoteConfig !== false &&
      this.options.transport !== "legacy"
    )
      this.startOpamp();
    for (const capture of this.readLocalCaptures()) {
      this.streamFor(
        capture.signals,
        capture.replay,
        capture.untilMs,
        true,
        `local:${capture.triggerId}`,
      );
    }
  }

  startInteraction(name: string) {
    const span = this.tracerProvider
      ?.getTracer(SCOPE_NAME, SDK_VERSION)
      .startSpan(name, {
        attributes: { "traceway.interaction": true },
      });
    const interactionContext = span
      ? trace.setSpan(context.active(), span)
      : context.active();
    let ended = false;
    return {
      traceId: span?.spanContext().traceId ?? null,
      run: <T>(callback: () => T): T =>
        context.with(interactionContext, callback),
      bind:
        <Args extends unknown[], Result>(callback: (...args: Args) => Result) =>
        (...args: Args): Result =>
          context.with(interactionContext, () => callback(...args)),
      captureException: (
        error: unknown,
        attributes?: Record<string, string>,
      ) => {
        span?.setStatus({ code: SpanStatusCode.ERROR });
        context.with(interactionContext, () =>
          this.captureException(error, attributes),
        );
      },
      end: () => {
        if (!ended) {
          ended = true;
          span?.end();
        }
      },
    };
  }

  captureException(error: unknown, attributes?: Record<string, string>): void {
    let err: Error;
    if (error instanceof Error) err = error;
    else {
      let message: string;
      try {
        message =
          typeof error === "string"
            ? error
            : (JSON.stringify(error) ?? String(error));
      } catch {
        message = "Non-Error exception (unserializable thrown value)";
      }
      err = new Error(message);
    }
    this.logger?.emit({
      eventName: EVENT_EXCEPTION,
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      attributes: {
        "exception.type": err.name,
        "exception.message": err.message,
        "exception.stacktrace": err.stack || `${err.name}: ${err.message}`,
        ...attributes,
      },
    });
  }

  captureMessage(message: string, attributes?: Record<string, string>): void {
    this.logger?.emit({
      eventName: EVENT_MESSAGE,
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: message,
      attributes: { ...attributes },
    });
  }

  /** A breadcrumb the replay player shows next to the recording, and an event triggers can match. */
  recordAction(
    category: string,
    name: string,
    data?: Record<string, unknown>,
  ): void {
    const attributes: Record<string, string> = {
      "traceway.action.category": category,
      "traceway.action.name": name,
    };
    if (data !== undefined)
      attributes["traceway.action.data"] = JSON.stringify(data);
    this.logger?.emit({
      eventName: EVENT_ACTION,
      severityNumber: SeverityNumber.INFO,
      attributes,
    });
  }

  /** A named app event, e.g. `track("checkout_failed")`. Buffered by default; triggers can match it. */
  track(
    eventName: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    if (!eventName) return;
    this.logger?.emit({
      eventName,
      severityNumber: SeverityNumber.INFO,
      attributes: { ...attributes },
    });
  }

  setAttribute(key: string, value: string): void {
    if (!key) return;
    this.globalAttributes[key] = value;
    this.refreshSession();
  }

  setAttributes(attrs: Record<string, string>): void {
    let changed = false;
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (!key) continue;
      this.globalAttributes[key] = value;
      changed = true;
    }
    if (changed) this.refreshSession();
  }

  removeAttribute(key: string): void {
    if (!(key in this.globalAttributes)) return;
    delete this.globalAttributes[key];
    this.refreshSession();
  }

  clearAttributes(): void {
    if (Object.keys(this.globalAttributes).length === 0) return;
    this.globalAttributes = {};
    this.refreshSession();
  }

  currentAttributes(): Record<string, string> {
    return { ...this.globalAttributes };
  }

  currentSessionId(): string | null {
    return this.sessions.currentId();
  }

  /** Asks Traceway for this client's collection settings now, e.g. right after login set `user.id`. */
  async refreshConfig(): Promise<void> {
    await this.opamp?.refresh();
  }

  /** Sends everything queued for sending. Buffered telemetry stays on the device. */
  async flush(): Promise<void> {
    this.persistBuffer();
    await this.persistence.flush();
    await this.sessionPersistence?.flush();
    await Promise.all([
      this.logSink.forceFlush(),
      this.sessionSink?.forceFlush(),
      this.spanSink.forceFlush(),
      this.recordings.flush(),
    ]);
  }

  async shutdown(): Promise<void> {
    if (this.healthTimer !== null) clearTimeout(this.healthTimer);
    this.healthTimer = null;
    if (this.overrideTimer !== null) clearTimeout(this.overrideTimer);
    this.overrideTimer = null;
    this.opamp?.stop();
    this.opamp = null;
    if (this.describeTimer !== null) clearTimeout(this.describeTimer);
    this.sessions.close();
    this.deregisterInstrumentations?.();
    this.deregisterInstrumentations = null;
    await this.flush().catch(() => undefined);
    this.persistence.stop();
    this.sessionPersistence?.stop();
    this.replay.stop();
    this.sessions.stop();
    await Promise.all([
      this.sessionSink?.shutdown().catch(() => undefined),
      this.loggerProvider?.shutdown().catch(() => undefined),
      this.tracerProvider?.shutdown().catch(() => undefined),
    ]);
    if (this.ownsPropagator) propagation.disable();
    if (this.ownsContextManager) context.disable();
    this.ownsPropagator = this.ownsContextManager = false;
    this.loggerProvider = this.tracerProvider = null;
    this.logger = null;
    this.router = null;
    this.started = false;
  }

  private applySettings(): void {
    const settings = this.control.settings();
    this.runCaptures(settings);
    this.persistence.configure();
    this.sessionPersistence?.configure();
    this.buffer.retain((entry) =>
      this.control.canExport(entry.signal as SignalName),
    );
    this.buffer.configure({
      maxBytes: settings.buffer.maxBytes,
      maxAgeMs: settings.buffer.maxAgeSeconds * 1000,
    });
    this.triggers.setTriggers(settings.triggers);
    this.applyReplay();
  }

  private persistBuffer(): void {
    const session = this.sessions.current();
    if (session) this.persistence.save(session.id);
  }

  private canExportLog(eventName: string | undefined): boolean {
    const signal = classifyLog(eventName);
    if (signal !== "control") return this.control.canExport(signal);
    if (!this.control.enabled()) return false;
    return (
      ![EVENT_SESSION_START, EVENT_SESSION_END, EVENT_SESSION_UPDATE].includes(
        eventName ?? "",
      ) || this.control.settings().sessions.enabled
    );
  }

  private telemetryHeaders(): Record<string, string> {
    return this.options.telemetry
      ? { ...this.options.telemetry.headers }
      : { Authorization: `Bearer ${this.token}` };
  }

  private async sendOtlpJson(
    kind: StoredBatch["kind"],
    body: string,
    keepalive = false,
    sessionMetadata = false,
  ): Promise<SendResult> {
    body = filterRequest(
      kind,
      body,
      (name) => this.canExportLog(name),
      () => this.control.canExport("network"),
    );
    if (!body) return "drop";
    try {
      await this.legacy.ready;
      if (this.legacy.enabled) {
        if (kind === "traces") return "sent";
        const response = await this.legacy.sendLogs(body, keepalive);
        return response.ok
          ? "sent"
          : response.status === 429 || response.status >= 500
            ? "retry"
            : "drop";
      }
      const response = await fetch(
        sessionMetadata
          ? `${this.endpoints.base}/api/otel/v1/logs`
          : kind === "logs"
            ? this.endpoints.logs
            : this.endpoints.traces,
        {
          method: "POST",
          keepalive:
            keepalive && new TextEncoder().encode(body).byteLength < 60 * 1024,
          headers: {
            ...(sessionMetadata
              ? { Authorization: `Bearer ${this.token}` }
              : this.telemetryHeaders()),
            "Content-Type": "application/json",
          },
          body,
        },
      );
      if (response.ok) return "sent";
      return response.status === 429 || response.status >= 500
        ? "retry"
        : "drop";
    } catch {
      return "retry";
    }
  }

  private configCacheKey(): string {
    return `traceway:config:${this.token}`;
  }

  private applyCachedConfig(): void {
    const raw = storageGet(this.configCacheKey());
    if (!raw) return;
    try {
      const cached = JSON.parse(raw) as { hash?: string; body?: string };
      if (typeof cached.body !== "string" || typeof cached.hash !== "string")
        return;
      this.control.applyRemote(parseSettingsDocument(cached.body));
      this.appliedConfigHash = Uint8Array.from(
        cached.hash.match(/../g) ?? [],
        (b) => parseInt(b, 16),
      );
    } catch {
      // A cache this SDK cannot read is ignored; the first poll replaces it.
    }
  }

  private startOpamp(): void {
    const instanceUid = uuidToBytes(this.instanceId);
    if (!instanceUid || typeof fetch === "undefined") return;
    let connected = false;
    const canUseLegacy =
      this.options.transport !== "otlp" && !this.options.telemetry;
    this.opamp = new OpampHttpClient({
      endpoint: this.endpoints.opamp,
      headers: { Authorization: `Bearer ${this.token}` },
      instanceUid,
      capabilities:
        AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsRemoteConfig |
        AgentCapabilities.ReportsHeartbeat,
      customCapabilities: [
        "io.traceway.sdk.buffer/v1",
        "io.traceway.sdk.capture/v1",
      ],
      appliedConfigHash: this.appliedConfigHash,
      describe: () => this.describe(),
      onRemoteConfig: (config) => this.applyRemoteConfig(config),
      onUnavailable: () => {
        if (!connected && canUseLegacy) this.legacy.enabled = true;
      },
      onConnected: () => {
        connected = true;
        this.legacy.enabled = false;
      },
      onUnsupported: () => {
        if (canUseLegacy) {
          this.legacy.enabled = true;
          this.control.applyRemote({});
        }
      },
      onUnauthorized: () => {
        if (this.options.debug)
          console.warn(
            "Traceway: the project token was rejected; remote config is off",
          );
      },
    });
    this.opamp.start();
    this.legacy.ready = this.opamp.poll();
  }

  /**
   * What the server targets rules at: the resource (app, release, browser, OS), the session and every global
   * attribute, such as `user.id`, set with setAttribute.
   */
  private describe(): {
    identifying: Record<string, AttributeValue>;
    nonIdentifying: Record<string, AttributeValue>;
  } {
    const nonIdentifying: Record<string, AttributeValue> = {};
    for (const [key, value] of Object.entries(this.resourceAttributes)) {
      if (key === "service.name" || key === "service.instance.id") continue;
      if (
        typeof value === "string" ||
        typeof value === "boolean" ||
        typeof value === "number"
      )
        nonIdentifying[key] = value;
      else if (Array.isArray(value)) nonIdentifying[key] = value.map(String);
    }
    let count = 0;
    for (const [key, value] of Object.entries(this.globalAttributes)) {
      if (count++ >= 64) break;
      if (key.length <= 128 && value.length <= 1024)
        nonIdentifying[key] = value;
    }
    const sessionId = this.sessions.currentId();
    if (sessionId) nonIdentifying[ATTR_SESSION_ID] = sessionId;
    return {
      identifying: {
        "service.name": String(
          this.resourceAttributes["service.name"] ?? "browser",
        ),
        "service.instance.id": this.instanceId,
      },
      nonIdentifying,
    };
  }

  private applyRemoteConfig(config: RemoteConfig) {
    const object = config.configMap.traceway;
    const body = object ? new TextDecoder().decode(object.body) : "{}";
    let overlay: Record<string, unknown>;
    try {
      overlay = parseSettingsDocument(body);
    } catch (err) {
      return {
        applied: false as const,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
    this.control.applyRemote(overlay);
    const hash = Array.from(config.configHash, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    storageSet(this.configCacheKey(), JSON.stringify({ hash, body }));
    this.logger?.emit({
      eventName: EVENT_CONFIG_APPLIED,
      severityNumber: SeverityNumber.INFO,
      attributes: { "traceway.config.hash": hash },
    });
    return { applied: true as const };
  }

  /** A targeting attribute changed: ask for the matching settings soon, once for a burst of changes. */
  private describeChanged(): void {
    if (!this.opamp || this.describeTimer !== null) return;
    this.describeTimer = setTimeout(() => {
      this.describeTimer = null;
      void this.opamp?.poll();
    }, 2_000);
  }

  private capturesKey(): string {
    return `traceway:captures:${this.token}`;
  }

  /**
   * Starts the dashboard's captures aimed at this client. The lookback flush runs once per capture, remembered
   * across pages; streaming lasts until the capture's end on every page that sees it.
   */
  private runCaptures(settings: Settings): void {
    if (!this.started) return;
    this.control.setOverrides(
      "remote",
      settings.captures.map((capture) => ({
        signals: capture.signals ?? ["*"],
        replay: capture.replay === true,
        untilMs: Date.parse(capture.until),
        includeOff: true,
      })),
    );
    this.scheduleOverrideExpiry();
    const now = Date.now();
    let done: Array<{ id: string; untilMs: number }> = [];
    try {
      done = (
        JSON.parse(storageGet(this.capturesKey(), true) ?? "[]") as Array<{
          id: string;
          untilMs: number;
        }>
      ).filter((c) => c.untilMs > now);
    } catch {
      done = [];
    }
    let changed = false;
    for (const capture of settings.captures) {
      const untilMs = Date.parse(capture.until);
      if (!(untilMs > now)) continue;
      if (done.some((c) => c.id === capture.id)) continue;
      const lookbackSeconds = capture.lookbackSeconds ?? 600;
      if (lookbackSeconds > 0)
        this.runAction({
          type: "flush",
          lookbackSeconds,
          signals: capture.signals ?? ["*"],
          replay: capture.replay === true,
        });
      this.logger?.emit({
        eventName: EVENT_CAPTURE_STARTED,
        severityNumber: SeverityNumber.INFO,
        attributes: { "traceway.capture.id": capture.id },
      });
      done.push({ id: capture.id, untilMs });
      changed = true;
    }
    if (changed) storageSet(this.capturesKey(), JSON.stringify(done), true);
  }

  private applyReplay(): void {
    if (!this.started) return;
    const settings = this.control.settings();
    const session = this.sessions.current();
    this.replay.apply(this.control.replayMode(), {
      maskAllInputs: settings.replay.maskAllInputs,
      sessionSampled:
        session !== null &&
        unitHash(session.id) < settings.replay.sessionSampleRate,
      maxBytes: settings.buffer.replayMaxBytes,
      maxAgeMs: settings.buffer.maxAgeSeconds * 1000,
    });
  }

  private scheduleHealth(): void {
    if (this.healthTimer !== null) return;
    this.healthTimer = setTimeout(() => {
      this.healthTimer = null;
      this.logger?.emit({
        eventName: "traceway.collection.health",
        severityNumber: SeverityNumber.INFO,
        attributes: {
          ...this.collectionBudget.snapshot(),
          "traceway.error.suppressed_total": this.errorLimiter.totalSuppressed,
          "traceway.context.evicted": this.buffer.evictedCount,
          "traceway.replay.failed_segments": this.recordings.failedSegments,
        },
      });
      const session = this.sessions.current();
      if (session) this.emitSessionEvent(EVENT_SESSION_UPDATE, session);
    }, 1000);
  }

  private enrichLog(record: SdkLogRecord, signal: RecordSignal): boolean {
    if (signal !== "errors" && signal !== "messages" && signal !== "custom")
      return true;
    const inheritedAttributes =
      signal === "custom"
        ? this.globalAttributes
        : { ...collectDefaultAttributes(), ...this.globalAttributes };
    for (const [key, value] of Object.entries(inheritedAttributes)) {
      if (record.attributes[key] === undefined) record.setAttribute(key, value);
    }
    if (signal === "custom") return true;

    const attrs = record.attributes;
    const type =
      attrs["exception.type"] === undefined
        ? undefined
        : String(attrs["exception.type"]);
    const message =
      signal === "messages"
        ? typeof record.body === "string"
          ? record.body
          : String(attrs["exception.message"] ?? "")
        : attrs["exception.message"] === undefined
          ? undefined
          : String(attrs["exception.message"]);
    const stack =
      attrs["exception.stacktrace"] === undefined
        ? undefined
        : String(attrs["exception.stacktrace"]);
    // Patterns match the "Type: message" line only: matching stack frames would let a function named like a
    // pattern (any handleTimeout for the default /timeout/i) silence every error that passes through it.
    if (
      this.ignored(
        type && message ? `${type}: ${message}` : (message ?? type ?? ""),
      )
    ) {
      return false;
    }
    if (this.options.beforeCapture) {
      try {
        if (
          this.options.beforeCapture({
            type,
            message,
            stack,
            attributes: { ...attrs },
          }) === false
        )
          return false;
      } catch (err) {
        if (this.options.debug)
          console.error("Traceway: beforeCapture callback threw:", err);
      }
    }
    if (signal === "messages" && attrs[ATTR_EXCEPTION_ID] === undefined)
      record.setAttribute(ATTR_EXCEPTION_ID, generateUUID());
    if (signal === "errors") {
      const suppressed = this.errorLimiter.accept(
        JSON.stringify([type, message, stack]),
      );
      if (suppressed === null) {
        this.scheduleHealth();
        return false;
      }
      if (suppressed > 0)
        record.setAttribute("traceway.error.suppressed_count", suppressed);
      trace
        .getSpan(context.active())
        ?.setStatus({ code: SpanStatusCode.ERROR });
      if (attrs[ATTR_EXCEPTION_ID] === undefined)
        record.setAttribute(ATTR_EXCEPTION_ID, generateUUID());
      if (stack && attrs[ATTR_DEBUG_IDS] === undefined) {
        const debugIds = debugIdsForStackTrace(stack);
        if (debugIds)
          record.setAttribute(ATTR_DEBUG_IDS, JSON.stringify(debugIds));
      }
    }
    return true;
  }

  private ignored(text: string): boolean {
    for (const pattern of this.ignoreErrors) {
      if (typeof pattern === "string") {
        if (text.includes(pattern)) return true;
      } else {
        pattern.lastIndex = 0;
        if (pattern.test(text)) return true;
      }
    }
    return false;
  }

  private isSessionEvent(name: string | undefined): boolean {
    return (
      name === EVENT_SESSION_START ||
      name === EVENT_SESSION_END ||
      name === EVENT_SESSION_UPDATE
    );
  }

  private observe(observed: ObservedRecord): void {
    this.legacy.observe(observed);
    if (
      this.legacy.enabled &&
      observed.signal === "messages" &&
      observed.routed === "stream"
    ) {
      this.runAction(
        { type: "flush", signals: ["*"], lookbackSeconds: 30, replay: true },
        String(observed.lookup(`attributes.${ATTR_EXCEPTION_ID}`)),
      );
    }
    if (
      observed.routed === "stream" &&
      observed.item.kind === "log" &&
      this.isSessionEvent(observed.item.record.eventName)
    ) {
      this.sessionSink?.onEmit(observed.item.record as SdkLogRecord);
    }
    this.persistence.checkpoint(this.sessions.currentId());
    if (observed.signal === "control") return;
    if (this.options.captureHttpServerErrors && observed.item.kind === "span") {
      const status = observed.item.span.attributes["http.response.status_code"];
      if (typeof status === "number" && status >= 500) {
        const method = String(
          observed.item.span.attributes["http.request.method"] ?? "",
        );
        const url = String(observed.item.span.attributes["url.full"] ?? "");
        this.captureMessage(`HTTP ${status} ${method} ${url}`, {
          "http.request.method": method,
          "url.full": url,
          "http.response.status_code": String(status),
        });
      }
    }
    if (!this.control.enabled()) return;
    const fired = this.triggers.observe({
      timeMs: observed.timeMs,
      lookup: observed.lookup,
    });
    if (observed.signal === "errors" && observed.item.kind === "log") {
      const record = observed.item.record as SdkLogRecord;
      const defaultTrigger = this.control
        .settings()
        .triggers.find((trigger) => trigger.id === "default-exception");
      const replayRequested = fired.some((trigger) =>
        trigger.actions.some((action) => "replay" in action && action.replay),
      );
      record.setAttribute(
        "traceway.replay.status",
        this.control.replayMode() === "off"
          ? "disabled"
          : replayRequested
            ? "requested"
            : (this.triggers.skipped.get("default-exception") ??
              (defaultTrigger?.enabled === false
                ? "trigger_disabled"
                : "not_triggered")),
      );
      const contextActions =
        defaultTrigger?.actions.filter(
          (action) => action.type === "flush" && !action.replay,
        ) ?? [];
      const skipped = this.triggers.skipped.get("default-exception");
      if (skipped === "cooldown" || skipped === "session_clip_limit") {
        for (const action of contextActions) this.runAction(action);
      }
      record.setAttribute(
        "traceway.context.lookback_seconds",
        Math.max(
          0,
          ...contextActions.map((action) =>
            action.type === "flush" ? action.lookbackSeconds : 0,
          ),
        ),
      );
      record.setAttribute("traceway.context.evicted", this.buffer.evictedCount);
      for (const [key, value] of Object.entries(
        this.collectionBudget.snapshot(),
      ))
        record.setAttribute(key, value);
    }
    if (fired.length > 0)
      storageSet(
        `traceway:trigger-limits:${this.token}`,
        JSON.stringify({
          sessionId: this.sessions.currentId(),
          limits: this.triggers.sessionLimits,
        }),
        true,
      );
    for (const trigger of fired) this.runTrigger(trigger);
    if (observed.signal === "errors" && observed.item.kind === "log") {
      const record = observed.item.record as SdkLogRecord;
      if (
        record.attributes["traceway.replay.status"] === "requested" &&
        this.replay.lastFlushSegments === 0
      )
        record.setAttribute(
          "traceway.replay.status",
          this.collectionBudget.snapshot()["traceway.collection.dropped"]! > 0
            ? "collection_limit"
            : "buffer_unavailable",
        );
    }
    if (fired.length > 0) this.router?.sendIfStreaming(observed);
  }

  private runTrigger(fired: FiredTrigger): void {
    const exceptionId = fired.cause.lookup(`attributes.${ATTR_EXCEPTION_ID}`);
    for (const action of fired.actions) {
      this.runAction(
        action,
        typeof exceptionId === "string" ? exceptionId : undefined,
        fired.trigger.id,
      );
    }
    const attributes: Record<string, string> = {
      "traceway.trigger.id": fired.trigger.id,
    };
    if (fired.trigger.name)
      attributes["traceway.trigger.name"] = fired.trigger.name;
    this.logger?.emit({
      eventName: EVENT_TRIGGER_FIRED,
      severityNumber: SeverityNumber.INFO,
      attributes,
    });
  }

  runAction(
    action: TriggerAction,
    exceptionId?: string,
    triggerId?: string,
  ): void {
    const now = Date.now();
    switch (action.type) {
      case "flush":
        this.router?.flushBuffered(
          now - action.lookbackSeconds * 1000,
          selectorSet(action.signals),
          now,
        );
        this.persistence.afterRestore(() =>
          this.router?.flushBuffered(
            now - action.lookbackSeconds * 1000,
            selectorSet(action.signals),
            now,
          ),
        );
        if (action.replay)
          this.replay.flush(
            action.lookbackSeconds * 1000,
            exceptionId,
            this.unloading,
          );
        return;
      case "stream":
        this.streamFor(
          action.signals ?? ["*"],
          action.replay === true,
          now + action.durationSeconds * 1000,
        );
        return;
      case "startReplay":
        this.streamFor([], true, now + action.durationSeconds * 1000);
        return;
      case "emit":
        this.logger?.emit({
          eventName: action.eventName,
          severityNumber: SeverityNumber.INFO,
          attributes: { ...action.attributes },
        });
        return;
      case "capture":
        this.startLocalCapture(action, exceptionId, triggerId ?? "local");
        return;
    }
  }

  private localCapturesKey(): string {
    return `traceway:local-captures:${this.token}`;
  }

  private readLocalCaptures(): LocalCapture[] {
    try {
      const now = Date.now();
      return (
        JSON.parse(
          storageGet(this.localCapturesKey()) ?? "[]",
        ) as LocalCapture[]
      ).filter((c) => c.untilMs > now);
    } catch {
      return [];
    }
  }

  /**
   * A capture a trigger started on this device. It is kept in localStorage, so the next pages keep streaming until
   * it ends; while it runs, the same trigger only extends it instead of uploading the lookback again.
   */
  private startLocalCapture(
    action: Extract<TriggerAction, { type: "capture" }>,
    exceptionId: string | undefined,
    triggerId: string,
  ): void {
    const now = Date.now();
    const untilMs = now + action.durationSeconds * 1000;
    const signals = action.signals ?? ["*"];
    const replay = action.replay === true;
    const captures = this.readLocalCaptures();
    const running = captures.find((c) => c.triggerId === triggerId);
    if (running) {
      running.untilMs = Math.max(running.untilMs, untilMs);
    } else {
      captures.push({
        id: `${triggerId}:${now}`,
        triggerId,
        untilMs,
        signals,
        replay,
      });
      this.runAction(
        {
          type: "flush",
          lookbackSeconds: action.lookbackSeconds ?? 60,
          signals,
          replay,
        },
        exceptionId,
      );
      this.logger?.emit({
        eventName: EVENT_CAPTURE_STARTED,
        severityNumber: SeverityNumber.INFO,
        attributes: {
          "traceway.capture.id": `${triggerId}:${now}`,
          "traceway.capture.source": "trigger",
          "traceway.trigger.id": triggerId,
          "traceway.capture.until": new Date(untilMs).toISOString(),
        },
      });
    }
    this.streamFor(
      signals,
      replay,
      running?.untilMs ?? untilMs,
      true,
      `local:${triggerId}`,
    );
    storageSet(this.localCapturesKey(), JSON.stringify(captures));
  }

  /** `capture` brings back signals rules switched off, see `StreamOverride.includeOff`. */
  private streamFor(
    signals: SignalSelector,
    replay: boolean,
    untilMs: number,
    capture = false,
    owner?: string,
  ): void {
    const override = { signals, replay, untilMs, includeOff: capture };
    if (owner) this.control.setOverrides(owner, [override]);
    else this.control.addOverride(override);
    this.applyReplay();
    this.scheduleOverrideExpiry();
  }

  private scheduleOverrideExpiry(): void {
    if (this.overrideTimer !== null) clearTimeout(this.overrideTimer);
    this.overrideTimer = null;
    const expiry = this.control.nextOverrideExpiry();
    if (expiry === undefined) return;
    this.overrideTimer = setTimeout(
      () => {
        this.overrideTimer = null;
        this.applyReplay();
        this.scheduleOverrideExpiry();
      },
      Math.max(0, expiry - Date.now()) + 1,
    );
  }

  private emitSessionEvent(
    eventName: string,
    session: SessionInfo,
    timestampMs?: number,
  ): void {
    if (!this.control.settings().sessions.enabled) return;
    this.logger?.emit({
      eventName,
      severityNumber: SeverityNumber.INFO,
      timestamp: timestampMs,
      attributes: {
        ...collectDefaultAttributes(),
        ...this.sessions.entryAttributes(),
        ...this.globalAttributes,
        [ATTR_SESSION_ID]: session.id,
        [ATTR_SESSION_STARTED_AT]: session.startedAtMs,
        ...this.collectionBudget.snapshot(),
        "traceway.error.suppressed_total": this.errorLimiter.totalSuppressed,
        "traceway.context.evicted": this.buffer.evictedCount,
        "traceway.replay.failed_segments": this.recordings.failedSegments,
      },
    });
  }

  private refreshSession(): void {
    const session = this.sessions.current();
    if (session) this.emitSessionEvent(EVENT_SESSION_UPDATE, session);
    this.describeChanged();
  }

  private onSessionStart(session: SessionInfo, resumed: boolean): void {
    this.collectionBudget.admit(session.id, 0, 0);
    this.unloading = false;
    this.triggers.resetSession();
    try {
      const saved = JSON.parse(
        storageGet(`traceway:trigger-limits:${this.token}`, true) ?? "{}",
      );
      if (saved.sessionId === session.id)
        this.triggers.restoreSessionLimits(saved.limits);
    } catch {}
    this.replay.onSessionStart();
    this.emitSessionEvent(
      resumed ? EVENT_SESSION_UPDATE : EVENT_SESSION_START,
      session,
    );
    this.applyReplay();
    this.describeChanged();
  }

  private onSessionEnd(
    session: SessionInfo,
    endedAtMs: number,
    unloading: boolean,
  ): void {
    this.unloading = unloading;
    if (unloading) this.persistBuffer();
    this.replay.onSessionEnd(unloading);
    this.emitSessionEvent(EVENT_SESSION_END, session, endedAtMs);
    if (unloading) void this.flush().catch(() => undefined);
  }

  private onHidden(): void {
    this.persistBuffer();
    this.replay.onHidden();
    void this.flush().catch(() => undefined);
  }

  private onVisible(): void {
    this.unloading = false;
    this.replay.onVisible();
    if (
      this.opamp &&
      this.opamp.millisSinceLastPoll() >= this.opamp.pollIntervalMs()
    )
      void this.opamp.poll();
    void this.persistence.exporterOutbox()?.drain();
  }
}
