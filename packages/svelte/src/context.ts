import { setContext, onMount } from "svelte";
import * as traceway from "@tracewayapp/frontend";
import type { TracewayOptions, TracewayContextValue } from "./types.js";

export const TRACEWAY_KEY = Symbol("traceway");

export function setupTraceway(options: TracewayOptions): TracewayContextValue {
  const context: TracewayContextValue = {
    captureException: traceway.captureException,
    captureExceptionWithAttributes: traceway.captureExceptionWithAttributes,
    captureMessage: traceway.captureMessage,
  };

  setContext(TRACEWAY_KEY, context);

  onMount(() => {
    traceway.init(options.connectionString, options.options);
  });

  return context;
}
