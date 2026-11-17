export { setupTraceway, captureSvelteError, TRACEWAY_KEY } from "./context.js";
export { getTraceway, useTraceway } from "./use-traceway.js";
export { trackRoute } from "./track-route.js";
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
  track,
  metric,
  count,
  setMetricDimension,
  setRoute,
  startInteraction,
  refreshConfig,
  shutdown,
  getInstanceId,
  DEFAULT_IGNORE_PATTERNS,
} from "@tracewayapp/frontend";
export type {
  TracewayFrontendOptions,
  StandaloneOptions,
  CollectionSettings,
  TelemetryOptions,
  TelemetryEndpoint,
} from "@tracewayapp/frontend";
export type { TracewayOptions, TracewayContextValue } from "./types.js";
