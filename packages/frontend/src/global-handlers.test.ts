import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installGlobalHandlers } from "./global-handlers.js";
import { TracewayFrontendClient } from "./client.js";

describe("installGlobalHandlers", () => {
  let client: TracewayFrontendClient;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    vi.stubGlobal("CompressionStream", createMockCompressionStream());
    client = new TracewayFrontendClient(
      "test-token@https://example.com/api/report",
      { debounceMs: 10000 },
    );
    window.onerror = null;
    window.onunhandledrejection = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should install window.onerror handler", () => {
    installGlobalHandlers(client);
    expect(window.onerror).toBeTypeOf("function");
  });

  it("should install window.onunhandledrejection handler", () => {
    installGlobalHandlers(client);
    expect(window.onunhandledrejection).toBeTypeOf("function");
  });

  it("should capture error from window.onerror", () => {
    const addSpy = vi.spyOn(client, "addException");
    installGlobalHandlers(client);

    const err = new Error("test onerror");
    window.onerror!("test", "file.js", 1, 1, err);

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls[0][0].isMessage).toBe(false);
  });

  it("should capture from window.onerror without error object", () => {
    const addSpy = vi.spyOn(client, "addException");
    installGlobalHandlers(client);

    (window.onerror as Function)(
      "Something went wrong",
      "file.js",
      1,
      1,
      undefined,
    );

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls[0][0].stackTrace).toBe("Something went wrong");
  });

  it("should chain with previous onerror handler", () => {
    const prevHandler = vi.fn();
    window.onerror = prevHandler;

    installGlobalHandlers(client);
    const err = new Error("chained");
    window.onerror!("test", "file.js", 1, 1, err);

    expect(prevHandler).toHaveBeenCalled();
  });

  it("should capture unhandled rejection with Error", () => {
    const addSpy = vi.spyOn(client, "addException");
    installGlobalHandlers(client);

    const event = {
      reason: new TypeError("rejected"),
      promise: Promise.resolve(),
    } as PromiseRejectionEvent;
    window.onunhandledrejection!(event);

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls[0][0].stackTrace).toContain("TypeError");
  });

  it("should capture unhandled rejection with string", () => {
    const addSpy = vi.spyOn(client, "addException");
    installGlobalHandlers(client);

    const event = {
      reason: "string error",
      promise: Promise.resolve(),
    } as PromiseRejectionEvent;
    window.onunhandledrejection!(event);

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls[0][0].stackTrace).toBe("string error");
  });
});

function createMockCompressionStream() {
  return class MockCompressionStream {
    writable: WritableStream;
    readable: ReadableStream;

    constructor() {
      let data: Uint8Array = new Uint8Array(0);

      this.writable = new WritableStream({
        write(chunk) {
          data = chunk;
        },
      });

      this.readable = new ReadableStream({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(data);
            controller.close();
          }, 0);
        },
      });
    }
  };
}
