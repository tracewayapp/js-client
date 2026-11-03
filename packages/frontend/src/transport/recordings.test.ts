import { afterEach, describe, expect, it, vi } from "vitest";
import { gunzipSync, strFromU8 } from "fflate";
import { RecordingsTransport } from "./recordings.js";

function response(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, { status, headers });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RecordingsTransport", () => {
  it("posts gzipped segments with the project token", async () => {
    const fetchImpl = vi.fn(async () => response(200));
    const transport = new RecordingsTransport(
      "https://t.test/api/recordings",
      "tok",
      fetchImpl,
    );
    transport.send([
      { sessionId: "s", segmentIndex: 0, events: [{ type: 2 }] },
    ]);
    await transport.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://t.test/api/recordings");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
    const body = JSON.parse(strFromU8(gunzipSync(init.body as Uint8Array)));
    expect(body).toEqual({
      segments: [{ sessionId: "s", segmentIndex: 0, events: [{ type: 2 }] }],
    });
  });

  it("retries server errors a bounded number of times and drops permanent failures", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => response(503, { "Retry-After": "1" }));
    const transport = new RecordingsTransport("u", "t", fetchImpl);
    transport.send([{ sessionId: "s", events: [{}] }]);
    for (let i = 0; i < 6; i++) await vi.runAllTimersAsync();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(transport.pending()).toBe(0);
    expect(transport.failedSegments).toBe(1);

    const rejected = vi.fn(async () => response(413));
    const other = new RecordingsTransport("u", "t", rejected);
    other.send([{ sessionId: "s", events: [{}] }]);
    await vi.runAllTimersAsync();
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(other.pending()).toBe(0);
    expect(other.failedSegments).toBe(1);
  });

  it("uses keepalive while the page unloads, within the browser's budget", () => {
    const fetchImpl = vi.fn(async () => response(200));
    const transport = new RecordingsTransport("u", "t", fetchImpl);
    transport.send([{ sessionId: "s", events: [{ type: 3 }] }], {
      unloading: true,
    });
    expect(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
        .keepalive,
    ).toBe(true);
  });
});
