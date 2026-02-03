import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TracewayFrontendClient } from "./client.js";

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
});
