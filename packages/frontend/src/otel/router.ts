import type { StoredBatch } from "../persistence/idb.js";
import {
  ATTR_CAPTURE_IDS,
  forgetJson,
  mergeRequests,
  recordJson,
  withCaptureIds,
} from "../persistence/otlp-json.js";
import { SpanKind, SpanStatusCode, type Context } from "@opentelemetry/api";
import type {
  LogRecordProcessor,
  ReadableLogRecord,
  SdkLogRecord,
} from "@opentelemetry/sdk-logs";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace";
import type {
  ControlState,
  FieldLookup,
  RingBuffer,
  SignalName,
} from "@tracewayapp/core";
import type { RecordSignal } from "./events.js";
import { unitHash } from "@tracewayapp/core";
import { ATTR_SESSION_ID, classifyLog, severityNumberOf } from "./events.js";

export type LiveItem =
  | { kind: "log"; record: ReadableLogRecord }
  | { kind: "span"; span: ReadableSpan };

export type BufferedItem = LiveItem | { kind: "stored"; batch: StoredBatch };

export interface ObservedRecord {
  signal: RecordSignal;
  timeMs: number;
  lookup: FieldLookup;
  item: LiveItem;
  /** Whether the record was sent, buffered or dropped. Triggers still see dropped records. */
  routed: "stream" | "buffer" | "off" | "filtered";
}

export interface RouterHooks {
  sessionId(): string | null;
  globalAttribute(key: string): string | undefined;
  /** Adds what the SDK knows to a record; returning false drops it (ignoreErrors, beforeCapture). */
  enrichLog(record: SdkLogRecord, signal: RecordSignal): boolean;
  observe(record: ObservedRecord): void;
  sendStored(batch: StoredBatch): void;
  admit?(item: BufferedItem): boolean;
}

export interface RouterSinks {
  logs: LogRecordProcessor;
  spans: SpanProcessor;
}

const MAX_STORED_REQUEST_CHARS = 512 * 1024;
const SPAN_STATUS = ["unset", "ok", "error"];
const SPAN_KINDS = ["internal", "server", "client", "producer", "consumer"];

export function hrTimeToMs(hrTime: [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1e6;
}

function logLookup(
  record: ReadableLogRecord,
  signal: RecordSignal,
  hooks: RouterHooks,
): FieldLookup {
  return (key) => {
    switch (key) {
      case "event.name":
        return record.eventName;
      case "signal":
        return signal;
      case "severity":
        return record.severityNumber;
      case "severity.text":
        return record.severityText;
      case "body":
        return typeof record.body === "string"
          ? record.body
          : record.body === undefined
            ? undefined
            : JSON.stringify(record.body);
    }
    return prefixedLookup(
      key,
      record.attributes,
      record.resource.attributes,
      hooks,
    );
  };
}

function spanLookup(span: ReadableSpan, hooks: RouterHooks): FieldLookup {
  return (key) => {
    switch (key) {
      case "signal":
        return "network";
      case "span.name":
        return span.name;
      case "span.kind":
        return SPAN_KINDS[span.kind];
      case "span.status":
        return SPAN_STATUS[span.status.code];
      case "duration_ms":
        return hrTimeToMs(span.duration);
    }
    return prefixedLookup(
      key,
      span.attributes,
      span.resource.attributes,
      hooks,
    );
  };
}

function prefixedLookup(
  key: string,
  attributes: Record<string, unknown>,
  resource: Record<string, unknown>,
  hooks: RouterHooks,
): unknown {
  if (key.startsWith("attributes."))
    return attributes[key.slice("attributes.".length)];
  if (key.startsWith("resource."))
    return resource[key.slice("resource.".length)];
  if (key.startsWith("global."))
    return hooks.globalAttribute(key.slice("global.".length));
  if (key === ATTR_SESSION_ID)
    return attributes[ATTR_SESSION_ID] ?? hooks.sessionId() ?? undefined;
  return undefined;
}

// Observe triggers after routing so a triggered flush includes the record that caused it.
export class TelemetryRouter {
  constructor(
    private readonly control: ControlState,
    private readonly buffer: RingBuffer<BufferedItem>,
    private readonly sinks: RouterSinks,
    private readonly hooks: RouterHooks,
    private readonly random: () => number = Math.random,
  ) {}

  routeLog(record: SdkLogRecord): void {
    const signal = classifyLog(record.eventName);
    const sessionId = this.hooks.sessionId();
    if (sessionId && record.attributes[ATTR_SESSION_ID] === undefined) {
      record.setAttribute(ATTR_SESSION_ID, sessionId);
    }
    if (signal !== "control") {
      const captureIds = this.activeCaptureIds();
      if (captureIds.length)
        record.setAttribute(ATTR_CAPTURE_IDS, JSON.stringify(captureIds));
    }
    if (!this.hooks.enrichLog(record, signal)) return;

    const item: LiveItem = { kind: "log", record };
    const timeMs = hrTimeToMs(record.hrTime);
    const minSeverity = this.control.settings().signals.console.minSeverity;
    const routed = this.route(
      signal,
      item,
      timeMs,
      () =>
        signal !== "console" ||
        !minSeverity ||
        record.severityNumber === undefined ||
        record.severityNumber >= severityNumberOf(minSeverity),
    );
    this.hooks.observe({
      signal,
      timeMs,
      lookup: logLookup(record, signal, this.hooks),
      item,
      routed,
    });
  }

  stampSpan(span: Span): void {
    const sessionId = this.hooks.sessionId();
    if (sessionId) span.setAttribute(ATTR_SESSION_ID, sessionId);
    const captureIds = this.activeCaptureIds();
    if (captureIds.length)
      span.setAttribute(ATTR_CAPTURE_IDS, JSON.stringify(captureIds));
    const baselineRate = this.control.settings().sessions.baselineSampleRate;
    span.setAttribute(
      "traceway.collection.source",
      sessionId && unitHash(sessionId) < baselineRate
        ? "baseline"
        : "diagnostic",
    );
    span.setAttribute("traceway.collection.baseline_rate", baselineRate);
  }

  routeSpan(span: ReadableSpan): void {
    const item: LiveItem = { kind: "span", span };
    const timeMs = hrTimeToMs(span.endTime);
    const routed = this.route(
      "network",
      item,
      timeMs,
      () => true,
      span.attributes["traceway.interaction"] === true &&
        span.status.code === SpanStatusCode.ERROR,
    );
    this.hooks.observe({
      signal: "network",
      timeMs,
      lookup: spanLookup(span, this.hooks),
      item,
      routed,
    });
  }

  /**
   * Sends a record that was dropped when it arrived but whose signal streams now, because the trigger it fired
   * started a capture: the log line that started a capture belongs in it.
   */
  sendIfStreaming(observed: ObservedRecord): void {
    if (observed.routed !== "off" || observed.signal === "control") return;
    if (this.control.modeFor(observed.signal) === "stream")
      this.send(observed.item);
  }

  flushBuffered(
    sinceMs: number,
    signals: ReadonlySet<string> | "*",
    untilMs = Infinity,
  ): number {
    const entries = this.buffer.take(sinceMs, signals, untilMs);
    // What a capture's lookback uploads was recorded before the capture existed, so it is marked here: the
    // server counts a capture as delivered by the ids on the data it receives.
    const captureIds = this.activeCaptureIds();
    const stored: Record<StoredBatch["kind"], StoredBatch[]> = {
      logs: [],
      traces: [],
    };
    for (const entry of entries) {
      if (!this.control.canExport(entry.signal as SignalName)) continue;
      const item = entry.item;
      if (item.kind === "stored") {
        if (!this.hooks.admit || this.hooks.admit(item))
          stored[item.batch.kind].push(item.batch);
        continue;
      }
      if (captureIds.length) {
        const target = item.kind === "log" ? item.record : item.span;
        // Set on the object, not through setAttribute, which ignores an ended span.
        (target.attributes as Record<string, unknown>)[ATTR_CAPTURE_IDS] =
          withCaptureIds(target.attributes[ATTR_CAPTURE_IDS], captureIds);
        forgetJson(target);
      }
      this.send(item);
    }
    // Records restored from an earlier page are one request body each; they leave as a few requests.
    for (const kind of ["logs", "traces"] as const) {
      let chunk: StoredBatch[] = [];
      let size = 0;
      const sendChunk = () => {
        if (chunk.length === 0) return;
        this.hooks.sendStored({
          ...chunk[0]!,
          body:
            chunk.length === 1 && captureIds.length === 0
              ? chunk[0]!.body
              : mergeRequests(
                  kind,
                  chunk.map((batch) => batch.body),
                  captureIds,
                ),
        });
        chunk = [];
        size = 0;
      };
      for (const batch of stored[kind]) {
        if (size + batch.body.length > MAX_STORED_REQUEST_CHARS) sendChunk();
        chunk.push(batch);
        size += batch.body.length;
      }
      sendChunk();
    }
    return entries.length;
  }

  private activeCaptureIds(): string[] {
    const now = Date.now();
    return this.control
      .settings()
      .captures.filter((capture) => Date.parse(capture.until) > now)
      .map((capture) => capture.id);
  }

  private route(
    signal: RecordSignal,
    item: LiveItem,
    timeMs: number,
    accept: () => boolean,
    forceStream = false,
  ): "stream" | "buffer" | "off" | "filtered" {
    if (signal === "control") {
      if (!this.control.enabled()) return "off";
      this.send(item);
      return "stream";
    }
    const mode = this.control.modeFor(signal);
    const sampleRate = this.control.sampleRate(signal);
    if (!accept() || (sampleRate < 1 && this.random() >= sampleRate))
      return "filtered";
    if (mode === "off") return "off";
    const sessionId = this.hooks.sessionId();
    const baselineSampled =
      ["network", "console", "navigation", "userActions", "custom"].includes(
        signal,
      ) &&
      sessionId !== null &&
      unitHash(sessionId) < this.control.settings().sessions.baselineSampleRate;
    if (mode === "stream" || baselineSampled || forceStream) {
      this.send(item);
      return "stream";
    }
    this.buffer.push({
      timeMs,
      signal,
      bytes: 2 * recordJson(item).length,
      item,
    });
    return "buffer";
  }

  private send(item: BufferedItem): void {
    if (this.hooks.admit && !this.hooks.admit(item)) return;
    if (item.kind === "log") {
      this.sinks.logs.onEmit(item.record as SdkLogRecord);
    } else if (item.kind === "span") {
      this.sinks.spans.onEnd(item.span);
    } else {
      this.hooks.sendStored(item.batch);
    }
  }
}

export class ControlLogProcessor implements LogRecordProcessor {
  constructor(
    private readonly router: () => TelemetryRouter | null,
    private readonly sink: LogRecordProcessor,
  ) {}

  onEmit(record: SdkLogRecord, _context?: Context): void {
    try {
      this.router()?.routeLog(record);
    } catch {
      // Telemetry must never break the page that produced it.
    }
  }

  forceFlush(): Promise<void> {
    return this.sink.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.sink.shutdown();
  }
}

/** Told about the requests the SDK traces while they are in flight. */
export interface RequestActivity {
  requestStarted(request: unknown): void;
  requestEnded(request: unknown): void;
}

export class ControlSpanProcessor implements SpanProcessor {
  constructor(
    private readonly router: () => TelemetryRouter | null,
    private readonly sink: SpanProcessor,
    private readonly activity: () => RequestActivity | null = () => null,
    private readonly requestEnded: (span: ReadableSpan) => void = () => {},
  ) {}

  onStart(span: Span, _parentContext: Context): void {
    try {
      this.router()?.stampSpan(span);
      if (span.kind === SpanKind.CLIENT) this.activity()?.requestStarted(span);
    } catch {
      // ignore
    }
  }

  onEnd(span: ReadableSpan): void {
    try {
      if (span.kind === SpanKind.CLIENT) {
        this.activity()?.requestEnded(span);
        this.requestEnded(span);
      }
      this.router()?.routeSpan(span);
    } catch {
      // ignore
    }
  }

  forceFlush(): Promise<void> {
    return this.sink.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.sink.shutdown();
  }
}
