import { generateUUID } from "@tracewayapp/core";
import type { TracewayFrontendClient } from "./client.js";

let activeDistributedTraceId: string | null = null;

export function getActiveDistributedTraceId(): string | null {
  return activeDistributedTraceId;
}

export function setActiveDistributedTraceId(id: string | null): void {
  activeDistributedTraceId = id;
}

export function clearActiveDistributedTraceId(traceId: string): void {
  if (activeDistributedTraceId === traceId) {
    activeDistributedTraceId = null;
  }
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.href,
      window.location.origin,
    );
    return url.origin === window.location.origin;
  } catch {
    return true;
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (input instanceof Request) return input.method;
  return "GET";
}

function requestBytesOf(init?: RequestInit): number | undefined {
  if (!init?.body) return undefined;
  if (typeof init.body === "string") return init.body.length;
  if (init.body instanceof Blob) return init.body.size;
  if (init.body instanceof ArrayBuffer) return init.body.byteLength;
  if (ArrayBuffer.isView(init.body)) return init.body.byteLength;
  return undefined;
}

function responseBytesOf(response: Response): number | undefined {
  const contentLength = response.headers.get("content-length");
  if (contentLength === null) return undefined;
  const parsed = Number(contentLength);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function installFetchInstrumentation(
  client?: TracewayFrontendClient,
): void {
  const originalFetch = window.fetch;

  window.fetch = function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const sameOrigin = isSameOrigin(input);
    const method = methodOf(input, init);
    const url = urlOf(input);
    const requestBytes = requestBytesOf(init);
    const start = performance.now();
    const startedAt = new Date().toISOString();

    let nextInit = init;
    let traceId: string | null = null;
    if (sameOrigin) {
      traceId = generateUUID();
      activeDistributedTraceId = traceId;
      const headers = new Headers(init?.headers);
      headers.set("traceway-trace-id", traceId);
      nextInit = { ...init, headers };
    }

    const recordEvent = (
      response: Response | null,
      error: unknown,
    ): void => {
      if (!client) return;
      try {
        client.recordNetworkEvent({
          method: method.toUpperCase(),
          url,
          durationMs: Math.round(performance.now() - start),
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
      .call(this, input, nextInit)
      .then((response) => {
        recordEvent(response, null);
        if (
          client &&
          client.captureHttpServerErrors &&
          response.status >= 500
        ) {
          client.captureHttpServerError(
            method.toUpperCase(),
            url,
            response.status,
          );
        }
        return response;
      })
      .catch((err) => {
        recordEvent(null, err);
        throw err;
      })
      .finally(() => {
        if (traceId !== null && activeDistributedTraceId === traceId) {
          activeDistributedTraceId = null;
        }
      });
  };
}
