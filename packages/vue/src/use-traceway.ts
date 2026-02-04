import { inject } from "vue";
import { TracewayKey } from "./plugin.js";
import type { TracewayContextValue } from "./types.js";

export function useTraceway(): TracewayContextValue {
  const context = inject(TracewayKey);
  if (!context) {
    throw new Error("useTraceway must be used within a Vue app that has installed the Traceway plugin");
  }
  return context;
}
