import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp, defineComponent, h } from "vue";
import { createTracewayPlugin } from "./plugin.js";
import { useTraceway } from "./use-traceway.js";

vi.mock("@tracewayapp/frontend", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
}));

describe("useTraceway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return traceway methods when used within plugin", () => {
    let result: ReturnType<typeof useTraceway> | undefined;

    const TestComponent = defineComponent({
      setup() {
        result = useTraceway();
        return () => h("div");
      },
    });

    const app = createApp(TestComponent);
    app.use(
      createTracewayPlugin({
        connectionString: "test@https://example.com/api/report",
      })
    );
    app.mount(document.createElement("div"));

    expect(result).toBeDefined();
    expect(result!.captureException).toBeDefined();
    expect(result!.captureExceptionWithAttributes).toBeDefined();
    expect(result!.captureMessage).toBeDefined();
  });

  it("should throw when used outside plugin", () => {
    const TestComponent = defineComponent({
      setup() {
        useTraceway();
        return () => h("div");
      },
    });

    const app = createApp(TestComponent);
    const container = document.createElement("div");

    expect(() => {
      app.mount(container);
    }).toThrow("useTraceway must be used within a Vue app that has installed the Traceway plugin");
  });
});
