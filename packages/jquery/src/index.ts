import { guarded, setupWarning } from "@tracewayapp/core";
import {
  init as frontendInit,
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  flush,
} from "@tracewayapp/frontend";
import type { TracewayFrontendOptions } from "@tracewayapp/frontend";

/** What the package needs of jQuery: `$(document).ajaxError(handler)`. */
interface JQueryLike {
  (target: Document): {
    ajaxError(
      handler: (
        event: unknown,
        xhr: { status?: number; statusText?: string } | undefined,
        settings: { url?: string; type?: string } | undefined,
        thrown: unknown,
      ) => void,
    ): unknown;
  };
}

export interface TracewayJQueryOptions extends TracewayFrontendOptions {
  /**
   * The jQuery whose failed `$.ajax` calls are reported. Needed when jQuery is bundled (`import $ from "jquery"`),
   * which leaves `window.jQuery` unset; defaults to `window.jQuery`, else `window.$`.
   */
  jQuery?: JQueryLike;
}

/**
 * Starts the SDK and reports failed AJAX requests: `init({ token: "YOUR_TOKEN" })`, the browser SDK's `init()` with
 * the `jQuery` option. It never throws, like the browser SDK's `init()`.
 */
export function init(options: TracewayJQueryOptions): void;
/** @deprecated Pass `{ token, baseUrl }`, as the browser SDK's `init()` does; logs one deprecation warning. */
export function init(
  connectionString: string,
  options?: TracewayJQueryOptions,
): void;
export function init(
  start: TracewayJQueryOptions | string,
  options?: TracewayJQueryOptions,
): void {
  guarded("jquery.init", () => frontendInit(start as never, options));
  guarded("jquery.init", () =>
    installJQueryErrorHandler(
      (typeof start === "string" ? options : start)?.jQuery,
    ),
  );
}

let ajaxHandlerInstalled = false;

/**
 * Bound once per page: `init()` is a no-op while the SDK is running, but would otherwise add another handler on
 * every call and report each AJAX failure once per handler. After `shutdown()` the handler stays and reports
 * nothing, because captures without a running SDK are ignored.
 *
 * An aborted request is not reported: the app cancelled it (`jqXHR.abort()`, a typeahead dropping the previous
 * request), and its URL-dependent message would open an issue per URL.
 */
function installJQueryErrorHandler(given: JQueryLike | undefined): void {
  if (ajaxHandlerInstalled || typeof document === "undefined") return;
  const page = globalThis as { jQuery?: JQueryLike; $?: JQueryLike & { ajax?: unknown } };
  const jq =
    typeof given === "function"
      ? given
      : typeof page.jQuery === "function"
        ? page.jQuery
        : typeof page.$ === "function" && typeof page.$.ajax === "function"
          ? page.$
          : null;
  if (!jq) {
    setupWarning(
      "jQuery was not found on window, so failed $.ajax calls are not reported. Pass it as the jQuery option: init(…, { jQuery: $ })",
    );
    return;
  }
  ajaxHandlerInstalled = true;

  jq(document).ajaxError(function (_event, jqXHR, settings, thrownError) {
    // Inside jQuery's event dispatch, which has no try: a throw here would stop the request's `complete`
    // callbacks, ajaxComplete and ajaxStop.
    guarded("jquery.ajaxError", () => {
      const status: number = jqXHR?.status || 0;
      const message = thrownError || jqXHR?.statusText || "AJAX Error";
      if (message === "abort") return;
      const url: string = settings?.url || "unknown";
      const method: string = String(settings?.type || "GET").toUpperCase();

      captureExceptionWithAttributes(
        new Error(`${method} ${url} failed: ${status} ${message}`),
        { url, method, status: String(status) },
      );
    });
  });
}

export {
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  flush,
};

// Everything of the browser SDK but its `init` (the one above) and its client class, the same objects.
export {
  track,
  metric,
  count,
  setMetricDimension,
  setRoute,
  recordNavigation,
  recordAction,
  tracer,
  trackRouter,
  routeFromParams,
  startInteraction,
  refreshConfig,
  shutdown,
  getInstanceId,
  currentSessionId,
  getClient,
  log,
  setAttribute,
  setAttributes,
  removeAttribute,
  clearAttributes,
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
