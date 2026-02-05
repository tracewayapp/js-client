export {
  init,
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  captureMetric,
  captureTrace,
  captureTask,
  captureCurrentTrace,
  startSpan,
  endSpan,
  shouldSample,
  measureTask,
  shutdown,
} from "./traceway.js";
export type { SpanHandle } from "./traceway.js";

// Context propagation (AsyncLocalStorage-based)
export {
  withTraceContext,
  runWithTraceContext,
  getTraceContext,
  getTraceId,
  hasTraceContext,
  addSpanToContext,
  setTraceAttribute,
  setTraceAttributes,
  setTraceResponseInfo,
  getTraceSpans,
  getTraceDuration,
  forkTraceContext,
  traceContextStorage,
} from "./context.js";
export type { TraceContext, TraceContextOptions } from "./context.js";

export { formatErrorStackTrace } from "./stack-trace.js";
export { collectMetrics, resetCpuTracking } from "./metrics.js";
export { CollectionFrameStore } from "./collection-frame-store.js";
export type { CollectionFrameStoreOptions } from "./collection-frame-store.js";

export type {
  ExceptionStackTrace,
  MetricRecord,
  Span,
  Trace,
  CollectionFrame,
  ReportRequest,
  TracewayOptions,
} from "@tracewayapp/core";
