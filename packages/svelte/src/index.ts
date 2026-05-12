export { setupTraceway, captureSvelteError, TRACEWAY_KEY } from "./context.js";
export { getTraceway, useTraceway } from "./use-traceway.js";
export { useTracewayAttributes } from "./use-traceway-attributes.js";
export {
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  recordAction,
  flush,
  setAttribute,
  setAttributes,
  removeAttribute,
  clearAttributes,
  getActiveDistributedTraceId,
  createAxiosInterceptor,
  DISTRIBUTED_TRACE_HEADER,
  DEFAULT_IGNORE_PATTERNS,
} from "@tracewayapp/frontend";
export type { TracewayFrontendOptions } from "@tracewayapp/frontend";
export type { TracewayOptions, TracewayContextValue } from "./types.js";
