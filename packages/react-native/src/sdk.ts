import { nowISO, parseConnectionString } from "@tracewayapp/core";
import {
  TracewayReactNativeClient,
  type TracewayReactNativeOptions,
} from "./client.js";
import { formatStackTrace } from "./stack-trace.js";
import { installGlobalHandlers } from "./global-handlers.js";
import {
  installFetchInstrumentation,
  setApiHost,
} from "./fetch-instrumentation.js";
import {
  installXhrInstrumentation,
  setXhrApiHost,
} from "./xhr-instrumentation.js";
import { installConsoleInstrumentation } from "./console-instrumentation.js";
import { recordNavigationOn } from "./navigation.js";

let client: TracewayReactNativeClient | null = null;

/** @internal — exposed for tests. */
export function _resetForTesting(): void {
  client = null;
  setApiHost(null);
  setXhrApiHost(null);
}

/** @internal — exposed for tests. */
export function _getClient(): TracewayReactNativeClient | null {
  return client;
}

export function init(
  connectionString: string,
  options: TracewayReactNativeOptions = {},
): void {
  client = new TracewayReactNativeClient(connectionString, options);

  try {
    const { apiUrl } = parseConnectionString(connectionString);
    const host = new URL(apiUrl).host;
    setApiHost(host);
    setXhrApiHost(host);
  } catch {
    // If the apiUrl can't be parsed, continue — the instrumentations will
    // just record every request including our own. Better than failing init.
  }

  installGlobalHandlers(client);
  if (client.captureNetwork) {
    installFetchInstrumentation(client);
    installXhrInstrumentation(client);
  }
  if (client.captureLogs) {
    installConsoleInstrumentation(client);
  }
}

export function captureException(
  error: Error,
  options?: { distributedTraceId?: string },
): void {
  if (!client) return;
  client.addException({
    traceId: null,
    stackTrace: formatStackTrace(error),
    recordedAt: nowISO(),
    isMessage: false,
    distributedTraceId: options?.distributedTraceId,
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
    stackTrace: formatStackTrace(error),
    recordedAt: nowISO(),
    attributes,
    isMessage: false,
    distributedTraceId: options?.distributedTraceId,
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

/**
 * Records a navigation transition from one screen to another. Wire this into
 * your navigation library — see the "Logs & Actions" section in the README
 * for a react-navigation example.
 */
export function recordNavigation(from: string, to: string): void {
  if (!client) return;
  recordNavigationOn(client, from, to);
}

export async function flush(timeoutMs?: number): Promise<void> {
  if (!client) return;
  await client.flush(timeoutMs);
}
