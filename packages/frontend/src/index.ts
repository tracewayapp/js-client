import { nowISO } from "@traceway/core";
import type { ExceptionStackTrace } from "@traceway/core";
import {
  TracewayFrontendClient,
  type TracewayFrontendOptions,
} from "./client.js";
import { formatBrowserStackTrace } from "./stack-trace.js";
import { installGlobalHandlers } from "./global-handlers.js";

let client: TracewayFrontendClient | null = null;

export function init(
  connectionString: string,
  options: TracewayFrontendOptions = {},
): void {
  client = new TracewayFrontendClient(connectionString, options);
  if (typeof window !== "undefined") {
    installGlobalHandlers(client);
  }
}

export function captureException(error: Error): void {
  if (!client) return;
  client.addException({
    traceId: null,
    stackTrace: formatBrowserStackTrace(error),
    recordedAt: nowISO(),
    isMessage: false,
  });
}

export function captureExceptionWithAttributes(
  error: Error,
  attributes?: Record<string, string>,
): void {
  if (!client) return;
  client.addException({
    traceId: null,
    stackTrace: formatBrowserStackTrace(error),
    recordedAt: nowISO(),
    attributes,
    isMessage: false,
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

export async function flush(): Promise<void> {
  if (!client) return;
  await client.flush();
}

export { TracewayFrontendClient } from "./client.js";
export type { TracewayFrontendOptions } from "./client.js";
export { formatBrowserStackTrace } from "./stack-trace.js";
export { installGlobalHandlers } from "./global-handlers.js";

export type {
  ExceptionStackTrace,
  CollectionFrame,
  ReportRequest,
} from "@traceway/core";
