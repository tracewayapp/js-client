import {
  init as frontendInit,
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  flush,
  getActiveDistributedTraceId,
} from "@tracewayapp/frontend";
import type { TracewayFrontendOptions } from "@tracewayapp/frontend";

export interface TracewayJQueryOptions extends TracewayFrontendOptions {}

export function init(
  connectionString: string,
  options: TracewayJQueryOptions = {},
): void {
  frontendInit(connectionString, options);
  installJQueryErrorHandler();
}

function installJQueryErrorHandler(): void {
  const jq =
    typeof jQuery !== "undefined"
      ? jQuery
      : typeof $ !== "undefined" && typeof ($ as any).ajax === "function"
        ? ($ as any)
        : null;
  if (!jq) return;

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

    const distributedTraceId =
      jqXHR?.getResponseHeader?.("traceway-trace-id") ??
      getActiveDistributedTraceId();

    captureExceptionWithAttributes(
      new Error(`${method} ${url} failed: ${status} ${message}`),
      { url, method, status: String(status) },
      { distributedTraceId: distributedTraceId ?? undefined },
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
  DISTRIBUTED_TRACE_HEADER,
  getActiveDistributedTraceId,
  createAxiosInterceptor,
} from "@tracewayapp/frontend";

declare global {
  function jQuery(selector: any): any;
  function $(selector: any): any;
}
