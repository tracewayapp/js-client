import type { App, InjectionKey } from "vue";
import * as traceway from "@traceway/frontend";
import type { TracewayPluginOptions, TracewayContextValue } from "./types.js";

export const TracewayKey: InjectionKey<TracewayContextValue> = Symbol("traceway");

export function createTracewayPlugin(pluginOptions: TracewayPluginOptions) {
  return {
    install(app: App) {
      traceway.init(pluginOptions.connectionString, pluginOptions.options);

      const context: TracewayContextValue = {
        captureException: traceway.captureException,
        captureExceptionWithAttributes: traceway.captureExceptionWithAttributes,
        captureMessage: traceway.captureMessage,
      };

      app.provide(TracewayKey, context);

      app.config.errorHandler = (err, instance, info) => {
        if (err instanceof Error) {
          traceway.captureException(err);
        } else {
          traceway.captureMessage(String(err));
        }
        console.error("[Traceway] Vue error:", err);
        console.error("[Traceway] Component:", instance);
        console.error("[Traceway] Info:", info);
      };
    },
  };
}
