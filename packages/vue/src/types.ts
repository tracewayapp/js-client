import type {
  TracewayFrontendOptions,
  StandaloneOptions,
} from "@tracewayapp/frontend";
import * as traceway from "@tracewayapp/frontend";

export interface TracewayPluginOptions {
  /** The project token. */
  token?: string;
  /** The Traceway server, for a self-hosted one. Default `https://cloud.tracewayapp.com`. */
  baseUrl?: string;
  /** Every other option of the browser SDK. */
  options?: TracewayFrontendOptions;
  /** @deprecated Use `token` (and `baseUrl` for a self-hosted server); logs one deprecation warning. */
  connectionString?: string | StandaloneOptions;
}

/** `init()` with the wrapper's fields: `token` and `baseUrl` next to `options`, or the deprecated `connectionString`. */
export function startTraceway({
  token,
  baseUrl,
  options,
  connectionString,
}: TracewayPluginOptions = {}): void {
  if (typeof connectionString === "string")
    traceway.init(connectionString, options);
  else
    traceway.init({
      ...connectionString,
      ...options,
      token: token ?? options?.token ?? connectionString?.token,
      baseUrl: baseUrl ?? options?.baseUrl ?? connectionString?.baseUrl,
    });
}

export interface TracewayContextValue {
  captureException: typeof traceway.captureException;
  captureExceptionWithAttributes: typeof traceway.captureExceptionWithAttributes;
  captureMessage: typeof traceway.captureMessage;
  recordAction: typeof traceway.recordAction;
}
