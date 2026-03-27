import { generateUUID } from "@tracewayapp/core";
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
}

export function installXhrInstrumentation(): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    this: TracewayXHR,
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    this._tracewaySameOrigin = isSameOriginUrl(String(url));
    return originalOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (
    this: TracewayXHR,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    if (this._tracewaySameOrigin) {
      const traceId = generateUUID();
      setActiveDistributedTraceId(traceId);
      this.setRequestHeader("traceway-trace-id", traceId);

      const onComplete = () => {
        clearActiveDistributedTraceId(traceId);
        this.removeEventListener("load", onComplete);
        this.removeEventListener("error", onComplete);
        this.removeEventListener("abort", onComplete);
      };
      this.addEventListener("load", onComplete);
      this.addEventListener("error", onComplete);
      this.addEventListener("abort", onComplete);
    }
    return originalSend.call(this, body);
  };
}
