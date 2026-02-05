import { AsyncLocalStorage } from "async_hooks";
import { generateUUID } from "@tracewayapp/core";
import type { Span } from "@tracewayapp/core";

/**
 * Trace context stored in AsyncLocalStorage.
 * Automatically propagates through async operations.
 */
export interface TraceContext {
  /** Unique trace identifier (UUID v4) */
  traceId: string;
  /** Whether this is a background task (vs HTTP request) */
  isTask: boolean;
  /** When the trace started */
  startedAt: Date;
  /** Collected spans within this trace */
  spans: Span[];
  /** Key-value attributes for this trace */
  attributes: Record<string, string>;
  /** For HTTP traces: endpoint like "GET /api/users" */
  endpoint?: string;
  /** For HTTP traces: response status code */
  statusCode?: number;
  /** For HTTP traces: response body size */
  bodySize?: number;
  /** For HTTP traces: client IP address */
  clientIP?: string;
}

/**
 * Options for creating a new trace context.
 */
export interface TraceContextOptions {
  /** Custom trace ID (auto-generated if not provided) */
  traceId?: string;
  /** Mark as background task instead of HTTP trace */
  isTask?: boolean;
  /** Initial attributes */
  attributes?: Record<string, string>;
  /** HTTP endpoint (e.g., "GET /api/users") */
  endpoint?: string;
  /** Client IP address */
  clientIP?: string;
}

// The AsyncLocalStorage instance for trace context
const asyncLocalStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Get the current trace context, if any.
 * Returns undefined if not within a trace context.
 */
export function getTraceContext(): TraceContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get the current trace ID, if within a trace context.
 */
export function getTraceId(): string | undefined {
  return asyncLocalStorage.getStore()?.traceId;
}

/**
 * Check if currently within a trace context.
 */
export function hasTraceContext(): boolean {
  return asyncLocalStorage.getStore() !== undefined;
}

/**
 * Run a function within a new trace context.
 * All async operations within will have access to this context.
 *
 * @example
 * ```ts
 * // HTTP request handler
 * withTraceContext({ endpoint: "GET /api/users", clientIP: req.ip }, async () => {
 *   const users = await db.query("SELECT * FROM users");
 *   captureException(new Error("oops")); // Auto-linked to trace
 *   return users;
 * });
 *
 * // Background task
 * withTraceContext({ isTask: true, endpoint: "process-emails" }, async () => {
 *   await processEmails();
 * });
 * ```
 */
export function withTraceContext<T>(
  options: TraceContextOptions,
  fn: () => T,
): T {
  const context: TraceContext = {
    traceId: options.traceId ?? generateUUID(),
    isTask: options.isTask ?? false,
    startedAt: new Date(),
    spans: [],
    attributes: options.attributes ?? {},
    endpoint: options.endpoint,
    clientIP: options.clientIP,
  };
  return asyncLocalStorage.run(context, fn);
}

/**
 * Run a function within a trace context, automatically capturing the trace on completion.
 * This is a convenience wrapper that handles timing and capture automatically.
 *
 * @example
 * ```ts
 * // In Express middleware
 * app.use((req, res, next) => {
 *   runWithTraceContext(
 *     {
 *       endpoint: `${req.method} ${req.path}`,
 *       clientIP: req.ip,
 *       attributes: { userId: req.user?.id },
 *     },
 *     async () => {
 *       await next();
 *       // Status code and body size set via setTraceResponseInfo()
 *     },
 *     { captureOnEnd: true }
 *   );
 * });
 * ```
 */
export function runWithTraceContext<T>(
  options: TraceContextOptions,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return withTraceContext(options, fn);
}

/**
 * Add a completed span to the current trace context.
 * No-op if not within a trace context.
 */
export function addSpanToContext(span: Span): void {
  const ctx = asyncLocalStorage.getStore();
  if (ctx) {
    ctx.spans.push(span);
  }
}

/**
 * Set an attribute on the current trace context.
 * No-op if not within a trace context.
 */
export function setTraceAttribute(key: string, value: string): void {
  const ctx = asyncLocalStorage.getStore();
  if (ctx) {
    ctx.attributes[key] = value;
  }
}

/**
 * Set multiple attributes on the current trace context.
 * No-op if not within a trace context.
 */
export function setTraceAttributes(attributes: Record<string, string>): void {
  const ctx = asyncLocalStorage.getStore();
  if (ctx) {
    Object.assign(ctx.attributes, attributes);
  }
}

/**
 * Set HTTP response info on the current trace context.
 * Used by framework adapters after the response is sent.
 */
export function setTraceResponseInfo(
  statusCode: number,
  bodySize?: number,
): void {
  const ctx = asyncLocalStorage.getStore();
  if (ctx) {
    ctx.statusCode = statusCode;
    ctx.bodySize = bodySize;
  }
}

/**
 * Get all spans from the current trace context.
 * Returns empty array if not within a trace context.
 */
export function getTraceSpans(): Span[] {
  return asyncLocalStorage.getStore()?.spans ?? [];
}

/**
 * Get the duration in milliseconds since the trace started.
 * Returns 0 if not within a trace context.
 */
export function getTraceDuration(): number {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) return 0;
  return Date.now() - ctx.startedAt.getTime();
}

/**
 * Fork the current trace context for a sub-operation.
 * Useful for parallel operations that should have isolated spans.
 * Returns undefined if not within a trace context.
 */
export function forkTraceContext<T>(fn: () => T): T | undefined {
  const parentCtx = asyncLocalStorage.getStore();
  if (!parentCtx) return undefined;

  const forkedContext: TraceContext = {
    ...parentCtx,
    spans: [], // Forked context gets its own spans
    attributes: { ...parentCtx.attributes },
  };

  return asyncLocalStorage.run(forkedContext, () => {
    const result = fn();
    // Merge spans back to parent after completion
    parentCtx.spans.push(...forkedContext.spans);
    return result;
  });
}

// Export the AsyncLocalStorage instance for advanced use cases
export { asyncLocalStorage as traceContextStorage };
