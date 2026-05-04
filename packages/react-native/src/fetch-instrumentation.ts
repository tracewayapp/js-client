import type { TracewayReactNativeClient } from "./client.js";

/**
 * Hostname of the Traceway ingestion endpoint — captured at install time so
 * we can skip our own report POSTs from auto-instrumentation (otherwise every
 * report would itself record a network event, recursing forever).
 */
let apiHost: string | null = null;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  // RN's `fetch` polyfill exposes Request, but we guard against the typing
  // gap by feature-detecting `.url`.
  if (
    typeof (input as { url?: unknown }).url === "string"
  ) {
    return (input as { url: string }).url;
  }
  return String(input);
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  const m = (input as { method?: unknown }).method;
  if (typeof m === "string") return m;
  return "GET";
}

function requestBytesOf(init?: RequestInit): number | undefined {
  if (!init?.body) return undefined;
  const body = init.body as unknown;
  if (typeof body === "string") return body.length;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return undefined;
}

function responseBytesOf(response: Response): number | undefined {
  const contentLength = response.headers.get("content-length");
  if (contentLength === null) return undefined;
  const parsed = Number(contentLength);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isApiUrl(url: string): boolean {
  if (apiHost === null) return false;
  try {
    return new URL(url).host === apiHost;
  } catch {
    return false;
  }
}

export function setApiHost(host: string | null): void {
  apiHost = host;
}

/**
 * Wraps `global.fetch` to record every HTTP call as a network action. Errors
 * are propagated unchanged — we only piggyback on the call.
 *
 * Calls to the Traceway ingestion endpoint itself are skipped to avoid an
 * infinite loop.
 */
export function installFetchInstrumentation(
  client: TracewayReactNativeClient,
): void {
  const g = globalThis as { fetch?: typeof fetch };
  const originalFetch = g.fetch;
  if (typeof originalFetch !== "function") return;

  g.fetch = function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = urlOf(input);
    if (isApiUrl(url)) {
      return originalFetch.call(this, input, init);
    }

    const method = methodOf(input, init);
    const requestBytes = requestBytesOf(init);
    const start = Date.now();
    const startedAt = new Date(start).toISOString();

    const recordEvent = (response: Response | null, error: unknown): void => {
      try {
        client.recordNetworkEvent({
          method: method.toUpperCase(),
          url,
          durationMs: Date.now() - start,
          statusCode: response?.status,
          requestBytes,
          responseBytes: response ? responseBytesOf(response) : undefined,
          error: error ? String(error) : undefined,
          timestamp: startedAt,
        });
      } catch {
        // Never let event recording break the host app's networking.
      }
    };

    return originalFetch
      .call(this, input, init)
      .then((response) => {
        recordEvent(response, null);
        return response;
      })
      .catch((err) => {
        recordEvent(null, err);
        throw err;
      });
  };
}
