export { TracewayProvider, TracewayContext } from "./provider.js";
export type {
  TracewayProviderProps,
  TracewayContextValue,
} from "./provider.js";
export { useTraceway } from "./use-traceway.js";
export { useTracewayAttributes } from "./use-traceway-attributes.js";
export { TracewayAttributes } from "./traceway-attributes.js";
export type { TracewayAttributesProps } from "./traceway-attributes.js";
export {
  TracewayErrorBoundary,
} from "./error-boundary.js";
export type { TracewayErrorBoundaryProps } from "./error-boundary.js";

// Direct re-exports from @tracewayapp/frontend so consumers can use
// non-hook entrypoints (utilities, error handlers, modules outside the
// React tree) without taking a second dependency on the core package.
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
