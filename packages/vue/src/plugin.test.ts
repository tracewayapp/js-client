import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp, defineComponent, h } from "vue";
import { createTracewayPlugin, TracewayKey } from "./plugin.js";

vi.mock("@tracewayapp/frontend", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  recordAction: vi.fn(),
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
