import type { TracewayFrontendClient } from "./client.js";
import { formatBrowserStackTrace } from "./stack-trace.js";
import { nowISO } from "@tracewayapp/core";

export function installGlobalHandlers(client: TracewayFrontendClient): void {
  const prevOnError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    if (error) {
      client.addException({
        traceId: null,
        stackTrace: formatBrowserStackTrace(error),
        recordedAt: nowISO(),
        isMessage: false,
      });
    } else {
      client.addException({
        traceId: null,
        stackTrace: String(message),
        recordedAt: nowISO(),
        isMessage: false,
      });
    }
    if (typeof prevOnError === "function") {
      return prevOnError(message, source, lineno, colno, error);
    }
    return false;
  };

  const prevOnUnhandledRejection = window.onunhandledrejection;
  window.onunhandledrejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      client.addException({
        traceId: null,
        stackTrace: formatBrowserStackTrace(reason),
        recordedAt: nowISO(),
        isMessage: false,
      });
    } else {
      client.addException({
        traceId: null,
        stackTrace: String(reason),
        recordedAt: nowISO(),
        isMessage: false,
      });
    }
    if (typeof prevOnUnhandledRejection === "function") {
      prevOnUnhandledRejection.call(window, event);
    }
  };
}
