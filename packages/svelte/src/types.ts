import type { TracewayFrontendOptions } from "@tracewayapp/frontend";
import * as traceway from "@tracewayapp/frontend";

export interface TracewayOptions {
  connectionString: string;
  options?: TracewayFrontendOptions;
}

export interface TracewayContextValue {
  captureException: typeof traceway.captureException;
  captureExceptionWithAttributes: typeof traceway.captureExceptionWithAttributes;
  captureMessage: typeof traceway.captureMessage;
}
