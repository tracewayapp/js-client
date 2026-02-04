import { getContext } from "svelte";
import { TRACEWAY_KEY } from "./context.js";
import type { TracewayContextValue } from "./types.js";

export function getTraceway(): TracewayContextValue {
  const context = getContext<TracewayContextValue>(TRACEWAY_KEY);
  if (!context) {
    throw new Error(
      "getTraceway must be used within a Svelte component tree that has called setupTraceway"
    );
  }
  return context;
}
