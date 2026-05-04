import type { TracewayReactNativeClient } from "./client.js";

interface TracewayXHR extends XMLHttpRequest {
  _tracewayMethod?: string;
  _tracewayUrl?: string;
  _tracewayStart?: number;
  _tracewayStartedAt?: string;
  _tracewayRequestBytes?: number;
  _tracewayRecorded?: boolean;
  _tracewaySkip?: boolean;
}

let apiHost: string | null = null;

export function setXhrApiHost(host: string | null): void {
  apiHost = host;
}

function isApiUrl(url: string): boolean {
  if (apiHost === null) return false;
  try {
    return new URL(url).host === apiHost;
  } catch {
    return false;
  }
}

function bodyBytes(body: unknown): number | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body.length;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return undefined;
}

/**
 * Wraps `XMLHttpRequest` (RN polyfills it; `fetch` is implemented on top of
 * it) to record every request as a network action. Calls to the Traceway
 * ingestion endpoint are skipped to avoid an infinite loop.
 */
export function installXhrInstrumentation(
  client: TracewayReactNativeClient,
): void {
  const Xhr = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest })
    .XMLHttpRequest;
  if (typeof Xhr !== "function") return;

  const originalOpen = Xhr.prototype.open;
  const originalSend = Xhr.prototype.send;

  Xhr.prototype.open = function (
    this: TracewayXHR,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const urlStr = String(url);
    this._tracewayMethod = method;
    this._tracewayUrl = urlStr;
    this._tracewayRecorded = false;
    this._tracewaySkip = isApiUrl(urlStr);
    return (originalOpen as (...args: unknown[]) => unknown).apply(this, [
      method,
      url,
      ...rest,
    ]);
  };

  Xhr.prototype.send = function (
    this: TracewayXHR,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    if (this._tracewaySkip) {
      return originalSend.call(this, body as XMLHttpRequestBodyInit | null);
    }

    this._tracewayStart = Date.now();
    this._tracewayStartedAt = new Date(this._tracewayStart).toISOString();
    this._tracewayRequestBytes = bodyBytes(body);

    const finalize = (errorEvent: boolean): void => {
      if (this._tracewayRecorded) return;
      this._tracewayRecorded = true;
      try {
        const contentLength = this.getResponseHeader("content-length");
        const responseBytes =
          contentLength !== null && Number.isFinite(Number(contentLength))
            ? Number(contentLength)
            : undefined;
        client.recordNetworkEvent({
          method: (this._tracewayMethod ?? "GET").toUpperCase(),
          url: this._tracewayUrl ?? "",
          durationMs: Date.now() - (this._tracewayStart ?? Date.now()),
          statusCode: this.status || undefined,
          requestBytes: this._tracewayRequestBytes,
          responseBytes,
          error: errorEvent ? `XHR ${this.statusText || "error"}` : undefined,
          timestamp: this._tracewayStartedAt ?? new Date().toISOString(),
        });
      } catch {
        // ignore
      }
      this.removeEventListener("load", onLoad);
      this.removeEventListener("error", onError);
      this.removeEventListener("abort", onAbort);
      this.removeEventListener("timeout", onTimeout);
    };

    const onLoad = () => finalize(false);
    const onError = () => finalize(true);
    const onAbort = () => finalize(true);
    const onTimeout = () => finalize(true);

    this.addEventListener("load", onLoad);
    this.addEventListener("error", onError);
    this.addEventListener("abort", onAbort);
    this.addEventListener("timeout", onTimeout);

    return originalSend.call(this, body as XMLHttpRequestBodyInit | null);
  };
}
