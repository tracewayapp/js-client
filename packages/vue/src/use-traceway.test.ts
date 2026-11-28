import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp, defineComponent, h } from "vue";
import { createTracewayPlugin } from "./plugin.js";
import { useTraceway } from "./use-traceway.js";

vi.mock("@tracewayapp/frontend", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  recordAction: vi.fn(),
  trackRouter: vi.fn(),
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
        token: "test", baseUrl: "https://example.com",
      })
    );
    app.mount(document.createElement("div"));

    expect(result).toBeDefined();
    expect(result!.captureException).toBeDefined();
    expect(result!.captureExceptionWithAttributes).toBeDefined();
    expect(result!.captureMessage).toBeDefined();
  });

  // It used to throw; an app that calls init() itself would crash on it (CONTRACT §13).
  it("returns the SDK's capture functions when used outside the plugin", () => {
    let result: ReturnType<typeof useTraceway> | undefined;
    const TestComponent = defineComponent({
      setup() {
        result = useTraceway();
        return () => h("div");
      },
    });

    const app = createApp(TestComponent);
    expect(() => app.mount(document.createElement("div"))).not.toThrow();
    expect(result!.captureException).toBeDefined();
    expect(result!.captureMessage).toBeDefined();
  });
});
