import { useContext } from "react";
import { TracewayContext, contextValue } from "./provider.js";
import type { TracewayContextValue } from "./provider.js";

/**
 * The capture functions of the SDK. Outside a `TracewayProvider` (an app that calls `init()` itself) they are the
 * same functions: they work once the SDK runs and do nothing before, so this never throws.
 */
export function useTraceway(): TracewayContextValue {
  return useContext(TracewayContext) ?? contextValue;
}
