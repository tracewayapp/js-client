import { setContext } from "svelte";
import * as traceway from "@tracewayapp/frontend";
import type { TracewayOptions, TracewayContextValue } from "./types.js";

export const TRACEWAY_KEY = Symbol("traceway");

export function setupTraceway(options: TracewayOptions): TracewayContextValue {
  traceway.init(options.connectionString, options.options);

  const context: TracewayContextValue = {
    captureException: traceway.captureException,
    captureExceptionWithAttributes: traceway.captureExceptionWithAttributes,
    captureMessage: traceway.captureMessage,
    recordAction: traceway.recordAction,
  };

  setContext(TRACEWAY_KEY, context);

  return context;
}

/**
 * Report a Svelte render or lifecycle error to Traceway. Svelte 4 has no
 * built-in error boundary primitive; Svelte 5 ships `<svelte:boundary>` with
 * an `onerror` prop. In either case, pipe the thrown value into this helper
 * to get the same capture path Vue's `app.config.errorHandler` and React's
 * `<TracewayProvider>` use.
 */
export function captureSvelteError(err: unknown): void {
  if (err instanceof Error) {
    traceway.captureException(err);
  } else {
    traceway.captureMessage(String(err));
  }
}
