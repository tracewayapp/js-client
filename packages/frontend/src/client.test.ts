import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TracewayFrontendClient,
  DEFAULT_IGNORE_PATTERNS,
} from "./client.js";

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
          queueMicrotask(() => {
            controller.enqueue(data);
            controller.close();
          });
        },
      });
    }
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("TracewayFrontendClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    vi.stubGlobal("CompressionStream", createMockCompressionStream());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createClient(debounceMs = 50) {
    return new TracewayFrontendClient(
      "test-token@https://example.com/api/report",
      { debounceMs },
    );
  }

  it("should debounce and batch exceptions", async () => {
    const client = createClient(50);
    client.addException({
      traceId: null,
      stackTrace: "Error: test1",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });
    client.addException({
      traceId: null,
      stackTrace: "Error: test2",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    expect(fetch).not.toHaveBeenCalled();

    await sleep(100);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("should re-queue on failure and retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({ status: 500 })
        .mockResolvedValue({ status: 200 }),
    );

    const client = createClient(0);
    client.addException({
      traceId: null,
      stackTrace: "Error: test",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await sleep(50);

    expect(vi.mocked(fetch).mock.calls.length).toBe(2);
  });

  it("should flush immediately bypassing debounce", async () => {
    const client = createClient(10000);
    client.addException({
      traceId: null,
      stackTrace: "Error: urgent",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await client.flush();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("should not send when no pending exceptions", async () => {
    const client = createClient(0);
    await client.flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  describe("ignoreErrors", () => {
    it("should ignore errors matching default patterns", async () => {
      const client = createClient(50);

      // Network error (Chrome)
      client.addException({
        traceId: null,
        stackTrace: "TypeError: Failed to fetch",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });
      // Axios 422
      client.addException({
        traceId: null,
        stackTrace: "Error: Request failed with status code 422",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });
      // jQuery 401
      client.addException({
        traceId: null,
        stackTrace: "Error: GET /api/auth failed: 401 Unauthorized",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });
      // Timeout
      client.addException({
        traceId: null,
        stackTrace: "Error: timeout exceeded",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });

      await sleep(100);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should capture non-matching errors with default patterns", async () => {
      const client = createClient(50);
      client.addException({
        traceId: null,
        stackTrace: "ReferenceError: foo is not defined",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });

      await sleep(100);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("should capture all errors when ignoreErrors is empty array", async () => {
      const client = new TracewayFrontendClient(
        "test-token@https://example.com/api/report",
        { debounceMs: 50, ignoreErrors: [] },
      );

      client.addException({
        traceId: null,
        stackTrace: "TypeError: Failed to fetch",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });

      await sleep(100);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("should use custom patterns replacing defaults", async () => {
      const client = new TracewayFrontendClient(
        "test-token@https://example.com/api/report",
        { debounceMs: 50, ignoreErrors: ["custom error"] },
      );

      // Default pattern should NOT be active
      client.addException({
        traceId: null,
        stackTrace: "TypeError: Failed to fetch",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });
      // Custom pattern SHOULD filter
      client.addException({
        traceId: null,
        stackTrace: "Error: custom error occurred",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });

      await sleep(100);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("should handle RegExp with global flag across multiple calls", async () => {
      const client = new TracewayFrontendClient(
        "test-token@https://example.com/api/report",
        { debounceMs: 50, ignoreErrors: [/network/gi] },
      );

      client.addException({
        traceId: null,
        stackTrace: "Network Error",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });
      client.addException({
        traceId: null,
        stackTrace: "Network Error again",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });

      await sleep(100);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("beforeCapture", () => {
    it("should suppress when callback returns false", async () => {
      const client = new TracewayFrontendClient(
        "test-token@https://example.com/api/report",
        { debounceMs: 50, ignoreErrors: [], beforeCapture: () => false },
      );

      client.addException({
        traceId: null,
        stackTrace: "Error: something",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });

      await sleep(100);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should capture when callback returns true", async () => {
      const client = new TracewayFrontendClient(
        "test-token@https://example.com/api/report",
        { debounceMs: 50, ignoreErrors: [], beforeCapture: () => true },
      );

      client.addException({
        traceId: null,
        stackTrace: "Error: something",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });

      await sleep(100);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("should receive attributes for filtering", async () => {
      const client = new TracewayFrontendClient(
        "test-token@https://example.com/api/report",
        {
          debounceMs: 50,
          ignoreErrors: [],
          beforeCapture: (exc) => exc.attributes?.status !== "422",
        },
      );

      client.addException({
        traceId: null,
        stackTrace: "Error: GET /api failed: 422",
        recordedAt: new Date().toISOString(),
        isMessage: false,
        attributes: { url: "/api", method: "GET", status: "422" },
      });

      await sleep(100);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should capture normally when callback throws", async () => {
      const client = new TracewayFrontendClient(
        "test-token@https://example.com/api/report",
        {
          debounceMs: 50,
          ignoreErrors: [],
          beforeCapture: () => {
            throw new Error("broken callback");
          },
        },
      );

      client.addException({
        traceId: null,
        stackTrace: "Error: real error",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });

      await sleep(100);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("should not be called when ignoreErrors already suppressed", async () => {
      const beforeCapture = vi.fn().mockReturnValue(true);
      const client = new TracewayFrontendClient(
        "test-token@https://example.com/api/report",
        {
          debounceMs: 50,
          ignoreErrors: ["Network Error"],
          beforeCapture,
        },
      );

      client.addException({
        traceId: null,
        stackTrace: "TypeError: Network Error",
        recordedAt: new Date().toISOString(),
        isMessage: false,
      });

      await sleep(100);
      expect(beforeCapture).not.toHaveBeenCalled();
    });
  });
});
