import { nowISO, generateUUID } from "@tracewayapp/core";
import type { ExceptionStackTrace } from "@tracewayapp/core";
import {
  TracewayFrontendClient,
  type TracewayFrontendOptions,
} from "./client.js";
import { formatBrowserStackTrace } from "./stack-trace.js";
import { installGlobalHandlers } from "./global-handlers.js";
import {
  installFetchInstrumentation,
  getActiveDistributedTraceId,
} from "./fetch-instrumentation.js";
import { installXhrInstrumentation } from "./xhr-instrumentation.js";

let client: TracewayFrontendClient | null = null;

export function init(
  connectionString: string,
  options: TracewayFrontendOptions = {},
): void {
  client = new TracewayFrontendClient(connectionString, options);
  if (typeof window !== "undefined") {
    installGlobalHandlers(client);
    installFetchInstrumentation();
    installXhrInstrumentation();
  }
}

export function captureException(
  error: Error,
  options?: { distributedTraceId?: string },
): void {
  if (!client) return;
  client.addException({
    traceId: null,
    stackTrace: formatBrowserStackTrace(error),
    recordedAt: nowISO(),
    isMessage: false,
    distributedTraceId:
      options?.distributedTraceId ?? getActiveDistributedTraceId(),
  });
}

export function captureExceptionWithAttributes(
  error: Error,
  attributes?: Record<string, string>,
  options?: { distributedTraceId?: string },
): void {
  if (!client) return;
  client.addException({
    traceId: null,
    stackTrace: formatBrowserStackTrace(error),
    recordedAt: nowISO(),
    attributes,
    isMessage: false,
    distributedTraceId:
      options?.distributedTraceId ?? getActiveDistributedTraceId(),
  });
}

export function captureMessage(msg: string): void {
  if (!client) return;
  client.addException({
    traceId: null,
    stackTrace: msg,
    recordedAt: nowISO(),
    isMessage: true,
  });
}

export async function flush(timeoutMs?: number): Promise<void> {
  if (!client) return;
  await client.flush(timeoutMs);
}

export { TracewayFrontendClient } from "./client.js";
export type { TracewayFrontendOptions } from "./client.js";
export { formatBrowserStackTrace } from "./stack-trace.js";
export { installGlobalHandlers } from "./global-handlers.js";

export type {
  ExceptionStackTrace,
  CollectionFrame,
  ReportRequest,
} from "@tracewayapp/core";

export const DISTRIBUTED_TRACE_HEADER = "traceway-trace-id";

export { getActiveDistributedTraceId } from "./fetch-instrumentation.js";

export function createAxiosInterceptor() {
  return (config: any) => {
    config.headers = config.headers || {};
    config.headers["traceway-trace-id"] = generateUUID();
    return config;
  };
}
