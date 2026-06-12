import { tracewayDebugIds as rollupTracewayDebugIds } from "./rollup";
import type { TracewayDebugIdPlugin } from "./rollup";

export interface TracewayDebugIdVitePlugin extends TracewayDebugIdPlugin {
  apply: "build";
  enforce: "post";
}

export function tracewayDebugIds(): TracewayDebugIdVitePlugin {
  return {
    ...rollupTracewayDebugIds(),
    apply: "build",
    enforce: "post",
  };
}
