import {
  MetricAggregator,
  encodeMetrics,
  normalizePath,
  unitHash,
  type ControlState,
  type MetricDims,
  type MetricResource,
} from "@tracewayapp/core";
import { PendingMetrics, type MetricsStorage } from "./metrics-pending.js";
import { ViewVitals, ViewVitalsObserver } from "./view-vitals.js";

export const METRIC_PAGE_VIEW = "browser.page_view";
export const METRIC_SESSION = "browser.session";
export const METRIC_JS_ERROR = "browser.js_error";
export const METRIC_RAGE_CLICK = "browser.rage_click";
export const METRIC_LONG_TASK = "browser.long_task.duration";
export const METRIC_BLOCKING_TIME = "browser.long_task.blocking_time";
export const METRIC_ROUTE_TIMING = "browser.route_timing.duration";
export const METRIC_PAGE_LOAD = "browser.page_load.duration";
export const METRIC_DOM_READY = "browser.page_load.dom_content_loaded";
export const METRIC_TRANSFER_SIZE = "browser.page.transfer_size";
export const METRIC_REQUEST_DURATION = "browser.request.duration";
export const METRIC_REQUEST_FAILED = "browser.request.failed";
export const METRIC_USER = "browser.user";
export const METRIC_USER_AFFECTED = "browser.user.affected";
export const METRIC_VITAL_ATTRIBUTION = "browser.web_vital.attribution";
export const METRIC_SCRIPT_TIME = "browser.long_task.script_time";
export const METRIC_VIEW_INP = "browser.view.inp";
export const METRIC_VIEW_CLS = "browser.view.cls";
/** Set on the web vital event by the client, from the library's attribution. */
export const ATTR_WEB_VITAL_TARGET = "browser.web_vital.target";

export type UserIssue =
  | "js_error"
  | "poor_lcp"
  | "poor_inp"
  | "poor_cls"
  | "rage_click"
  | "failed_request";

const WEB_VITAL_UNITS: Record<string, string> = {
  lcp: "ms",
  inp: "ms",
  fcp: "ms",
  ttfb: "ms",
  cls: "",
};

/** The device facts the server keeps as dimensions. Nothing that identifies a user or a browser profile. */
const RESOURCE_DIMENSIONS = [
  "service.name",
  "service.version",
  "deployment.environment.name",
  "os.name",
  "os.major",
  "browser.name",
  "browser.major",
  "browser.mobile",
  "device.form_factor",
  "device.class",
  "traceway.sdk.name",
  "traceway.sdk.version",
];

const MAX_BODY_BYTES = 60 * 1024;
const MAX_HOSTS = 20;
const MAX_CUSTOM_DIMENSIONS = 2;
const MAX_DIMENSION_LENGTH = 64;
const MAX_TARGET_LENGTH = 100;
const GLOBAL_DIMENSION_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const ATTRIBUTED_VITALS = ["lcp", "inp", "cls"];
const USER_KEY = "user";
const DAY_MS = 86_400_000;
/** Rejections a second attempt would get too. */
const PERMANENT_STATUSES = [400, 401, 403, 413, 422];
const CUSTOM_NAME = /^[a-z][a-z0-9_.]{0,62}$/;
const RESERVED_PREFIX = /^(browser|app|traceway)\./;
const RAGE_CLICKS = 3;
const RAGE_WINDOW_MS = 1000;
const LONG_TASK_BUDGET_MS = 50;

/** What the SDK's own performance instrumentations report besides their log event. */
export interface PerformanceSink {
  longTask(
    durationMs: number,
    blockingMs: number | undefined,
    type: string,
    scripts?: ReadonlyArray<{ sourceURL?: string; duration: number }>,
  ): void;
  routeChanged(): void;
  routeTiming(durationMs: number, outcome: string, type: string): void;
}

export interface MetricsRecorderDeps {
  control: ControlState;
  sessionId: () => string | null;
  resource: () => Record<string, unknown>;
  /** One attempt. Resolves with the HTTP status, 0 when no answer came. */
  send: (body: string, keepalive: boolean) => Promise<number>;
  scope: { name: string; version: string };
  /** Where a payload waits for its one retry and the user-day record lives. Without it neither exists. */
  storage?: MetricsStorage;
  /** A stable id of the browser profile. Only hashed for sampling, never sent. */
  profileId?: () => string;
  /** App-defined dimensions applied to every metric, e.g. `{ plan: "pro" }`. At most two. */
  dimensions?: Record<string, string>;
}

interface View {
  path: string;
  template: string | null;
  counted: boolean;
  blockingMs: number;
  soft: boolean;
  vitals: ViewVitals;
}

interface PendingVital {
  name: string;
  value: number;
  dims: MetricDims;
  rating: string;
  target?: string;
}

interface LogLike {
  eventName?: string;
  attributes: Record<string, unknown>;
}

interface SpanLike {
  attributes: Record<string, unknown>;
  duration: [number, number];
  status: { code: number };
}

function currentPath(): string {
  return typeof location === "undefined"
    ? "/"
    : normalizePath(location.pathname);
}

function networkType(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  if (navigator.onLine === false) return "offline";
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; type?: string };
    }
  ).connection;
  return connection?.effectiveType || connection?.type || undefined;
}

function rated(value: number, good: number, poor: number): string {
  return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor";
}

function batchId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues)
    crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  let id = "";
  for (const byte of bytes) id += byte.toString(16).padStart(2, "0");
  return id;
}

/** Origin and path of a script: the query and hash would make every build or user its own series. */
function scriptName(sourceURL: string | undefined): string | undefined {
  if (!sourceURL) return undefined;
  try {
    const url = new URL(sourceURL);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    return (url.origin + url.pathname).slice(-MAX_DIMENSION_LENGTH);
  } catch {
    return undefined;
  }
}

function numberAttr(
  attrs: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = attrs[key];
  const n = typeof value === "number" ? value : Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n >= 0
    ? n
    : undefined;
}

/**
 * Turns measurements into device histograms and counters and uploads them as one small OTLP payload per flush.
 * The detailed event of the same measurement still goes through the router, where its signal's mode decides
 * whether it is buffered, streamed or dropped: aggregates always travel, events only when asked for.
 *
 * An upload gets one more attempt: a payload that failed, or whose page went away before the answer, waits in
 * device storage and is resent once, on the next page load or after the next upload that works. The server drops
 * a resend it already has by its batch id.
 */
export class MetricsRecorder implements PerformanceSink {
  private readonly aggregator = new MetricAggregator();
  private readonly initialView: View;
  private view: View;
  private readonly vitals = new Map<string, PendingVital>();
  private readonly sentVitals = new Set<string>();
  private readonly hosts = new Set<string>();
  private clicks: { target: string; timeMs: number }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private countedSession: string | null = null;
  private lastSession: string | null = null;
  private readonly pending: PendingMetrics | null;
  private readonly inFlight = new Set<string>();
  private readonly dimensions = new Map<string, string>();
  private readonly viewObserver = new ViewVitalsObserver((entry) =>
    this.view.vitals.add(entry),
  );
  private userDay: { day: number; seen: string[] } | null = null;
  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") this.flush(true);
  };
  private readonly onPageHide = () => this.flush(true);

  constructor(private readonly deps: MetricsRecorderDeps) {
    this.view = this.initialView = this.newView(false);
    this.pending = deps.storage ? new PendingMetrics(deps.storage) : null;
    for (const key of Object.keys(deps.dimensions ?? {}))
      this.setDimension(key, deps.dimensions![key]!);
  }

  /**
   * Call after the instrumentations are registered: the web vitals library reports its final values from its own
   * `visibilitychange` listener, and this one has to run after it to carry them in the same upload.
   */
  start(): void {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    this.viewObserver.start();
    this.schedule();
    this.resend();
    this.user();
  }

  stop(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
      window.removeEventListener("pagehide", this.onPageHide);
    }
    this.viewObserver.stop();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Remote settings changed: the flush interval may have. */
  configure(): void {
    if (this.timer !== null) this.schedule();
  }

  /** Whether this session records metrics: the setting allows it and the session falls inside the sample. */
  private rate(): number {
    const settings = this.deps.control.metrics();
    // The session ends on `pagehide`, before the web vitals library reports its final values on the same unload.
    const sessionId = (this.lastSession =
      this.deps.sessionId() ?? this.lastSession);
    if (!settings || !sessionId) return 0;
    return unitHash(sessionId) < settings.sampleRate ? settings.sampleRate : 0;
  }

  private active(): boolean {
    return this.rate() > 0;
  }

  private newView(soft: boolean): View {
    return {
      path: currentPath(),
      template: null,
      counted: false,
      blockingMs: 0,
      soft,
      vitals: new ViewVitals(),
    };
  }

  private dims(view: View, extra?: MetricDims): MetricDims {
    const dims: MetricDims = { "url.path": view.template ?? view.path };
    const network = networkType();
    if (network) dims["network.type"] = network;
    return extra ? Object.assign(dims, extra) : dims;
  }

  private exemplar(
    poor: boolean,
    target?: string,
  ): { sessionId: string; target?: string } | undefined {
    return poor && this.lastSession
      ? {
          sessionId: this.lastSession,
          target: target?.slice(0, MAX_TARGET_LENGTH),
        }
      : undefined;
  }

  /** An app-defined dimension on every metric from now on; null removes it. A third key is ignored. */
  setDimension(key: string, value: string | null): void {
    if (value === null || value === undefined) {
      this.dimensions.delete(key);
      return;
    }
    if (
      !GLOBAL_DIMENSION_KEY.test(key) ||
      (!this.dimensions.has(key) &&
        this.dimensions.size >= MAX_CUSTOM_DIMENSIONS)
    )
      return;
    this.dimensions.set(key, String(value).slice(0, MAX_DIMENSION_LENGTH));
  }

  /**
   * Counts this browser profile once per UTC day, and once per day for each thing that went wrong for it, so
   * "users affected" is a ratio of two counters and no id leaves the device. The day's record lives in device
   * storage; a profile without storage is not counted at all, since every page load would count it again.
   * Sampled by profile, not by session: a user with many sessions must not be more likely to be counted.
   */
  private user(issue?: UserIssue): void {
    const settings = this.deps.control.metrics();
    const storage = this.deps.storage;
    const profile = this.deps.profileId?.();
    if (!settings || !storage || !profile) return;
    if (unitHash(profile) >= settings.sampleRate) return;
    const day = Math.floor(Date.now() / DAY_MS);
    const wanted = issue ? [METRIC_USER, issue] : [METRIC_USER];
    if (
      this.userDay?.day === day &&
      wanted.every((w) => this.userDay!.seen.includes(w))
    )
      return;
    let seen: string[] = [];
    try {
      const record = JSON.parse(storage.get(USER_KEY) ?? "null");
      if (record?.d === day && Array.isArray(record.i)) seen = record.i;
    } catch {
      // A corrupt record starts the day over.
    }
    const added = wanted.filter((w) => !seen.includes(w));
    seen = seen.concat(added);
    if (added.length) {
      const value = JSON.stringify({ d: day, i: seen });
      storage.set(USER_KEY, value);
      if (storage.get(USER_KEY) !== value) return;
    }
    this.userDay = { day, seen };
    for (const name of added) {
      if (name === METRIC_USER) this.aggregator.count(METRIC_USER);
      else this.aggregator.count(METRIC_USER_AFFECTED, 1, { issue: name });
    }
  }

  /** The route template of the page being shown, e.g. `/orders/:id`, from the app's router. */
  setRoute(template: string | null): void {
    this.view.template = template
      ? template.slice(0, MAX_DIMENSION_LENGTH)
      : null;
  }

  sessionStarted(sessionId: string): void {
    this.user();
    if (this.countedSession === sessionId || !this.active()) return;
    this.countedSession = sessionId;
    this.aggregator.count(METRIC_SESSION, 1, this.dims(this.view));
  }

  routeChanged(): void {
    this.closeView();
    this.view = this.newView(true);
  }

  /** A view is counted when it ends, so a route template that arrives after the history change still names it. */
  private closeView(): void {
    const view = this.view;
    if (!this.active()) return;
    if (!view.counted) {
      view.counted = true;
      this.aggregator.count(METRIC_PAGE_VIEW, 1, this.dims(view));
    }
    if (view.blockingMs > 0) {
      this.aggregator.observe(
        METRIC_BLOCKING_TIME,
        view.blockingMs,
        this.dims(view),
        "ms",
        this.exemplar(view.blockingMs >= 600),
      );
      view.blockingMs = 0;
    }
    this.viewVitals(view);
  }

  /**
   * INP and CLS of the view that is ending, soft navigations included: the web vitals library measures a page
   * load and attributes everything to the landing route. A view that is hidden and shown again is measured once
   * per visible stretch, because what was uploaded when it was hidden cannot be taken back.
   */
  private viewVitals(view: View): void {
    this.viewObserver.drain();
    const vitals = view.vitals;
    const inp = vitals.inp();
    const { cls, clsTarget, shifted } = vitals;
    const first = vitals.restart();
    const type = { view_type: view.soft ? "soft" : "load" };
    if (inp && this.viewObserver.interactions) {
      const rating = rated(inp.value, 200, 500);
      this.aggregator.observe(
        METRIC_VIEW_INP,
        inp.value,
        this.dims(view, { rating, ...type }),
        "ms",
        this.exemplar(rating === "poor", inp.target),
      );
    }
    if (this.viewObserver.shifts && (first || shifted)) {
      const rating = rated(cls, 0.1, 0.25);
      this.aggregator.observe(
        METRIC_VIEW_CLS,
        cls,
        this.dims(view, { rating, ...type }),
        "",
        this.exemplar(rating === "poor", clsTarget),
      );
    }
  }

  longTask(
    durationMs: number,
    blockingMs: number | undefined,
    type: string,
    scripts?: ReadonlyArray<{ sourceURL?: string; duration: number }>,
  ): void {
    if (!this.active()) return;
    if (scripts?.length) {
      const perScript = new Map<string, number>();
      for (const script of scripts) {
        const name = scriptName(script.sourceURL);
        if (name && script.duration > 0)
          perScript.set(name, (perScript.get(name) ?? 0) + script.duration);
      }
      for (const [script, ms] of perScript)
        this.aggregator.observe(METRIC_SCRIPT_TIME, ms, { script }, "ms");
    }
    this.view.blockingMs +=
      blockingMs ?? Math.max(0, durationMs - LONG_TASK_BUDGET_MS);
    this.aggregator.observe(
      METRIC_LONG_TASK,
      durationMs,
      this.dims(this.view, { type }),
      "ms",
      this.exemplar(durationMs >= 1000),
    );
  }

  routeTiming(durationMs: number, outcome: string, type: string): void {
    if (!this.active()) return;
    this.aggregator.observe(
      METRIC_ROUTE_TIMING,
      durationMs,
      this.dims(this.view, { outcome, type }),
      "ms",
      this.exemplar(durationMs >= 3000),
    );
  }

  /** Every log record passes here, whatever its signal's mode: the aggregate does not depend on the event. */
  onLog(record: LogLike): void {
    if (record.eventName === "exception") this.user("js_error");
    if (!this.active()) return;
    const attrs = record.attributes;
    switch (record.eventName) {
      case "browser.web_vital":
        return this.webVital(attrs);
      case "browser.navigation_timing":
        return this.navigationTiming(attrs);
      case "exception":
        return this.aggregator.count(METRIC_JS_ERROR, 1, this.dims(this.view));
      case "browser.user_action.click":
        return this.click(String(attrs["browser.css_selector"] ?? ""));
    }
  }

  /**
   * A vital can be reported more than once per page (CLS and INP grow), and an uploaded histogram cannot be taken
   * back, so the latest value waits here until the next flush and each vital instance is counted once.
   */
  private webVital(attrs: Record<string, unknown>): void {
    const name = String(attrs["browser.web_vital.name"] ?? "").toLowerCase();
    const value = numberAttr(attrs, "browser.web_vital.value");
    if (WEB_VITAL_UNITS[name] === undefined || value === undefined) return;
    const id = `${name}:${String(attrs["browser.web_vital.id"] ?? "")}`;
    if (this.sentVitals.has(id)) return;
    const rating = String(attrs["browser.web_vital.rating"] ?? "");
    const extra: MetricDims = {};
    if (rating) extra.rating = rating;
    const navigation = attrs["browser.web_vital.navigation_type"];
    if (navigation) extra.navigation_type = String(navigation);
    const target = attrs[ATTR_WEB_VITAL_TARGET];
    this.vitals.set(id, {
      name,
      value,
      dims: this.dims(this.initialView, extra),
      rating,
      target: target ? String(target) : undefined,
    });
    if (rating === "poor" && ATTRIBUTED_VITALS.includes(name))
      this.user(`poor_${name}` as UserIssue);
  }

  private commitVitals(): void {
    for (const [id, vital] of this.vitals) {
      this.sentVitals.add(id);
      this.aggregator.observe(
        `browser.web_vital.${vital.name}`,
        vital.value,
        vital.dims,
        WEB_VITAL_UNITS[vital.name],
        this.exemplar(vital.rating === "poor", vital.target),
      );
      if (
        vital.target &&
        vital.rating &&
        vital.rating !== "good" &&
        ATTRIBUTED_VITALS.includes(vital.name)
      )
        this.aggregator.count(
          METRIC_VITAL_ATTRIBUTION,
          1,
          this.dims(this.initialView, {
            vital: vital.name,
            rating: vital.rating,
            target: vital.target.slice(0, MAX_DIMENSION_LENGTH),
          }),
        );
    }
    this.vitals.clear();
  }

  private navigationTiming(attrs: Record<string, unknown>): void {
    const dims = this.dims(this.initialView);
    const load = numberAttr(attrs, "browser.navigation_timing.load_event_end");
    if (load) this.aggregator.observe(METRIC_PAGE_LOAD, load, dims, "ms");
    const ready = numberAttr(
      attrs,
      "browser.navigation_timing.dom_content_loaded_event_end",
    );
    if (ready) this.aggregator.observe(METRIC_DOM_READY, ready, dims, "ms");
    const size = numberAttr(attrs, "browser.resource_timing.transfer_size");
    if (size) this.aggregator.observe(METRIC_TRANSFER_SIZE, size, dims, "By");
  }

  private click(target: string): void {
    const now = Date.now();
    this.clicks = this.clicks.filter(
      (c) => c.target === target && now - c.timeMs <= RAGE_WINDOW_MS,
    );
    this.clicks.push({ target, timeMs: now });
    if (this.clicks.length === RAGE_CLICKS) {
      this.aggregator.count(METRIC_RAGE_CLICK, 1, this.dims(this.view));
      this.user("rage_click");
    }
  }

  /** A finished fetch or XHR the SDK traced. */
  onRequest(span: SpanLike): void {
    const attrs = span.attributes;
    let host = String(attrs["server.address"] ?? "");
    if (!host) {
      try {
        host = new URL(String(attrs["url.full"] ?? attrs["http.url"] ?? ""))
          .host;
      } catch {
        return;
      }
    }
    if (!this.hosts.has(host)) {
      if (this.hosts.size >= MAX_HOSTS) host = "other";
      else this.hosts.add(host);
    }
    const status = Number(
      attrs["http.response.status_code"] ?? attrs["http.status_code"] ?? 0,
    );
    const failed = span.status.code === 2 || status === 0 || status >= 500;
    if (failed) this.user("failed_request");
    if (!this.active()) return;
    const dims = { host };
    this.aggregator.observe(
      METRIC_REQUEST_DURATION,
      span.duration[0] * 1000 + span.duration[1] / 1e6,
      dims,
      "ms",
    );
    this.aggregator.ratio(METRIC_REQUEST_FAILED, failed ? 1 : 0, 1, dims);
  }

  private customDims(
    dims?: Record<string, string | number | boolean>,
  ): MetricDims {
    const out: MetricDims = {};
    if (!dims) return out;
    for (const key of Object.keys(dims)
      .sort()
      .slice(0, MAX_CUSTOM_DIMENSIONS)) {
      out[key.slice(0, MAX_DIMENSION_LENGTH)] = String(dims[key]).slice(
        0,
        MAX_DIMENSION_LENGTH,
      );
    }
    return out;
  }

  private customName(name: string): boolean {
    return CUSTOM_NAME.test(name) && !RESERVED_PREFIX.test(name);
  }

  metric(
    name: string,
    value: number,
    dims?: Record<string, string | number | boolean>,
  ): void {
    if (!this.customName(name) || !this.active()) return;
    this.aggregator.observe(name, value, this.customDims(dims));
  }

  count(
    name: string,
    n = 1,
    dims?: Record<string, string | number | boolean>,
  ): void {
    if (!this.customName(name) || !this.active()) return;
    this.aggregator.count(name, n, this.customDims(dims));
  }

  /** `final` when the page is going away: the open view ends here and the upload must outlive the page. */
  flush(final = false): void {
    const settings = this.deps.control.metrics();
    if (this.active()) {
      this.commitVitals();
      if (final) this.closeView();
    }
    const batch = this.aggregator.drain();
    if (!batch || !settings || !(settings.sampleRate > 0)) return;
    const all = this.deps.resource();
    const id = batchId();
    const resource: MetricResource = {
      "traceway.metrics": "aggregated",
      "traceway.sample_rate": settings.sampleRate,
      "traceway.sent_at": Date.now(),
      "traceway.batch_id": id,
    };
    for (const key of RESOURCE_DIMENSIONS) {
      const value = all[key];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      )
        resource[key] = value;
    }
    for (const [key, value] of this.dimensions)
      resource[`custom.${key}`] = value;
    const payload = encodeMetrics(batch, resource, this.deps.scope);
    const body = JSON.stringify(payload);
    if (body.length > MAX_BODY_BYTES) return;
    // A page that is going away may never see the answer, so its payload is stored first and removed on success.
    if (final) this.pending?.add(id, payload);
    this.inFlight.add(id);
    void this.send(body, final).then((status) => {
      this.inFlight.delete(id);
      const failed = status === 0 || status === 429 || status >= 500;
      if (final) {
        if (!failed) this.pending?.remove(id);
      } else if (failed) {
        this.pending?.add(id, payload);
      } else if (!PERMANENT_STATUSES.includes(status)) {
        this.resend();
      }
    });
  }

  private send(body: string, keepalive: boolean): Promise<number> {
    try {
      return this.deps.send(body, keepalive).catch(() => 0);
    } catch {
      return Promise.resolve(0);
    }
  }

  /** The one retry of each waiting payload. It is forgotten before it is sent, whatever the answer will be. */
  private resend(): void {
    if (!this.pending || !this.deps.control.metrics()) return;
    for (const entry of this.pending.take(this.inFlight)) {
      const attributes = entry.p?.resourceMetrics?.[0]?.resource?.attributes;
      if (!Array.isArray(attributes)) continue;
      // The server corrects the device clock from the send time, so a resend states its own.
      for (const attribute of attributes) {
        if (attribute.key === "traceway.sent_at")
          attribute.value = { doubleValue: Date.now() };
      }
      attributes.push({ key: "traceway.retry", value: { boolValue: true } });
      void this.send(JSON.stringify(entry.p), false);
    }
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const seconds = this.deps.control.settings().metrics.flushSeconds;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
      this.schedule();
    }, seconds * 1000);
  }
}
