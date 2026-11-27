export { TracewayProvider, TracewayContext } from "./provider.js";
export type {
  TracewayProviderProps,
  TracewayContextValue,
} from "./provider.js";
export { useTraceway } from "./use-traceway.js";
export { useTracewayRoute } from "./use-traceway-route.js";
export { useTracewayAttributes } from "./use-traceway-attributes.js";
export { TracewayAttributes } from "./traceway-attributes.js";
export type { TracewayAttributesProps } from "./traceway-attributes.js";
export { TracewayErrorBoundary } from "./error-boundary.js";
export type { TracewayErrorBoundaryProps } from "./error-boundary.js";

// Direct re-exports from @tracewayapp/frontend so consumers can use
// non-hook entrypoints (utilities, error handlers, modules outside the
// React tree) without taking a second dependency on the core package.
export {
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  log,
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
  recordNavigation,
  tracer,
  trackRouter,
  routeFromParams,
  startInteraction,
  refreshConfig,
  shutdown,
  getInstanceId,
  currentSessionId,
  getClient,
  DEFAULT_IGNORE_PATTERNS,
  SDK_VERSION,
} from "@tracewayapp/frontend";
export type {
  TracewayFrontendOptions,
  StandaloneOptions,
  TelemetryOptions,
  TelemetryEndpoint,
  TracewayCapturedError,
  CapturedException,
  TracewayInteraction,
  TracewayLogLevel,
  ErrorLimits,
  CollectionLimits,
  Settings,
  CollectionSettings,
  Trigger,
  TriggerAction,
  Capture,
  Mode,
  SignalName,
  TracewayEvent,
  LogEvent,
  NetworkEvent,
  NavigationEvent,
  CustomEvent,
  TracewayImagePolicy,
  RouteParams,
} from "@tracewayapp/frontend";
