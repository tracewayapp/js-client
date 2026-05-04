import { useContext } from "react";
import { TracewayContext } from "./provider.js";
import type { TracewayContextValue } from "./provider.js";

export function useTraceway(): TracewayContextValue {
  const context = useContext(TracewayContext);
  if (context === null) {
    throw new Error("useTraceway must be used within a TracewayProvider");
  }
  return context;
}
