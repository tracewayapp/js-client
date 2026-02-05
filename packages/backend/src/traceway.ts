import {
  generateUUID,
  parseConnectionString,
  nowISO,
  msToNanoseconds,
} from "@tracewayapp/core";
import type {
  TracewayOptions,
  ExceptionStackTrace,
  Trace,
  Span,
} from "@tracewayapp/core";
import { CollectionFrameStore } from "./collection-frame-store.js";
import { formatErrorStackTrace } from "./stack-trace.js";
import {
  getTraceContext,
  getTraceId,
  addSpanToContext,
  type TraceContext,
} from "./context.js";
import * as os from "os";

let store: CollectionFrameStore | null = null;

function getHostname(): string {
  try {
    const hostname = os.hostname();
    const dotIdx = hostname.indexOf(".");
    return dotIdx >= 0 ? hostname.slice(0, dotIdx) : hostname;
  } catch {
    return "unknown";
  }
}

export function init(
  connectionString: string,
  options: TracewayOptions = {},
): void {
  if (store !== null) {
    throw new Error("Traceway: already initialized. Call shutdown() first.");
  }

  const { token, apiUrl } = parseConnectionString(connectionString);

  store = new CollectionFrameStore({
    apiUrl,
    token,
    debug: options.debug ?? false,
    maxCollectionFrames: options.maxCollectionFrames ?? 12,
    collectionInterval: options.collectionInterval ?? 5000,
    uploadThrottle: options.uploadThrottle ?? 2000,
    metricsInterval: options.metricsInterval ?? 30000,
    version: options.version ?? "",
    serverName: options.serverName ?? getHostname(),
    sampleRate: options.sampleRate ?? 1,
    errorSampleRate: options.errorSampleRate ?? 1,
  });
}

export function captureException(error: Error): void {
  if (!store) return;
  // Auto-detect trace context
  const ctx = getTraceContext();
  captureExceptionWithAttributes(
    error,
    ctx?.attributes,
    ctx?.traceId,
  );
}

export function captureExceptionWithAttributes(
  error: Error,
  attributes?: Record<string, string>,
  traceId?: string,
): void {
  if (!store) return;
  // Auto-detect trace context if not explicitly provided
  const ctx = getTraceContext();
  const resolvedTraceId = traceId ?? ctx?.traceId ?? null;
  const resolvedAttrs = attributes ?? ctx?.attributes;
  const isTask = ctx?.isTask ?? false;

  store.addException({
    traceId: resolvedTraceId,
    isTask: isTask || undefined,
    stackTrace: formatErrorStackTrace(error),
    recordedAt: nowISO(),
    attributes: resolvedAttrs,
    isMessage: false,
  });
}

export function captureMessage(
  msg: string,
  attributes?: Record<string, string>,
): void {
  if (!store) return;
  // Auto-detect trace context
  const ctx = getTraceContext();
  const resolvedTraceId = ctx?.traceId ?? null;
  const resolvedAttrs = attributes ?? ctx?.attributes;
  const isTask = ctx?.isTask ?? false;

  store.addException({
    traceId: resolvedTraceId,
    isTask: isTask || undefined,
    stackTrace: msg,
    recordedAt: nowISO(),
    attributes: resolvedAttrs,
    isMessage: true,
  });
}

export function captureMetric(name: string, value: number): void {
  if (!store) return;
  store.addMetric({
    name,
    value,
    recordedAt: nowISO(),
  });
}

export function captureTrace(
  traceId: string,
  endpoint: string,
  durationMs: number,
  startedAt: Date,
  statusCode: number,
  bodySize: number,
  clientIP: string,
  attributes?: Record<string, string>,
  spans?: Span[],
): void {
  if (!store) return;
  store.addTrace({
    id: traceId,
    endpoint,
    duration: msToNanoseconds(durationMs),
    recordedAt: startedAt.toISOString(),
    statusCode,
    bodySize,
    clientIP,
    attributes,
    spans,
  });
}

export function captureTask(
  traceId: string,
  taskName: string,
  durationMs: number,
  startedAt: Date,
  attributes?: Record<string, string>,
  spans?: Span[],
): void {
  if (!store) return;
  store.addTrace({
    id: traceId,
    endpoint: taskName,
    duration: msToNanoseconds(durationMs),
    recordedAt: startedAt.toISOString(),
    statusCode: 0,
    bodySize: 0,
    clientIP: "",
    attributes,
    spans,
    isTask: true,
  });
}

/** Handle returned by startSpan for tracking span timing */
export interface SpanHandle {
  id: string;
  name: string;
  startTime: string;
  startedAt: number;
}

/**
 * Start a new span. If within a trace context, the span will be
 * automatically added to the trace when ended.
 */
export function startSpan(name: string): SpanHandle {
  const now = Date.now();
  return {
    id: generateUUID(),
    name,
    startTime: new Date(now).toISOString(),
    startedAt: now,
  };
}

/**
 * End a span and get the completed Span object.
 * If within a trace context, automatically adds the span to the trace.
 *
 * @param addToContext - If true (default), adds span to current trace context
 */
export function endSpan(span: SpanHandle, addToContext: boolean = true): Span {
  const durationMs = Date.now() - span.startedAt;
  const completedSpan: Span = {
    id: span.id,
    name: span.name,
    startTime: span.startTime,
    duration: msToNanoseconds(durationMs),
  };

  // Auto-add to trace context if available
  if (addToContext) {
    addSpanToContext(completedSpan);
  }

  return completedSpan;
}

/**
 * Capture the current trace context as a trace.
 * Call this at the end of a request/task to record the trace.
 *
 * @example
 * ```ts
 * // In Express middleware (after response)
 * withTraceContext({ endpoint: `${req.method} ${req.path}` }, async () => {
 *   await handleRequest(req, res);
 *   setTraceResponseInfo(res.statusCode, contentLength);
 *   captureCurrentTrace(); // Records the trace with all spans
 * });
 * ```
 */
export function captureCurrentTrace(): void {
  if (!store) return;

  const ctx = getTraceContext();
  if (!ctx) return;

  const durationMs = Date.now() - ctx.startedAt.getTime();
  const isError = (ctx.statusCode ?? 0) >= 500;

  if (!shouldSample(isError)) return;

  if (ctx.isTask) {
    store.addTrace({
      id: ctx.traceId,
      endpoint: ctx.endpoint ?? "unknown-task",
      duration: msToNanoseconds(durationMs),
      recordedAt: ctx.startedAt.toISOString(),
      statusCode: 0,
      bodySize: 0,
      clientIP: "",
      attributes: Object.keys(ctx.attributes).length > 0 ? ctx.attributes : undefined,
      spans: ctx.spans.length > 0 ? ctx.spans : undefined,
      isTask: true,
    });
  } else {
    store.addTrace({
      id: ctx.traceId,
      endpoint: ctx.endpoint ?? "unknown",
      duration: msToNanoseconds(durationMs),
      recordedAt: ctx.startedAt.toISOString(),
      statusCode: ctx.statusCode ?? 0,
      bodySize: ctx.bodySize ?? 0,
      clientIP: ctx.clientIP ?? "",
      attributes: Object.keys(ctx.attributes).length > 0 ? ctx.attributes : undefined,
      spans: ctx.spans.length > 0 ? ctx.spans : undefined,
    });
  }
}

export function shouldSample(isError: boolean): boolean {
  if (!store) return false;
  const rate = isError ? store.errorSampleRate : store.sampleRate;
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

export function measureTask(
  title: string,
  fn: () => void | Promise<void>,
): void {
  const traceId = generateUUID();
  const start = Date.now();
  const startDate = new Date(start);

  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>)
        .then(() => {
          const durationMs = Date.now() - start;
          if (shouldSample(false)) {
            captureTask(traceId, title, durationMs, startDate);
          }
        })
        .catch((err: unknown) => {
          const durationMs = Date.now() - start;
          if (shouldSample(true)) {
            captureTask(traceId, title, durationMs, startDate);
            if (err instanceof Error) {
              captureExceptionWithAttributes(err, undefined, traceId);
            }
          }
          throw err;
        });
    } else {
      const durationMs = Date.now() - start;
      if (shouldSample(false)) {
        captureTask(traceId, title, durationMs, startDate);
      }
    }
  } catch (err) {
    const durationMs = Date.now() - start;
    if (shouldSample(true)) {
      captureTask(traceId, title, durationMs, startDate);
      if (err instanceof Error) {
        captureExceptionWithAttributes(err, undefined, traceId);
      }
    }
    throw err;
  }
}

export async function shutdown(): Promise<void> {
  if (!store) return;
  const s = store;
  store = null;
  await s.shutdown();
}
