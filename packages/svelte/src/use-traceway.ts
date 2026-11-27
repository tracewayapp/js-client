import { getContext } from "svelte";
import { TRACEWAY_KEY, tracewayContext } from "./context.js";
import type { TracewayContextValue } from "./types.js";

/**
 * The capture functions of the SDK. Without `setupTraceway` (an app that calls `init()` itself, or a server render
 * that skipped it) they are the same functions: they work once the SDK runs and do nothing before, so this never
 * throws.
 */
export function getTraceway(): TracewayContextValue {
  return getContext<TracewayContextValue>(TRACEWAY_KEY) ?? tracewayContext;
}

/**
 * Alias for `getTraceway()` provided for cross-framework consistency with
 * `@tracewayapp/react`, `@tracewayapp/vue`, and `@tracewayapp/react-native`,
 * which all expose a `useTraceway()` hook. Functionally identical to
 * `getTraceway()`; Svelte convention prefers the `get`-prefix.
 */
export const useTraceway = getTraceway;
