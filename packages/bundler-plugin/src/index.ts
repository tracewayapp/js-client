export {
  stringToDebugId,
  isValidDebugId,
  getDebugIdSnippet,
  getInjectionOffset,
  extractDebugIdFromSource,
  hasDebugIdComment,
  addDebugIdComment,
  addDebugIdToMap,
} from "./debug-id";
export { tracewayDebugIds as tracewayDebugIdsRollup } from "./rollup";
export type { TracewayDebugIdPlugin } from "./rollup";
export { tracewayDebugIds as tracewayDebugIdsVite } from "./vite";
export type { TracewayDebugIdVitePlugin } from "./vite";
export { TracewayDebugIdsWebpackPlugin } from "./webpack";
