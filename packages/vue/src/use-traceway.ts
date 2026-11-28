import { inject } from "vue";
import { TracewayKey, tracewayContext } from "./plugin.js";
import type { TracewayContextValue } from "./types.js";

/**
 * The capture functions of the SDK. Without the plugin (an app that calls `init()` itself) they are the same
 * functions: they work once the SDK runs and do nothing before, so this never throws.
 */
export function useTraceway(): TracewayContextValue {
  return inject(TracewayKey, tracewayContext);
}
