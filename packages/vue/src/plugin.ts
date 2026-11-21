import type { App, InjectionKey } from "vue";
import * as traceway from "@tracewayapp/frontend";
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
        recordAction: traceway.recordAction,
      };

      app.provide(TracewayKey, context);

      // Vue Router is usually installed next to this plugin, before or after it: views are named by its route
      // patterns without the app calling `trackRouter`.
      const useRouter = () =>
        traceway.trackRouter(app.config.globalProperties.$router);
      useRouter();
      Promise.resolve().then(useRouter);

      // On the server there is nothing to report to: the SDK only runs in the browser. A handler that swallowed
      // render errors there would hide them from the framework, so Vue's own handling stays in place.
      if (typeof window === "undefined") return;

      const debug = pluginOptions.options?.debug === true;
      const previous = app.config.errorHandler;

      app.config.errorHandler = (err, instance, info) => {
        if (err instanceof Error) {
          traceway.captureException(err);
        } else {
          traceway.captureMessage(String(err));
        }
        if (debug) {
          console.error("[Traceway] Vue error:", err);
          console.error("[Traceway] Component:", instance);
          console.error("[Traceway] Info:", info);
        }
        // A handler the app or its framework installed before this plugin keeps working.
        previous?.(err, instance, info);
      };
    },
  };
}
