import { context, propagation } from "@opentelemetry/api";
import { FetchInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/fetch";
import { NavigationInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/navigation";
import { UserActionInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/user-action";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { StackContextManager } from "@opentelemetry/sdk-trace";
import { guarded } from "../guarded.js";

type Method = (this: unknown, ...args: any[]) => any;

/** A subclass of `Base` whose `method` is `replace(the base method)`: the methods patched here are private. */
function override<T extends abstract new (...args: any[]) => object>(
  Base: T,
  method: string,
  replace: (base: Method) => Method,
): T {
  abstract class Patched extends Base {}
  (Patched.prototype as any)[method] = replace((Base.prototype as any)[method]);
  return Patched;
}

/**
 * Clicks, contained: the selector of the clicked element is built inside the page's click dispatch. A click on an
 * icon is the `<svg>` or `<path>` it lands on, which the Browser SIG instrumentation skips: it is reported as a click
 * on the nearest HTML element, the button around the icon.
 */
export const ClickInstrumentation = override(
  UserActionInstrumentation,
  "onClick",
  (base) =>
    function (event: MouseEvent) {
      guarded("clicks", () => {
        let target = event.target as Element | null;
        while (target && !(target instanceof HTMLElement))
          target = target.parentElement;
        base.call(
          this,
          target === event.target
            ? event
            : {
                type: event.type,
                button: event.button,
                pageX: event.pageX,
                pageY: event.pageY,
                target,
              },
        );
      });
    },
);

/** Soft navigations, contained: they are recorded inside the app's own `history.pushState` call, after it ran. */
export const SafeNavigationInstrumentation = override(
  NavigationInstrumentation,
  "_onSoftNavigation",
  (base) =>
    function (...args) {
      guarded("navigation", () => base.apply(this, args));
    },
);

/** Set by `_addHeaders`, which runs only for a request the base instrumentation traces, right before it is sent. */
let traced = false;

/**
 * The Browser SIG's fetch instrumentation with two changes. Its span ends when the response arrives, not once a copy
 * of the body was read to the end: that copy is a tee, which keeps the download going after the app cancels the
 * body and holds in memory what the app has not read yet. And the app's own `Request` object is not given a
 * `traceparent` header, a copy of it is sent, as native `fetch` would never change its argument.
 */
export const SafeFetchInstrumentation = override(
  override(
    FetchInstrumentation,
    "_addHeaders",
    (base) =>
      function (options: unknown, ...rest) {
        const result = base.call(
          this,
          options instanceof Request ? new Request(options) : options,
          ...rest,
        );
        traced = true;
        return result;
      },
  ),
  "_patchConstructor",
  (base) =>
    function () {
      const patch = base.call(this);
      return (original: typeof fetch) =>
        patch(function (this: unknown, ...args: Parameters<typeof fetch>) {
          const hide = traced;
          traced = false;
          const sent = original.apply(this, args);
          // The base instrumentation reads `response.clone().body` first thing: this copy has no body.
          return hide
            ? sent.then((response) => {
                guarded("fetch", () =>
                  Object.defineProperty(response, "clone", {
                    configurable: true,
                    value: () => (delete (response as any).clone, {}),
                  }),
                );
                return response;
              })
            : sent;
        });
    },
);

/**
 * W3C propagation and a context manager for this SDK's requests and interactions, without registering them as the
 * page's OpenTelemetry globals: the API refuses a second registration, so an app that sets up its own OpenTelemetry
 * after `init()` would silently lose its propagator and context manager. They stand in for the API's no-op ones,
 * which it uses only while the page has registered none; once the app registers its own, the API uses those, for
 * the app and for Traceway. Returns what undoes it.
 */
export function standInForGlobals(): () => void {
  const registry =
    (globalThis as any)[Symbol.for("opentelemetry.js.api.1")] ?? {};
  const undo: Array<() => void> = [];
  guarded("context", () => {
    for (const [type, noop, impl] of [
      [
        "context",
        (context as any)._getContextManager(),
        new StackContextManager().enable(),
      ],
      [
        "propagation",
        (propagation as any)._getGlobalPropagator(),
        new W3CTraceContextPropagator(),
      ],
    ]) {
      if (registry[type]) continue;
      // The no-op object runs the stand-in's methods; the context manager keeps its state on `this`.
      const proto = Object.getPrototypeOf(noop);
      Object.setPrototypeOf(noop, impl);
      undo.push(() => Object.setPrototypeOf(noop, proto));
    }
  });
  return () => undo.forEach((step) => step());
}
