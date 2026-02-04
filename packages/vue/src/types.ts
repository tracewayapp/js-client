import type { TracewayFrontendOptions } from "@traceway/frontend";
import * as traceway from "@traceway/frontend";

export interface TracewayPluginOptions {
  connectionString: string;
  options?: TracewayFrontendOptions;
}

export interface TracewayContextValue {
  captureException: typeof traceway.captureException;
  captureExceptionWithAttributes: typeof traceway.captureExceptionWithAttributes;
  captureMessage: typeof traceway.captureMessage;
}
