export { createTracewayPlugin, TracewayKey } from "./plugin.js";
export { useTraceway } from "./use-traceway.js";
export { useTracewayAttributes } from "./use-traceway-attributes.js";
export { TracewayAttributes } from "./traceway-attributes.js";
export type { TracewayAttributesProps } from "./traceway-attributes.js";
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
export type { TracewayPluginOptions, TracewayContextValue } from "./types.js";
