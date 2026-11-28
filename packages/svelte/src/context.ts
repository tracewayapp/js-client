import { setContext } from "svelte";
import { guarded } from "@tracewayapp/core";
import * as traceway from "@tracewayapp/frontend";
import { startTraceway } from "./types.js";
import type { TracewayOptions, TracewayContextValue } from "./types.js";

export const TRACEWAY_KEY = Symbol("traceway");

/** What `setupTraceway` puts into the context, and what `getTraceway()` returns without it. */
export const tracewayContext: TracewayContextValue = {
  captureException: traceway.captureException,
  captureExceptionWithAttributes: traceway.captureExceptionWithAttributes,
  captureMessage: traceway.captureMessage,
  recordAction: traceway.recordAction,
};

export function setupTraceway(options: TracewayOptions): TracewayContextValue {
  // In the app's root component: a failure here (a build without its token) must not stop it.
  guarded("svelte.setupTraceway", () => startTraceway(options));

  setContext(TRACEWAY_KEY, tracewayContext);

  return tracewayContext;
}

/**
 * Report a Svelte render or lifecycle error to Traceway. Svelte 4 has no
 * built-in error boundary primitive; Svelte 5 ships `<svelte:boundary>` with
 * an `onerror` prop. In either case, pipe the thrown value into this helper
 * to get the same capture path Vue's `app.config.errorHandler` and React's
 * `<TracewayProvider>` use. It never throws.
 */
export function captureSvelteError(err: unknown): void {
  guarded("svelte.captureSvelteError", () => {
    if (err instanceof Error) {
      traceway.captureException(err);
    } else {
      traceway.captureMessage(String(err));
    }
  });
}
