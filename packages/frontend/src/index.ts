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
import { installConsoleInstrumentation } from "./console-instrumentation.js";
import { installNavigationInstrumentation } from "./navigation-instrumentation.js";

let client: TracewayFrontendClient | null = null;

export function init(
  connectionString: string,
  options: TracewayFrontendOptions = {},
): void {
  client = new TracewayFrontendClient(connectionString, options);
  if (typeof window !== "undefined") {
    installGlobalHandlers(client);
    installFetchInstrumentation(client);
    installXhrInstrumentation(client);
    if (client.captureLogs) {
      installConsoleInstrumentation(client);
    }
    if (client.captureNavigation) {
      installNavigationInstrumentation(client);
    }
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

/**
 * Records a custom user-defined breadcrumb. Use to log any app-level action
 * that should ride along with the next exception ("user_tapped_pay",
 * "cart_synced", etc.).
 */
export function recordAction(
  category: string,
  name: string,
  data?: Record<string, unknown>,
): void {
  if (!client) return;
  client.recordAction(category, name, data);
}

export async function flush(timeoutMs?: number): Promise<void> {
  if (!client) return;
  await client.flush(timeoutMs);
}

export { TracewayFrontendClient, DEFAULT_IGNORE_PATTERNS } from "./client.js";
export type { TracewayFrontendOptions } from "./client.js";
export { formatBrowserStackTrace } from "./stack-trace.js";
export { installGlobalHandlers } from "./global-handlers.js";
export { installConsoleInstrumentation } from "./console-instrumentation.js";
export { installNavigationInstrumentation } from "./navigation-instrumentation.js";

export type {
  ExceptionStackTrace,
  CollectionFrame,
  ReportRequest,
  SessionRecordingPayload,
  TracewayEvent,
  LogEvent,
  NetworkEvent,
  NavigationEvent,
  CustomEvent,
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
