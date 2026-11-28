// CONTRACT §13: what the Vue plugin runs inside the app never throws because of the SDK, and the app's own errors
// still get the handling they would get without Traceway.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h } from "vue";

vi.mock("@tracewayapp/frontend", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  recordAction: vi.fn(),
  trackRouter: vi.fn(),
  setRoute: vi.fn(),
  setAttributes: vi.fn(),
  removeAttribute: vi.fn(),
}));

import * as traceway from "@tracewayapp/frontend";
import { createTracewayPlugin } from "./plugin.js";
import { trackRouter } from "./track-router.js";

const sdkBug = () => {
  throw new Error("sdk bug");
};
const plugin = () =>
  createTracewayPlugin({ token: "t", baseUrl: "https://t.test" });

afterEach(() => {
  for (const fn of [
    traceway.init,
    traceway.trackRouter,
    traceway.captureException,
    traceway.captureMessage,
    traceway.setRoute,
  ])
    vi.mocked(fn).mockReset();
  vi.restoreAllMocks();
});

describe("Vue plugin (JS-1, JS-7, JS-9)", () => {
  it("app.use() does not throw when init() or trackRouter() fail", async () => {
    vi.mocked(traceway.init).mockImplementation(sdkBug);
    vi.mocked(traceway.trackRouter).mockImplementation(sdkBug);
    const app = createApp({ render: () => h("div") });
    expect(() =>
      app.use(createTracewayPlugin({ token: "" })),
    ).not.toThrow();
    await Promise.resolve();
    expect(() => app.mount(document.createElement("div"))).not.toThrow();
  });

  it("hands the app's handler the app's error when the capture fails", () => {
    vi.mocked(traceway.captureException).mockImplementation(sdkBug);
    const previous = vi.fn();
    const app = createApp({ render: () => h("div") });
    app.config.errorHandler = previous;
    app.use(plugin());
    const error = new Error("app");
    expect(() =>
      app.config.errorHandler!(error, null, "setup function"),
    ).not.toThrow();
    expect(previous).toHaveBeenCalledWith(error, null, "setup function");
  });

  it("without a handler of the app's, gives Vue the app's error, not the SDK's", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(traceway.captureException).mockImplementation(sdkBug);
    const app = createApp(
      defineComponent({
        setup() {
          throw new Error("render boom");
        },
        render: () => h("div"),
      }),
    );
    app.use(plugin());
    expect(() => app.mount(document.createElement("div"))).toThrow(
      "render boom",
    );
  });

  it("trackRouter's navigation guard never throws", () => {
    vi.mocked(traceway.setRoute).mockImplementation(sdkBug);
    let guard!: (to: unknown) => void;
    trackRouter({ afterEach: (fn) => (guard = fn as typeof guard) });
    expect(() => guard({ matched: [{ path: "/orders/:id" }] })).not.toThrow();
    expect(() => guard({ matched: null })).not.toThrow();
  });

  it("trackRouter() of something that is not a router does not throw into the app's setup (JS2-16)", () => {
    expect(() => trackRouter(undefined as never)).not.toThrow();
    expect(() => trackRouter({} as never)).not.toThrow();
    expect(() => trackRouter({ afterEach: 42 } as never)).not.toThrow();
  });

  it("useTracewayAttributes survives values it cannot use; the app's own getter still throws to Vue (JS2-17)", async () => {
    const { ref, nextTick } = await import("vue");
    const { useTracewayAttributes } = await import("./use-traceway-attributes.js");
    const attributes = ref<unknown>({ plan: "pro" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = createApp(
      defineComponent({
        setup() {
          useTracewayAttributes(attributes as never);
          return () => h("div");
        },
      }),
    );
    const errors: unknown[] = [];
    app.config.errorHandler = (err) => void errors.push(err);
    app.mount(document.createElement("div"));
    attributes.value = "not an object";
    await nextTick();
    attributes.value = { plan: Symbol("x") };
    await nextTick();
    expect(errors).toEqual([]);
    expect(traceway.removeAttribute).toHaveBeenCalledWith("plan");
    app.unmount();
    warn.mockRestore();
  });
});
