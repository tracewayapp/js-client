import { version as packageVersion } from "../package.json";
import {
  listenForSequenceActions,
  hasSequenceEvent,
} from "./sequence-listener.js";
import { RoutingLogExporter } from "./transport/routing-logs.js";
import { LegacyTransport } from "./transport/legacy.js";
import { forgetJson, recordJson } from "./persistence/otlp-json.js";
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
import { UserActionInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/user-action";
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
  CollectionSettings,
  FieldLookup,
  FiredTrigger,
  Settings,
  SignalName,
  SignalSelector,
  TracewayEndpoints,
  TriggerAction,
} from "@tracewayapp/core";
import {
  applyOverlay,
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
import { LongTaskInstrumentation } from "./otel/long-tasks.js";
import { RouteTimingInstrumentation } from "./otel/route-timing.js";
import { WebVitalsInstrumentation } from "./otel/web-vitals.js";
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
import { MetricsRecorder } from "./otel/metrics-recorder.js";
import { findRoute } from "./otel/route-detect.js";
import { TelemetryPersistence } from "./persistence/telemetry-persistence.js";
import type { StoredBatch } from "./persistence/idb.js";
import { filterRequest } from "./persistence/otlp-json.js";
import type { SendResult } from "./persistence/outbox.js";
import {
  PersistingLogExporter,
  PersistingSpanExporter,
} from "./persistence/persisting-exporters.js";

export const SDK_VERSION = packageVersion;
const SCOPE_NAME = "@tracewayapp/frontend";
const HEALTH_DELAY_MS = 1_000;
const MAX_HEALTH_DELAY_MS = 300_000;
/** A flush hands the whole buffer to the batch processor at once; its default queue of 2048 drops the rest. */
const FLUSH_QUEUE_SIZE = 16_384;

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

export interface TelemetryEndpoint {
  /** Full OTLP/HTTP signal URL, including /v1/logs, /v1/traces or /v1/metrics. */
  url: string;
  headers?: Record<string, string>;
}

export interface TelemetryOptions {
  /** Base URL; /v1/logs, /v1/traces and /v1/metrics are appended. */
  url?: string;
  headers?: Record<string, string>;
  logs?: TelemetryEndpoint;
  traces?: TelemetryEndpoint;
  metrics?: TelemetryEndpoint;
}

export interface StandaloneOptions extends TracewayFrontendOptions {
  telemetry: TelemetryOptions;
}

export interface TracewayFrontendOptions {
  /** Local defaults, with the same collection schema as OpAMP. Remote policy overlays these when enabled. */
  collection?: CollectionSettings;
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
  /** Stream every replay segment and every breadcrumb by default instead of keeping them for error clips. Default false. */
  recordAllSessions?: boolean;
  /** Record session start and end. Default true. */
  sessions?: boolean;
  /** Share of sessions streaming buffered breadcrumbs and network spans; replay is unaffected. Default 0. */
  baselineSampleRate?: number;
  /** Local protection against repeated errors and error storms. */
  errorLimits?: Partial<ErrorLimits>;
  /** Diagnostic uploads per session: 50 MiB and 10,000 events by default. Developer options may lower these ceilings. */
  collectionLimits?: Partial<CollectionLimits>;

  /**
   * The following allow a signal at all; collection settings, local or remote, can only restrict them further.
   * All default true. Allowing a signal does not start it: resource timing, long task and route timing events
   * are off in the default collection settings until `collection`, a rule, a trigger or a capture turns them on.
   */
  captureLogs?: boolean;
  captureNetwork?: boolean;
  captureNavigation?: boolean;
  captureUserActions?: boolean;
  captureWebVitals?: boolean;
  captureResourceTiming?: boolean;
  /** Main-thread blocks of 50 ms or more. */
  captureLongTasks?: boolean;
  /** How long single-page-app route changes take to render. */
  captureRouteTiming?: boolean;
  /**
   * Performance metrics: histograms and counters aggregated on the device and uploaded as one small payload per
   * flush. Independent of the events above, which stay on the device until a trigger or capture asks. Default true.
   */
  captureMetrics?: boolean;
  /**
   * Dimensions of your own on every performance metric, e.g. `{ plan: "pro" }`, to break dashboards down by them.
   * At most two keys (`[a-z][a-z0-9_]`, up to 32 characters) with a small set of values each: never a user id.
   */
  metricDimensions?: Record<string, string>;
  /**
   * Name each view by the route template of the app's router (`/orders/:id`) when the router can be read from
   * the page: React Router in framework mode, Remix, TanStack Router, the Next.js Pages Router, Vue Router and
   * Nuxt, or a router passed to `trackRouter`. `setRoute` wins over it. Default true.
   */
  detectRoutes?: boolean;

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
   * OTLP/HTTP base URL and/or per-signal endpoints for logs, traces and metrics.
   * OpAMP and replay stay on Traceway. Traceway credentials are never forwarded.
   */
  telemetry?: TelemetryOptions;

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
  private stopSequenceActions: (() => void) | null = null;
  private sequencePageObserved = false;
  private savedTriggerProgress = "";

  private savedProgressVersion = -1;

  private saveTriggerProgress(): void {
    if (this.triggers.progressVersion === this.savedProgressVersion) return;
    this.savedProgressVersion = this.triggers.progressVersion;
    const progress = JSON.stringify({
      sessionId: this.sessions.currentId(),
      progress: this.triggers.snapshotProgress(),
    });
    if (progress === this.savedTriggerProgress) return;
    this.savedTriggerProgress = progress;
    storageSet(`traceway:trigger-progress:${this.token}`, progress, true);
  }

  private restoreTriggerProgress(): void {
    try {
      const saved = JSON.parse(
        storageGet(`traceway:trigger-progress:${this.token}`, true) ?? "{}",
      );
      if (saved.sessionId === this.sessions.currentId())
        this.triggers.restoreProgress(saved.progress);
    } catch {}
  }

  private readonly sessions: SessionManager;
  private readonly replay: ReplayController;
  private readonly recordings: RecordingsTransport;
  private tracewaySink: BatchLogRecordProcessor | null = null;
  private tracewayPersistence: TelemetryPersistence | null = null;
  private readonly errorLimiter: ErrorLimiter;
  private readonly collectionBudget: CollectionBudget;
  private healthTimer: ReturnType<typeof setTimeout> | null = null;
  private healthDelayMs = HEALTH_DELAY_MS;
  private healthReported = false;
  /** Whether the server has answered (or failed to) since this page started; see runCaptures. */
  private capturesConfirmed = false;
  private readonly logSink: BatchLogRecordProcessor;
  private readonly spanSink: BatchSpanProcessor;
  private globalAttributes: Record<string, string>;
  private router: TelemetryRouter | null = null;
  private logger: Logger | null = null;
  private loggerProvider: LoggerProvider | null = null;
  private tracerProvider: TracerProvider | null = null;
  private deregisterInstrumentations: (() => void) | null = null;
  private routeTiming: RouteTimingInstrumentation | null = null;
  private readonly metrics: MetricsRecorder;
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

  constructor(
    connectionString: string | StandaloneOptions,
    options: TracewayFrontendOptions = {},
  ) {
    const standalone = typeof connectionString !== "string";
    if (standalone) {
      options = {
        ...connectionString,
        remoteConfig: false,
        transport: "otlp",
        sessionRecording: false,
        sessions: false,
      };
      if (
        !options.telemetry?.url &&
        !(
          options.telemetry?.logs &&
          options.telemetry?.traces &&
          options.telemetry?.metrics
        )
      ) {
        throw new Error(
          "Standalone telemetry requires a base URL or all three signal endpoints",
        );
      }
    }
    if (options.telemetry && options.transport === "legacy") {
      throw new Error("External telemetry requires OTLP transport");
    }
    const { token, apiUrl } =
      typeof connectionString === "string"
        ? parseConnectionString(connectionString)
        : {
            token: `otel:${JSON.stringify([options.telemetry?.url, options.telemetry?.logs?.url, options.telemetry?.traces?.url, options.telemetry?.metrics?.url])}`,
            apiUrl: "",
          };
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
    for (const kind of ["logs", "traces", "metrics"] as const) {
      const destination = options.telemetry?.[kind];
      const base = options.telemetry?.url;
      if (!destination && !base) continue;
      const url = new URL(destination?.url ?? base!);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error(
          "telemetry.url must be an HTTP(S) URL without credentials, query, or fragment",
        );
      }
      this.endpoints[kind] = destination
        ? url.toString()
        : url.toString().replace(/\/+$/, "") + `/v1/${kind}`;
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
      applyOverlay(
        defaultSettings({
          recordAllSessions: options.recordAllSessions,
          baselineSampleRate: options.baselineSampleRate,
        }),
        parseSettingsDocument(JSON.stringify(options.collection ?? {})),
      ),
      ceilingsFrom({
        sessionRecording: options.sessionRecording,
        captureLogs: options.captureLogs,
        captureNetwork: options.captureNetwork,
        captureNavigation: options.captureNavigation,
        captureUserActions: options.captureUserActions,
        captureWebVitals: options.captureWebVitals,
        captureResourceTiming: options.captureResourceTiming,
        captureLongTasks: options.captureLongTasks,
        captureRouteTiming: options.captureRouteTiming,
        captureMetrics: options.captureMetrics,
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
      exporter: new RoutingLogExporter(
        new PersistingLogExporter(
          options.logExporter ??
            this.legacy.wrapLogs(
              new OTLPLogExporter({
                url: this.endpoints.logs,
                headers: this.telemetryHeaders("logs"),
              }),
            ),
          () => this.persistence.exporterOutbox(),
          (eventName) => this.canExportLog(eventName),
        ),
        (record) => {
          if (!this.tracewaySink || !this.isTracewayLog(record.eventName))
            return false;
          this.tracewaySink.onEmit(record as SdkLogRecord);
          return true;
        },
      ),
      scheduledDelayMillis: exportDelay,
      maxQueueSize: FLUSH_QUEUE_SIZE,
    });
    this.spanSink = new BatchSpanProcessor({
      exporter: new PersistingSpanExporter(
        options.spanExporter ??
          this.legacy.wrapSpans(
            new OTLPTraceExporter({
              url: this.endpoints.traces,
              headers: this.telemetryHeaders("traces"),
            }),
          ),
        () => this.persistence.exporterOutbox(),
        () => this.control.canExport("network"),
      ),
      scheduledDelayMillis: exportDelay,
      maxQueueSize: FLUSH_QUEUE_SIZE,
    });
    if (!standalone && (options.telemetry?.url || options.telemetry?.logs)) {
      this.tracewayPersistence = new TelemetryPersistence(
        JSON.stringify([
          token,
          resolveEndpoints(apiUrl).logs,
          "session-metadata",
        ]),
        this.control,
        new RingBuffer<BufferedItem>({ maxBytes: 0, maxAgeMs: 0 }),
        (kind, body) => this.sendOtlpJson(kind, body, false, true),
      );
      this.tracewaySink = new BatchLogRecordProcessor({
        exporter: new PersistingLogExporter(
          new OTLPLogExporter({
            url: resolveEndpoints(apiUrl).logs,
            headers: { Authorization: `Bearer ${token}` },
          }),
          () => this.tracewayPersistence?.exporterOutbox() ?? null,
          (name) => this.isTracewayLog(name) && this.canExportLog(name),
        ),
        scheduledDelayMillis: exportDelay,
        maxQueueSize: FLUSH_QUEUE_SIZE,
      });
    }
    const metricsStorageKey =
      options.telemetry?.url || options.telemetry?.metrics
        ? JSON.stringify([this.token, this.endpoints.metrics])
        : this.token;
    this.metrics = new MetricsRecorder({
      control: this.control,
      sessionId: () => this.sessions.currentId(),
      resource: () => this.resourceAttributes,
      send: (body, keepalive) => this.sendMetrics(body, keepalive),
      scope: { name: SCOPE_NAME, version: SDK_VERSION },
      storage: {
        get: (name) =>
          storageGet(`traceway:metrics:${name}:${metricsStorageKey}`),
        set: (name, value) =>
          storageSet(`traceway:metrics:${name}:${metricsStorageKey}`, value),
      },
      profileId: () => this.instanceId,
      dimensions: options.metricDimensions,
      detectRoute: options.detectRoutes === false ? undefined : findRoute,
    });
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
            item.kind === "stored" ? item.batch.body : recordJson(item);
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
    // Tells the server the numbers of the performance events below arrive as aggregates, so it does not count
    // an uploaded event a second time.
    if (this.options.captureMetrics !== false && !this.legacy.enabled)
      attributes["traceway.metrics"] = "aggregated";
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
        new ControlSpanProcessor(
          () => this.router,
          this.spanSink,
          () => this.routeTiming,
          (span) => this.metrics.onRequest(span),
        ),
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
    this.tracewayPersistence?.start(null);

    const telemetryUrls = [
      `${this.endpoints.base}/api/otel/v1/logs`,
      this.endpoints.logs,
      this.endpoints.traces,
      this.endpoints.metrics,
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
    // web-vitals 6 calls Array.prototype.at, which browsers before Chrome 92 and Safari 15.4 lack: there every
    // reported metric would throw a TypeError and arrive as an issue.
    if (
      this.options.captureWebVitals !== false &&
      typeof Array.prototype.at === "function"
    )
      instrumentations.push(new WebVitalsInstrumentation());
    if (this.options.captureResourceTiming !== false)
      instrumentations.push(new NavigationTimingInstrumentation());
    if (this.options.captureLongTasks !== false) {
      const longTasks = new LongTaskInstrumentation();
      longTasks.sink = this.metrics;
      instrumentations.push(longTasks);
    }
    // Route changes also split the page's metrics into views, so they are followed even when the route
    // timing event itself is switched off.
    const measureRoutes = this.options.captureRouteTiming !== false;
    if (measureRoutes || this.options.captureMetrics !== false) {
      const routes = new RouteTimingInstrumentation(measureRoutes);
      routes.sink = this.metrics;
      if (measureRoutes) this.routeTiming = routes;
      instrumentations.push(routes);
    }
    this.deregisterInstrumentations = registerInstrumentations({
      instrumentations,
      tracerProvider: this.tracerProvider,
      loggerProvider: this.loggerProvider,
    });
    if (this.options.captureResourceTiming !== false)
      this.startResourceTiming(ownUrls);
    this.metrics.start();
    const sessionId = this.sessions.currentId();
    if (sessionId) this.metrics.sessionStarted(sessionId);

    this.applySettings();
    if (
      this.options.remoteConfig !== false &&
      this.options.transport !== "legacy"
    )
      this.startOpamp();
    if (!this.opamp) {
      this.legacy.possible = this.legacy.enabled;
      this.confirmCaptures();
    }
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

  /**
   * The resource timing instrumentation reads `window` when its module is evaluated, so a static import would make
   * the whole SDK fail to load where there is no window, which is every server-side render. It is loaded here, in
   * the browser only; the entries it reports are buffered by the browser, so none are lost while it loads.
   *
   * Every export is itself a fetch with a resource entry. Recorded, that entry is a log record that needs another
   * export, so a streaming resourceTiming signal would send a batch a second for as long as the page is open.
   */
  private startResourceTiming(ownUrls: RegExp): void {
    const tracerProvider = this.tracerProvider;
    const loggerProvider = this.loggerProvider;
    void import("@opentelemetry/browser-instrumentation/experimental/resource-timing")
      .then(({ ResourceTimingInstrumentation }) => {
        const registered = this.deregisterInstrumentations;
        // Shut down while the module loaded.
        if (!registered || !tracerProvider || !loggerProvider) return;
        const deregister = registerInstrumentations({
          instrumentations: [
            new ResourceTimingInstrumentation({ ignoreUrls: [ownUrls] }),
          ],
          tracerProvider,
          loggerProvider,
        });
        this.deregisterInstrumentations = () => {
          registered();
          deregister();
        };
      })
      .catch(() => undefined);
  }

  /** Asks Traceway for this client's collection settings now, e.g. right after login set `user.id`. */
  async refreshConfig(): Promise<void> {
    await this.opamp?.refresh();
  }

  /** Sends everything queued for sending. Buffered telemetry stays on the device. */
  async flush(): Promise<void> {
    this.metrics.flush();
    await Promise.all([this.flushQueued(), this.metrics.settled()]);
  }

  /** Without the metrics: when the page is hidden the recorder uploads them itself, after the web vitals arrive. */
  private async flushQueued(): Promise<void> {
    this.persistBuffer();
    this.collectionBudget.persist();
    // Started before anything is awaited: while a page unloads, the storage writes below finish in a later
    // task that never runs, and requests not yet started by then are never sent.
    const sent = Promise.all([
      this.logSink.forceFlush(),
      this.tracewaySink?.forceFlush(),
      this.spanSink.forceFlush(),
      this.recordings.flush(),
    ]);
    sent.catch(() => undefined);
    await this.persistence.flush();
    await this.tracewayPersistence?.flush();
    // What the storage writes above queued for sending.
    await sent;
    await Promise.all([
      this.logSink.forceFlush(),
      this.tracewaySink?.forceFlush(),
      this.spanSink.forceFlush(),
      this.recordings.flush(),
    ]);
  }

  async shutdown(): Promise<void> {
    if (this.healthTimer !== null) clearTimeout(this.healthTimer);
    this.healthTimer = null;
    if (this.overrideTimer !== null) clearTimeout(this.overrideTimer);
    this.overrideTimer = null;
    this.stopSequenceActions?.();
    this.stopSequenceActions = null;
    this.opamp?.stop();
    this.opamp = null;
    if (this.describeTimer !== null) clearTimeout(this.describeTimer);
    this.sessions.close();
    this.deregisterInstrumentations?.();
    this.deregisterInstrumentations = null;
    this.routeTiming = null;
    // Released before anything is awaited: a client started while this one is still flushing registers its own,
    // and disabling them afterwards would take that client's `traceparent` propagation away.
    if (this.ownsPropagator) propagation.disable();
    if (this.ownsContextManager) context.disable();
    this.ownsPropagator = this.ownsContextManager = false;
    await this.flush().catch(() => undefined);
    this.metrics.stop();
    this.persistence.stop();
    this.tracewayPersistence?.stop();
    this.replay.stop();
    this.sessions.stop();
    await Promise.all([
      this.tracewaySink?.shutdown().catch(() => undefined),
      this.loggerProvider?.shutdown().catch(() => undefined),
      this.tracerProvider?.shutdown().catch(() => undefined),
    ]);
    this.loggerProvider = this.tracerProvider = null;
    this.logger = null;
    this.router = null;
    this.started = false;
  }

  private applySettings(): void {
    const settings = this.control.settings();
    // First: what was measured under the previous sample rate is closed off before anything else is recorded.
    this.metrics.configure();
    this.runCaptures(settings);
    this.persistence.configure();
    this.tracewayPersistence?.configure();
    this.buffer.retain((entry) =>
      this.control.canExport(entry.signal as SignalName),
    );
    this.buffer.configure({
      maxBytes: settings.buffer.maxBytes,
      maxAgeMs: settings.buffer.maxAgeSeconds * 1000,
    });
    this.triggers.setTriggers(settings.triggers);
    this.restoreTriggerProgress();
    const needsActions = hasSequenceEvent(settings.triggers, [
      "click",
      "hover",
    ]);
    if (!needsActions) {
      this.stopSequenceActions?.();
      this.stopSequenceActions = null;
    }
    if (
      needsActions &&
      !this.stopSequenceActions &&
      this.options.captureUserActions !== false &&
      typeof document !== "undefined"
    ) {
      this.stopSequenceActions = listenForSequenceActions((type, match) => {
        if (!this.control.enabled() || !this.sessions.currentId()) return;
        this.runFired(
          this.triggers.observe({
            timeMs: Date.now(),
            lookup: this.pageEventLookup({
              "browser.action": type,
              "browser.target.matches": match,
            }),
            sequence: type,
          }),
        );
      });
    }
    if (
      hasSequenceEvent(settings.triggers, ["navigation"]) &&
      !this.sequencePageObserved &&
      this.sessions.currentId() &&
      this.options.captureNavigation !== false &&
      typeof location !== "undefined"
    ) {
      this.sequencePageObserved = true;
      this.runFired(
        this.triggers.observe({
          timeMs: Date.now(),
          lookup: this.pageEventLookup({
            "event.name": "browser.navigation",
            signal: "navigation",
            "attributes.url.full": location.href,
          }),
        }),
      );
    }
    this.applyReplay();
  }

  /** The fields of an event the page reports itself, next to what every record can be matched on. */
  private pageEventLookup(fields: Record<string, unknown>): FieldLookup {
    return (key) => {
      if (Object.prototype.hasOwnProperty.call(fields, key)) return fields[key];
      if (key.startsWith("global."))
        return this.globalAttributes[key.slice("global.".length)];
      if (key.startsWith("resource."))
        return this.resourceAttributes[key.slice("resource.".length)];
      if (key === ATTR_SESSION_ID)
        return this.sessions.currentId() ?? undefined;
      return undefined;
    };
  }

  private runFired(fired: FiredTrigger[]): void {
    this.saveTriggerProgress();
    if (fired.length === 0) return;
    for (const trigger of fired) this.runTrigger(trigger);
    this.saveTriggerLimits();
  }

  private saveTriggerLimits(): void {
    storageSet(
      `traceway:trigger-limits:${this.token}`,
      JSON.stringify({
        sessionId: this.sessions.currentId(),
        limits: this.triggers.sessionLimits,
      }),
      true,
    );
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

  /** One attempt; the recorder decides what a failure means. Resolves with the status, 0 without an answer. */
  private sendMetrics(body: string, keepalive: boolean): Promise<number> {
    // Nothing a retry could fix: this transport has no metrics endpoint.
    if (this.legacy.enabled || typeof fetch === "undefined")
      return Promise.resolve(400);
    return fetch(this.endpoints.metrics, {
      method: "POST",
      headers: {
        ...this.telemetryHeaders("metrics"),
        "Content-Type": "application/json",
      },
      body,
      keepalive,
    }).then(
      (response) => response.status,
      () => 0,
    );
  }

  setMetricDimension(key: string, value: string | null): void {
    this.metrics.setDimension(key, value);
  }

  setRoute(template: string | null): void {
    this.metrics.setRoute(template);
  }

  metric(
    name: string,
    value: number,
    dims?: Record<string, string | number | boolean>,
  ): void {
    this.metrics.metric(name, value, dims);
  }

  count(
    name: string,
    n?: number,
    dims?: Record<string, string | number | boolean>,
  ): void {
    this.metrics.count(name, n, dims);
  }

  private telemetryHeaders(
    kind: "logs" | "traces" | "metrics",
  ): Record<string, string> {
    const telemetry = this.options.telemetry;
    return telemetry?.[kind] || telemetry?.url
      ? { ...telemetry.headers, ...telemetry[kind]?.headers }
      : { Authorization: `Bearer ${this.token}` };
  }

  private isTracewayLog(name: string | undefined): boolean {
    return ["errors", "messages", "control"].includes(classifyLog(name));
  }

  private async sendOtlpJson(
    kind: StoredBatch["kind"],
    body: string,
    keepalive = false,
    tracewayOnly = false,
  ): Promise<SendResult> {
    if (!tracewayOnly && kind === "logs" && this.tracewayPersistence) {
      const tracewayBody = filterRequest(
        kind,
        body,
        (name) => this.isTracewayLog(name) && this.canExportLog(name),
        () => false,
      );
      if (tracewayBody)
        this.tracewayPersistence.sendStored({
          kind,
          body: tracewayBody,
        });
    }
    body = filterRequest(
      kind,
      body,
      (name) =>
        this.canExportLog(name) &&
        (tracewayOnly
          ? this.isTracewayLog(name)
          : !this.tracewayPersistence || !this.isTracewayLog(name)),
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
        tracewayOnly
          ? `${this.endpoints.base}/api/otel/v1/logs`
          : kind === "logs"
            ? this.endpoints.logs
            : this.endpoints.traces,
        {
          method: "POST",
          keepalive:
            keepalive && new TextEncoder().encode(body).byteLength < 60 * 1024,
          headers: {
            ...(tracewayOnly
              ? { Authorization: `Bearer ${this.token}` }
              : this.telemetryHeaders(kind)),
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
        "io.traceway.sdk.sequence-triggers/v1",
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
        this.legacy.possible = false;
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
    this.legacy.possible = canUseLegacy;
    this.opamp.start();
    this.legacy.ready = this.opamp.poll().then(
      () => this.confirmCaptures(),
      () => this.confirmCaptures(),
    );
  }

  private confirmCaptures(): void {
    if (this.capturesConfirmed) return;
    this.capturesConfirmed = true;
    this.runCaptures(this.control.settings());
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
      // Not poll(): that joins a poll already under way, which described the client before the change.
      void this.opamp?.refresh();
    }, 2_000);
  }

  private capturesKey(): string {
    return `traceway:captures:${this.token}`;
  }

  /**
   * Starts the dashboard's captures aimed at this client. The lookback flush runs once per capture, remembered
   * across pages; streaming lasts until the capture's end on every page that sees it. A capture known only from
   * the cached settings keeps streaming, but starts nothing new until the server has answered: it may have been
   * cancelled while the device was away.
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
    if (!this.capturesConfirmed) return;
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
      // The session row needs to learn once that data was dropped; its closing event carries the totals.
      const session = this.sessions.current();
      if (session && !this.healthReported)
        this.emitSessionEvent(EVENT_SESSION_UPDATE, session);
      this.healthReported = true;
      this.healthDelayMs = Math.min(
        this.healthDelayMs * 2,
        MAX_HEALTH_DELAY_MS,
      );
    }, this.healthDelayMs);
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

  private observe(observed: ObservedRecord): void {
    if (observed.item.kind === "log") this.metrics.onLog(observed.item.record);
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
    // The page's own load is one navigation for triggers, whichever is seen first: the record the navigation
    // instrumentation emits at DOMContentLoaded, or the one applySettings makes up when triggers arrive later.
    let pageLoadSeen = false;
    if (
      observed.signal === "navigation" &&
      observed.lookup("attributes.browser.navigation.same_document") === false
    ) {
      pageLoadSeen = this.sequencePageObserved;
      if (hasSequenceEvent(this.control.settings().triggers, ["navigation"]))
        this.sequencePageObserved = true;
    }
    const fired = pageLoadSeen
      ? []
      : this.triggers.observe({
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
      forgetJson(record);
    }
    for (const trigger of fired) this.runTrigger(trigger);
    if (fired.length > 0) this.saveTriggerLimits();
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
      forgetJson(record);
    }
    this.saveTriggerProgress();
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
    const wantsReplay = fired.actions.some(
      (a) => a.type === "startReplay" || ("replay" in a && a.replay),
    );
    if (wantsReplay && this.control.replayMode() !== "off") {
      attributes["traceway.trigger.replay"] = "true";
      attributes["traceway.trigger.steps"] = JSON.stringify(
        fired.trigger.steps,
      );
    }
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
      // Another tab started it. This tab has its own session and buffer, so its lookback goes up once too.
      if (this.markLocalCaptureFlushed(running.id))
        this.runAction(
          {
            type: "flush",
            lookbackSeconds: action.lookbackSeconds ?? 60,
            signals,
            replay,
          },
          exceptionId,
        );
    } else {
      this.markLocalCaptureFlushed(`${triggerId}:${now}`);
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

  /** Remembers, per tab, that a local capture's lookback was uploaded; false when it already was. */
  private markLocalCaptureFlushed(id: string): boolean {
    const key = `traceway:local-captures-flushed:${this.token}`;
    let flushed: unknown = [];
    try {
      flushed = JSON.parse(storageGet(key, true) ?? "[]");
    } catch {
      flushed = [];
    }
    const ids = Array.isArray(flushed) ? flushed.map(String) : [];
    if (ids.includes(id)) return false;
    storageSet(key, JSON.stringify([...ids.slice(-19), id]), true);
    return true;
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
    this.healthDelayMs = HEALTH_DELAY_MS;
    this.healthReported = false;
    this.unloading = false;
    this.triggers.resetSession();
    try {
      const saved = JSON.parse(
        storageGet(`traceway:trigger-limits:${this.token}`, true) ?? "{}",
      );
      if (saved.sessionId === session.id)
        this.triggers.restoreSessionLimits(saved.limits);
    } catch {}
    this.restoreTriggerProgress();
    this.replay.onSessionStart();
    this.emitSessionEvent(
      resumed ? EVENT_SESSION_UPDATE : EVENT_SESSION_START,
      session,
    );
    this.applyReplay();
    this.describeChanged();
    this.metrics.sessionStarted(session.id, resumed);
  }

  private onSessionEnd(
    session: SessionInfo,
    endedAtMs: number,
    unloading: boolean,
  ): void {
    this.unloading = unloading;
    // Before the session id changes: a batch carries one session's sample rate.
    this.metrics.flush(unloading);
    // The closing event leaves before the replay: an unloading page may send 64 KiB in all, and the request
    // that goes over is the one that is lost.
    this.emitSessionEvent(EVENT_SESSION_END, session, endedAtMs);
    if (unloading) {
      void this.logSink.forceFlush().catch(() => undefined);
      void this.tracewaySink?.forceFlush().catch(() => undefined);
    }
    this.replay.onSessionEnd(unloading);
    if (unloading) void this.flushQueued().catch(() => undefined);
  }

  private onHidden(): void {
    this.replay.onHidden();
    void this.flushQueued().catch(() => undefined);
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
