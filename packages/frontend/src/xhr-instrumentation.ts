import { generateUUID } from "@tracewayapp/core";
import type { TracewayFrontendClient } from "./client.js";
import {
  setActiveDistributedTraceId,
  clearActiveDistributedTraceId,
} from "./fetch-instrumentation.js";

function isSameOriginUrl(url: string): boolean {
  try {
    const resolved = new URL(url, window.location.origin);
    return resolved.origin === window.location.origin;
  } catch {
    return true;
  }
}

interface TracewayXHR extends XMLHttpRequest {
  _tracewaySameOrigin?: boolean;
  _tracewayMethod?: string;
  _tracewayUrl?: string;
  _tracewayStart?: number;
  _tracewayStartedAt?: string;
  _tracewayRequestBytes?: number;
  _tracewayRecorded?: boolean;
}

function bodyBytes(body?: Document | XMLHttpRequestBodyInit | null): number | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body.length;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof FormData) return undefined;
  return undefined;
}

export function installXhrInstrumentation(
  client?: TracewayFrontendClient,
): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    this: TracewayXHR,
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    const urlStr = String(url);
    this._tracewaySameOrigin = isSameOriginUrl(urlStr);
    this._tracewayMethod = method;
    this._tracewayUrl = urlStr;
    this._tracewayRecorded = false;
    return originalOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (
    this: TracewayXHR,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    this._tracewayStart = performance.now();
    this._tracewayStartedAt = new Date().toISOString();
    this._tracewayRequestBytes = bodyBytes(body);

    let traceId: string | null = null;
    if (this._tracewaySameOrigin) {
      traceId = generateUUID();
      setActiveDistributedTraceId(traceId);
      this.setRequestHeader("traceway-trace-id", traceId);
    }

    const finalize = (errorEvent: boolean): void => {
      if (this._tracewayRecorded) return;
      this._tracewayRecorded = true;
      if (client) {
        try {
          const contentLength = this.getResponseHeader("content-length");
          const responseBytes =
            contentLength !== null && Number.isFinite(Number(contentLength))
              ? Number(contentLength)
              : undefined;
          client.recordNetworkEvent({
            method: (this._tracewayMethod ?? "GET").toUpperCase(),
            url: this._tracewayUrl ?? "",
            durationMs: Math.round(
              performance.now() - (this._tracewayStart ?? performance.now()),
            ),
            statusCode: this.status || undefined,
            requestBytes: this._tracewayRequestBytes,
            responseBytes,
            error: errorEvent ? `XHR ${this.statusText || "error"}` : undefined,
            timestamp: this._tracewayStartedAt ?? new Date().toISOString(),
          });
        } catch {
          // ignore
        }
      }
      if (traceId !== null) clearActiveDistributedTraceId(traceId);
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

    return originalSend.call(this, body);
  };
}
