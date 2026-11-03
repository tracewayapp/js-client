import type { StoredBatch } from "../persistence/idb.js";
import { logsToJson, spansToJson } from "../persistence/otlp-json.js";
import type { Context } from "@opentelemetry/api";
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
}

export interface RouterSinks {
  logs: LogRecordProcessor;
  spans: SpanProcessor;
}

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
  }

  routeSpan(span: ReadableSpan): void {
    const item: LiveItem = { kind: "span", span };
    const timeMs = hrTimeToMs(span.endTime);
    const routed = this.route("network", item, timeMs, () => true);
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
    for (const entry of entries) {
      if (this.control.canExport(entry.signal as SignalName))
        this.send(entry.item);
    }
    return entries.length;
  }

  private route(
    signal: RecordSignal,
    item: LiveItem,
    timeMs: number,
    accept: () => boolean,
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
    if (mode === "stream" || baselineSampled) {
      this.send(item);
      return "stream";
    }
    this.buffer.push({
      timeMs,
      signal,
      bytes:
        2 *
        (item.kind === "log"
          ? logsToJson([item.record])
          : spansToJson([item.span])
        ).length,
      item,
    });
    return "buffer";
  }

  private send(item: BufferedItem): void {
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

export class ControlSpanProcessor implements SpanProcessor {
  constructor(
    private readonly router: () => TelemetryRouter | null,
    private readonly sink: SpanProcessor,
  ) {}

  onStart(span: Span, _parentContext: Context): void {
    try {
      this.router()?.stampSpan(span);
    } catch {
      // ignore
    }
  }

  onEnd(span: ReadableSpan): void {
    try {
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
