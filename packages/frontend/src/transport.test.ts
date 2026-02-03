import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendReport } from "./transport.js";

describe("sendReport", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200 }),
    );
    vi.stubGlobal("CompressionStream", createMockCompressionStream());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should send with correct headers", async () => {
    const result = await sendReport(
      "https://example.com/api/report",
      "my-token",
      '{"test": true}',
    );

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe("https://example.com/api/report");
    const opts = call[1]!;
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        Authorization: "Bearer my-token",
      }),
    );
  });

  it("should return false on non-200 status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 401 }),
    );
    const result = await sendReport("https://example.com/api/report", "bad-token", "{}");
    expect(result).toBe(false);
  });

  it("should send compressed body", async () => {
    await sendReport("https://example.com/api/report", "token", '{"data": 1}');
    const body = vi.mocked(fetch).mock.calls[0][1]!.body;
    expect(body).toBeInstanceOf(Uint8Array);
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
