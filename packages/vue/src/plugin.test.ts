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

import * as traceway from "@tracewayapp/frontend";

describe("createTracewayPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call traceway.init with connection string and options", () => {
    const app = createApp({ render: () => h("div") });
    const plugin = createTracewayPlugin({
      connectionString: "test-token@https://example.com/api/report",
      options: { debug: true },
    });

    app.use(plugin);

    expect(traceway.init).toHaveBeenCalledWith(
      "test-token@https://example.com/api/report",
      { debug: true }
    );
  });

  it("hands Vue Router to the SDK whichever plugin is installed first", async () => {
    const { createRouter, createMemoryHistory } = await import("vue-router");
    const routes = [{ path: "/", component: { render: () => h("div") } }];
    const plugin = () =>
      createTracewayPlugin({ connectionString: "token@https://example.com" });

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
      connectionString: "test-token@https://example.com/api/report",
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
      connectionString: "test-token@https://example.com/api/report",
    });

    app.use(plugin);

    expect(app.config.errorHandler).toBeDefined();

    const testError = new Error("Test error");
    app.config.errorHandler!(testError, null, "test info");

    expect(traceway.captureException).toHaveBeenCalledWith(testError);
  });

  it("should capture non-Error values as messages", () => {
    const app = createApp({ render: () => h("div") });
    const plugin = createTracewayPlugin({
      connectionString: "test-token@https://example.com/api/report",
    });

    app.use(plugin);

    app.config.errorHandler!("string error", null, "test info");

    expect(traceway.captureMessage).toHaveBeenCalledWith("string error");
  });

  it("does NOT spam console.error in non-debug mode", () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const app = createApp({ render: () => h("div") });
    const plugin = createTracewayPlugin({
      connectionString: "test-token@https://example.com/api/report",
    });
    app.use(plugin);

    app.config.errorHandler!(new Error("boom"), null, "test info");

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("logs to console.error in debug mode", () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const app = createApp({ render: () => h("div") });
    const plugin = createTracewayPlugin({
      connectionString: "test-token@https://example.com/api/report",
      options: { debug: true },
    });
    app.use(plugin);

    app.config.errorHandler!(new Error("boom"), null, "test info");

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should keep calling an error handler installed before the plugin", () => {
    const app = createApp({ render: () => h("div") });
    const previous = vi.fn();
    app.config.errorHandler = previous;
    app.use(
      createTracewayPlugin({
        connectionString: "test-token@https://example.com/api/report",
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
          connectionString: "test-token@https://example.com/api/report",
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
        connectionString: "test-token@https://example.com/api/report",
      }),
    );
    app.mount(document.createElement("div"));

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
        connectionString: "test-token@https://example.com/api/report",
      }),
    );
    app.mount(document.createElement("div"));

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
        connectionString: "test-token@https://example.com/api/report",
      }),
    );
    app.mount(document.createElement("div"));

    expect(traceway.captureMessage).toHaveBeenCalledWith("string-error-from-vue");
  });
});
