import { TracewayFrontendClient, type TracewayFrontendOptions } from "./client.js";

let client: TracewayFrontendClient | null = null;

/**
 * Starts the SDK. Calling it again is a no-op until `shutdown()`: the
 * OpenTelemetry instrumentations patch browser globals once per page.
 */
export function init(connectionString: string, options: TracewayFrontendOptions = {}): void {
  if (client) return;
  client = new TracewayFrontendClient(connectionString, options);
  client.start();
}

export function getClient(): TracewayFrontendClient | null {
  return client;
}

export function captureException(error: unknown, attributes?: Record<string, string>): void {
  client?.captureException(error, attributes);
}

export function captureExceptionWithAttributes(error: unknown, attributes?: Record<string, string>): void {
  client?.captureException(error, attributes);
}

export function captureMessage(message: string, attributes?: Record<string, string>): void {
  client?.captureMessage(message, attributes);
}

/**
 * Records an app-level breadcrumb ("user_tapped_pay", "cart_synced") that
 * shows on the replay timeline and that remote triggers can match.
 */
export function recordAction(category: string, name: string, data?: Record<string, unknown>): void {
  client?.recordAction(category, name, data);
}

/** Records a named app event, e.g. `track("checkout_failed", { step: "payment" })`. */
export function track(eventName: string, attributes?: Record<string, string | number | boolean>): void {
  client?.track(eventName, attributes);
}

/** Sends everything that is queued for sending. Buffered telemetry stays on the device. */
export async function flush(timeoutMs?: number): Promise<void> {
  if (!client) return;
  const done = client.flush();
  if (timeoutMs === undefined) return done;
  await Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

/** Fetches this client's remote collection settings now instead of at the next poll. */
export async function refreshConfig(): Promise<void> {
  await client?.refreshConfig();
}

/** Flushes, removes the instrumentations and stops recording. `init()` may be called again afterwards. */
export async function shutdown(): Promise<void> {
  const current = client;
  client = null;
  await current?.shutdown();
}

/**
 * Attaches a key/value attribute to every session and exception from here on
 * (e.g. `setAttribute("user.id", "42")`). An open session is updated at once.
 */
export function setAttribute(key: string, value: string): void {
  client?.setAttribute(key, value);
}

export function setAttributes(attrs: Record<string, string>): void {
  client?.setAttributes(attrs);
}

export function removeAttribute(key: string): void {
  client?.removeAttribute(key);
}

export function clearAttributes(): void {
  client?.clearAttributes();
}

/** The id this browser profile reports to Traceway as `service.instance.id`; the dashboard can capture by it. */
export function getInstanceId(): string | null {
  return client?.instanceId ?? null;
}

export { TracewayFrontendClient, DEFAULT_IGNORE_PATTERNS, SDK_VERSION } from "./client.js";
export type { TracewayFrontendOptions, CapturedException } from "./client.js";

export type {
  Settings,
  Trigger,
  TriggerAction,
  Capture,
  Mode,
  SignalName,
  TracewayEvent,
  LogEvent,
  NetworkEvent,
  NavigationEvent,
  CustomEvent,
} from "@tracewayapp/core";
