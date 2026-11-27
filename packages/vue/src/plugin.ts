import type { App, InjectionKey } from "vue";
import { debugLog, guarded } from "@tracewayapp/core";
import * as traceway from "@tracewayapp/frontend";
import { startTraceway } from "./types.js";
import type { TracewayPluginOptions, TracewayContextValue } from "./types.js";

export const TracewayKey: InjectionKey<TracewayContextValue> = Symbol("traceway");

/** What the plugin provides, and what `useTraceway()` returns without it: the functions work wherever the SDK runs. */
export const tracewayContext: TracewayContextValue = {
  captureException: traceway.captureException,
  captureExceptionWithAttributes: traceway.captureExceptionWithAttributes,
  captureMessage: traceway.captureMessage,
  recordAction: traceway.recordAction,
};

export function createTracewayPlugin(pluginOptions: TracewayPluginOptions) {
  return {
    install(app: App) {
      // Inside the app's `app.use()`: a failure here (a build without its token) must not stop the app.
      guarded("vue.install", () => startTraceway(pluginOptions));

      app.provide(TracewayKey, tracewayContext);

      // Vue Router is usually installed next to this plugin, before or after it: views are named by its route
      // patterns without the app calling `trackRouter`.
      const useRouter = () =>
        guarded("vue.install", () =>
          traceway.trackRouter(app.config.globalProperties.$router),
        );
      useRouter();
      Promise.resolve().then(useRouter);

      // On the server there is nothing to report to: the SDK only runs in the browser. A handler that swallowed
      // render errors there would hide them from the framework, so Vue's own handling stays in place.
      if (typeof window === "undefined") return;

      const previous = app.config.errorHandler;

      app.config.errorHandler = (err, instance, info) => {
        guarded("vue.errorHandler", () => {
          if (err instanceof Error) {
            traceway.captureException(err);
          } else {
            traceway.captureMessage(String(err));
          }
          // With debug on: the page's own console.warn, so the line is not recorded as a log of the app.
          debugLog(`Vue error (${info})`, err);
        });
        // A handler the app or its framework installed before this plugin keeps working.
        if (previous) return previous(err, instance, info);
        // Without one, Vue's own handling must still happen: with an errorHandler set, Vue would only call it. Vue
        // treats an error its errorHandler throws as unhandled and does what it does without a handler: logs it with
        // console.error in production and rethrows it in development.
        throw err;
      };
    },
  };
}
