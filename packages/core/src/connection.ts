import { setupWarning } from "./guarded.js";

/** Traceway Cloud: where the SDKs send to when `baseUrl` is not given. */
export const DEFAULT_BASE_URL = "https://cloud.tracewayapp.com";

export interface TracewayEndpoints {
  /** Where the Traceway server is reachable, without a trailing slash. */
  base: string;
  logs: string;
  traces: string;
  metrics: string;
  opamp: string;
  recordings: string;
}

/** Hosts of a developer's own machine, which a URL without a scheme reaches over plain HTTP. */
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

/**
 * The Traceway server a URL names, by the rules of CONTRACT §16.1: trimmed; `https://` added without a scheme
 * (`http://` for localhost, 127.0.0.1, 10.0.2.2 and [::1]); query string, fragment and trailing slashes dropped; then
 * a trailing `/api/report`, else `/api`, which 2.0 connection strings carried. Any other path is kept, for a server
 * under a sub-path. Throws when the result is not an HTTP(S) URL with a host.
 */
export function normalizeBaseUrl(url: string): string {
  let base = String(url).trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(base) || /^[^/]*:\d+(?:[/?#]|$)/.test(base))
    base = `${LOCAL_HOST.test(base) ? "http" : "https"}://${base}`;
  base = base.replace(/[?#].*$/, "");
  const parsed = /^https?:\/\/(?:[^/?#@\s]*@)?([^/?#@\s]+)/i.exec(base);
  if (!parsed || /^:|:$/.test(parsed[1]!))
    throw new Error(`Invalid Traceway URL "${url}": it must be an HTTP(S) URL with a host`);
  const authority = parsed[0];
  const path = base.slice(authority.length).replace(/\/+$/, "").replace(/\/api(?:\/report)?$/, "").replace(/\/+$/, "");
  return authority + path;
}

/**
 * Derives every endpoint the SDK talks to from `baseUrl`, the Traceway server, normalized by `normalizeBaseUrl`:
 * Traceway Cloud when it is not given or empty (an environment variable left unset). Throws for a URL it cannot use.
 */
export function resolveEndpoints(baseUrl?: string | null): TracewayEndpoints {
  const base = normalizeBaseUrl(baseUrl?.trim() || DEFAULT_BASE_URL);
  return {
    base,
    logs: `${base}/api/otel/v1/logs`,
    traces: `${base}/api/otel/v1/traces`,
    metrics: `${base}/api/otel/v1/metrics`,
    opamp: `${base}/api/otel/v1/opamp`,
    recordings: `${base}/api/recordings`,
  };
}

export interface ParsedConnectionString {
  token: string;
  /** The server, normalized: what `baseUrl` is in the start options. */
  baseUrl: string;
  /** The URL part as written (trimmed), for the SDKs that still post to it (React Native, Node). */
  apiUrl: string;
}

/**
 * Reads a 2.0 connection string, `token@url`, by the rules of CONTRACT §16.1: trimmed, split at the first `@`, a
 * non-empty token, the URL normalized as `normalizeBaseUrl` does. Throws, without the token in the message, for a
 * string it cannot read.
 */
export function parseConnectionString(
  connectionString: string,
): ParsedConnectionString {
  const text = String(connectionString).trim();
  const at = text.indexOf("@");
  const token = at < 0 ? "" : text.slice(0, at).trim();
  const apiUrl = at < 0 ? "" : text.slice(at + 1).trim();
  if (!token || !apiUrl)
    throw new Error("Invalid connection string: expected token@url");
  return { token, apiUrl, baseUrl: normalizeBaseUrl(apiUrl) };
}

/** The fields of the start options that say where telemetry goes. */
export interface StartFields {
  token?: string;
  baseUrl?: string;
  /** Deprecated and ignored: the SDKs always send OTLP. */
  transport?: unknown;
  telemetry?: {
    url?: string;
    logs?: unknown;
    traces?: unknown;
    metrics?: unknown;
  };
}

/**
 * What `init()` was given, as one options object (CONTRACT §16). `init(options)` is the start API; the 2.0 form
 * `init("token@https://host", options)` still works as `init({ ...options, token, baseUrl: "https://host" })`, with
 * one deprecation warning that names the new form (never the token). Throws, with a message that says what to
 * pass, when there is neither a token nor a `telemetry` destination: usually a build without its environment
 * variable.
 */
export function startOptions<T extends StartFields>(
  given: T | string | null | undefined,
  options?: T | null,
): T {
  let start: T;
  if (typeof given === "string") {
    let parsed: ParsedConnectionString;
    try {
      parsed = parseConnectionString(given);
    } catch (error) {
      // The browser's own start call; React Native and Node, which read the same string, have no such form.
      throw new Error(`${(error as Error).message}. Pass init({ token: "YOUR_TOKEN" }) instead`);
    }
    const { token, baseUrl: base } = parsed;
    setupWarning(
      `connection strings are deprecated: use init({ token: "…"${
        base === DEFAULT_BASE_URL ? "" : `, baseUrl: "${base}"`
      } })`,
    );
    start = { ...options, token, baseUrl: base } as T;
  } else start = { ...given } as T;
  if (typeof start.token === "string") start.token = start.token.trim();
  if (typeof start.baseUrl === "string") start.baseUrl = start.baseUrl.trim();
  if (start.transport !== undefined)
    setupWarning(
      "the transport option is deprecated and ignored: telemetry is always sent as OTLP",
    );
  const telemetry = start.telemetry;
  if (
    !start.token &&
    !telemetry?.url &&
    !(telemetry?.logs && telemetry?.traces && telemetry?.metrics)
  )
    throw new Error(
      `init() needs a token, as in init({ token: "YOUR_TOKEN" }), and got ${JSON.stringify(
        start.token,
      )}: is the environment variable set in this build? Without a token, telemetry.url (or all three of ` +
        "telemetry.logs, telemetry.traces and telemetry.metrics) sends to another OpenTelemetry provider.",
    );
  return start;
}
