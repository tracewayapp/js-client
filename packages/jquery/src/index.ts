import {
  init as frontendInit,
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  flush,
} from "@tracewayapp/frontend";
import type {
  TracewayFrontendOptions,
  StandaloneOptions,
} from "@tracewayapp/frontend";

export interface TracewayJQueryOptions extends TracewayFrontendOptions {}

export function init(
  connectionString: string | StandaloneOptions,
  options: TracewayJQueryOptions = {},
): void {
  frontendInit(connectionString, options);
  installJQueryErrorHandler();
}

let ajaxHandlerInstalled = false;

/**
 * Bound once per page: `init()` is a no-op while the SDK is running, but would otherwise add another handler on
 * every call and report each AJAX failure once per handler. After `shutdown()` the handler stays and reports
 * nothing, because captures without a running SDK are ignored.
 */
function installJQueryErrorHandler(): void {
  if (ajaxHandlerInstalled) return;
  const jq =
    typeof jQuery !== "undefined"
      ? jQuery
      : typeof $ !== "undefined" && typeof ($ as any).ajax === "function"
        ? ($ as any)
        : null;
  if (!jq) return;
  ajaxHandlerInstalled = true;

  jq(document).ajaxError(function (
    _event: any,
    jqXHR: any,
    settings: any,
    thrownError: any,
  ) {
    const message = thrownError || jqXHR?.statusText || "AJAX Error";
    const url: string = settings?.url || "unknown";
    const method: string = (settings?.type || "GET").toUpperCase();
    const status: number = jqXHR?.status || 0;

    captureExceptionWithAttributes(
      new Error(`${method} ${url} failed: ${status} ${message}`),
      { url, method, status: String(status) },
    );
  });
}

export {
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  flush,
};

export {
  track,
  metric,
  count,
  setMetricDimension,
  setRoute,
  startInteraction,
  refreshConfig,
  shutdown,
  getInstanceId,
  setAttribute,
  setAttributes,
  removeAttribute,
  clearAttributes,
} from "@tracewayapp/frontend";

declare global {
  function jQuery(selector: any): any;
  function $(selector: any): any;
}
