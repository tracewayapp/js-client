import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp, defineComponent, h } from "vue";
import { createTracewayPlugin, TracewayKey } from "./plugin.js";

vi.mock("@tracewayapp/frontend", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  recordAction: vi.fn(),
  trackRouter: vi.fn(),
}));

vi.mock("@tracewayapp/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tracewayapp/core")>()),
  debugLog: vi.fn(),
}));

import * as traceway from "@tracewayapp/frontend";

describe("createTracewayPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call traceway.init with connection string and options", () => {
    const app = createApp({ render: () => h("div") });
    const plugin = createTracewayPlugin({
      token: "test-token", baseUrl: "https://example.com",
      options: { debug: true },
    });

    app.use(plugin);

    expect(traceway.init).toHaveBeenCalledWith({
      token: "test-token",
      baseUrl: "https://example.com",
      debug: true,
    });
  });

  it("passes the replay privacy limits through to init (§14.5)", () => {
    createApp({ render: () => h("div") }).use(
      createTracewayPlugin({
        token: "test-token",
        options: { replayImages: "off", collection: { replay: { maskAllInputs: true } } },
      }),
    );
    expect(traceway.init).toHaveBeenCalledWith(
      expect.objectContaining({
        replayImages: "off",
        collection: { replay: { maskAllInputs: true } },
      }),
    );
  });

  it("still takes the deprecated connectionString field", () => {
    createApp({ render: () => h("div") }).use(
      createTracewayPlugin({
        connectionString: "test-token@https://example.com/api/report",
        options: { debug: true },
      }),
    );
    expect(traceway.init).toHaveBeenCalledWith("test-token@https://example.com/api/report", { debug: true });
  });

  it("hands Vue Router to the SDK whichever plugin is installed first", async () => {
    const { createRouter, createMemoryHistory } = await import("vue-router");
    const routes = [{ path: "/", component: { render: () => h("div") } }];
    const plugin = () =>
      createTracewayPlugin({ token: "token", baseUrl: "https://example.com" });

    const first = createRouter({ history: createMemoryHistory(), routes });
    createApp({ render: () => h("div") }).use(first).use(plugin());
    expect(traceway.trackRouter).toHaveBeenCalledWith(first);

    vi.clearAllMocks();
    const second = createRouter({ history: createMemoryHistory(), routes });
    createApp({ render: () => h("div") }).use(plugin()).use(second);
    expect(traceway.trackRouter).not.toHaveBeenCalledWith(second);
    await Promise.resolve();
    expect(traceway.trackRouter).toHaveBeenCalledWith(second);
  });

  it("should provide traceway context to the app", () => {
    let injectedContext: unknown;

    const TestComponent = defineComponent({
      setup() {
        const { inject } = require("vue");
        injectedContext = inject(TracewayKey);
        return () => h("div");
      },
    });

    const app = createApp(TestComponent);
    const plugin = createTracewayPlugin({
      token: "test-token", baseUrl: "https://example.com",
    });

    app.use(plugin);
    app.mount(document.createElement("div"));

    expect(injectedContext).toBeDefined();
    expect(injectedContext).toHaveProperty("captureException");
    expect(injectedContext).toHaveProperty("captureExceptionWithAttributes");
    expect(injectedContext).toHaveProperty("captureMessage");
  });

  it("should set up error handler that captures exceptions", () => {
    const app = createApp({ render: () => h("div") });
    const plugin = createTracewayPlugin({
      token: "test-token", baseUrl: "https://example.com",
    });

    app.use(plugin);

    expect(app.config.errorHandler).toBeDefined();

    // Without a handler of the app's, the error goes on to Vue's own handling (rethrown in development).
    const testError = new Error("Test error");
    expect(() => app.config.errorHandler!(testError, null, "test info")).toThrow(testError);

    expect(traceway.captureException).toHaveBeenCalledWith(testError);
  });

  it("should capture non-Error values as messages", () => {
    const app = createApp({ render: () => h("div") });
    const plugin = createTracewayPlugin({
      token: "test-token", baseUrl: "https://example.com",
    });

    app.use(plugin);

    expect(() => app.config.errorHandler!("string error", null, "test info")).toThrow();

    expect(traceway.captureMessage).toHaveBeenCalledWith("string error");
  });

  // It used to assert that nothing reached console.error: with the plugin and no handler of the app's, errors were
  // silent. Vue's own handling must stay (CONTRACT §13.3), so the plugin only adds nothing of its own to it.
  it("adds no console output of its own in non-debug mode", () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const app = createApp({ render: () => h("div") });
    app.config.errorHandler = () => {};
    const plugin = createTracewayPlugin({
      token: "test-token", baseUrl: "https://example.com",
    });
    app.use(plugin);

    app.config.errorHandler!(new Error("boom"), null, "test info");

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("without a handler of the app's, keeps Vue's own handling: rethrown in development", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const Boom = defineComponent({
      setup() {
        throw new Error("render boom");
      },
      render: () => h("div"),
    });
    expect(() => createApp(Boom).mount(document.createElement("div"))).toThrow("render boom");

    const app = createApp(Boom);
    app.use(createTracewayPlugin({ token: "test-token", baseUrl: "https://example.com" }));
    expect(() => app.mount(document.createElement("div"))).toThrow("render boom");
    expect(traceway.captureException).toHaveBeenCalledTimes(1);
  });

  it("without a handler of the app's, keeps Vue's own handling: logged in production", async () => {
    // The app above runs Vue's development build. Vue calls an errorHandler through callWithErrorHandling; its
    // production build is loaded here directly to run the production path with the plugin's handler.
    const { createRequire } = await import("node:module");
    const prod = createRequire(import.meta.url)(
      "@vue/runtime-core/dist/runtime-core.cjs.prod.js",
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp({ render: () => h("div") });
    app.use(
      createTracewayPlugin({
        token: "test-token", baseUrl: "https://example.com",
      }),
    );
    const error = new Error("render boom");
    // 10 is Vue's ErrorCodes.APP_ERROR_HANDLER, the code Vue itself calls the app's errorHandler with.
    expect(() =>
      prod.callWithErrorHandling(app.config.errorHandler, null, 10, [
        error,
        null,
        "setup function",
      ]),
    ).not.toThrow();
    expect(traceway.captureException).toHaveBeenCalledWith(error);
    expect(logged).toHaveBeenCalledWith(error);
    logged.mockRestore();
  });

  it("logs one debug line with the page's own console.warn, not console.error (JS2-15)", async () => {
    // The SDK's debug flag is set by init(), which is mocked here, so the line is checked at debugLog.
    const { debugLog } = await import("@tracewayapp/core");
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const app = createApp({ render: () => h("div") });
    const plugin = createTracewayPlugin({
      token: "test-token", baseUrl: "https://example.com",
      options: { debug: true },
    });
    app.use(plugin);

    const error = new Error("boom");
    expect(() => app.config.errorHandler!(error, null, "test info")).toThrow();

    expect(debugLog).toHaveBeenCalledWith("Vue error (test info)", error);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should keep calling an error handler installed before the plugin", () => {
    const app = createApp({ render: () => h("div") });
    const previous = vi.fn();
    app.config.errorHandler = previous;
    app.use(
      createTracewayPlugin({
        token: "test-token", baseUrl: "https://example.com",
      }),
    );

    const error = new Error("boom");
    app.config.errorHandler!(error, null, "test info");

    expect(traceway.captureException).toHaveBeenCalledWith(error);
    expect(previous).toHaveBeenCalledWith(error, null, "test info");
  });

  it("should leave Vue's error handling alone where there is no window", () => {
    const realWindow = globalThis.window;
    // @ts-expect-error simulating a server-side render
    delete globalThis.window;
    try {
      const app = createApp({ render: () => h("div") });
      app.use(
        createTracewayPlugin({
          token: "test-token", baseUrl: "https://example.com",
        }),
      );
      expect(app.config.errorHandler).toBeUndefined();
    } finally {
      globalThis.window = realWindow;
    }
  });
});

describe("createTracewayPlugin — real component errors flow through to captureException", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures an error thrown during a child component's setup()", () => {
    const Throwing = defineComponent({
      setup() {
        throw new Error("vue-setup-error");
      },
      render: () => h("div"),
    });

    const app = createApp({
      render: () => h(Throwing),
    });
    app.use(
      createTracewayPlugin({
        token: "test-token", baseUrl: "https://example.com",
      }),
    );
    // As without the plugin: in development Vue rethrows an error no handler of the app's took.
    expect(() => app.mount(document.createElement("div"))).toThrow("vue-setup-error");

    expect(traceway.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "vue-setup-error" }),
    );
  });

  it("captures an error thrown during a child component's render()", () => {
    const Throwing = defineComponent({
      render() {
        throw new Error("vue-render-error");
      },
    });

    const app = createApp({
      render: () => h(Throwing),
    });
    app.use(
      createTracewayPlugin({
        token: "test-token", baseUrl: "https://example.com",
      }),
    );
    expect(() => app.mount(document.createElement("div"))).toThrow("vue-render-error");

    expect(traceway.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "vue-render-error" }),
    );
  });

  it("captures a non-Error throw as a message", () => {
    const Throwing = defineComponent({
      setup() {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "string-error-from-vue";
      },
      render: () => h("div"),
    });

    const app = createApp({
      render: () => h(Throwing),
    });
    app.use(
      createTracewayPlugin({
        token: "test-token", baseUrl: "https://example.com",
      }),
    );
    expect(() => app.mount(document.createElement("div"))).toThrow();

    expect(traceway.captureMessage).toHaveBeenCalledWith("string-error-from-vue");
  });
});
