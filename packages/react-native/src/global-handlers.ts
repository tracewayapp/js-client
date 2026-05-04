import type { TracewayReactNativeClient } from "./client.js";
import { formatStackTrace } from "./stack-trace.js";
import { nowISO } from "@tracewayapp/core";

interface RNErrorUtils {
  setGlobalHandler: (
    handler: (error: Error, isFatal?: boolean) => void,
  ) => void;
  getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
}

/**
 * Installs a global error handler via React Native's `ErrorUtils` —
 * the equivalent of the browser's `window.onerror` + `unhandledrejection`.
 *
 * Any throw that escapes a render, event handler, async callback, or
 * `Promise.reject(...)` without a `.catch(...)` reaches this handler. We
 * forward to the previous handler so RN's red-box dev overlay still appears.
 */
export function installGlobalHandlers(client: TracewayReactNativeClient): void {
  const errorUtils = (globalThis as { ErrorUtils?: RNErrorUtils }).ErrorUtils;
  if (!errorUtils || typeof errorUtils.setGlobalHandler !== "function") {
    return;
  }

  const previous = errorUtils.getGlobalHandler?.();

  errorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    try {
      client.addException({
        traceId: null,
        stackTrace: formatStackTrace(error),
        recordedAt: nowISO(),
        isMessage: false,
      });
    } catch {
      // Never let our own capture break the app — fall through to the
      // previous handler so RN's red-box still surfaces.
    }
    if (typeof previous === "function") {
      previous(error, isFatal);
    }
  });
}
