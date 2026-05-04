import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gunzipSync, strFromU8 } from "fflate";
import { TracewayReactNativeClient } from "./client.js";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function decodeBody(body: BodyInit | null | undefined): unknown {
  if (!(body instanceof Uint8Array)) {
    throw new Error("expected Uint8Array body, got " + typeof body);
  }
  return JSON.parse(strFromU8(gunzipSync(body)));
}

describe("TracewayReactNativeClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createClient(debounceMs = 50) {
    return new TracewayReactNativeClient(
      "test-token@https://example.com/api/report",
      { debounceMs },
    );
  }

  it("debounces and posts an exception to the configured endpoint", async () => {
    const client = createClient(20);
    client.addException({
      traceId: null,
      stackTrace: "Error: boom\n",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await sleep(80);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://example.com/api/report");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(headers["Content-Encoding"]).toBe("gzip");
  });

  it("sends the body as gzipped JSON", async () => {
    const client = createClient(20);
    client.addException({
      traceId: null,
      stackTrace: "Error: boom\n",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await sleep(80);

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = (init as RequestInit).body;
    expect(body).toBeInstanceOf(Uint8Array);
    const parsed = decodeBody(body) as {
      collectionFrames: Array<{
        stackTraces: Array<{ stackTrace: string }>;
      }>;
    };
    expect(parsed.collectionFrames[0].stackTraces).toHaveLength(1);
    expect(parsed.collectionFrames[0].stackTraces[0].stackTrace).toBe(
      "Error: boom\n",
    );
  });

  it("attaches buffered logs and actions to the report when present", async () => {
    const client = createClient(20);
    client.recordLog("info", "user tapped pay");
    client.recordAction("cart", "add_item", { sku: "SKU-1" });

    client.addException({
      traceId: null,
      stackTrace: "Error: boom\n",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await sleep(80);

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = decodeBody((init as RequestInit).body) as {
      collectionFrames: Array<{
        sessionRecordings: Array<{
          logs: Array<{ message: string }>;
          actions: Array<{ name?: string }>;
        }>;
      }>;
    };
    const recording = parsed.collectionFrames[0].sessionRecordings[0];
    expect(recording.logs).toHaveLength(1);
    expect(recording.logs[0].message).toBe("user tapped pay");
    expect(recording.actions).toHaveLength(1);
    expect(recording.actions[0].name).toBe("add_item");
  });

  it("respects ignoreErrors patterns", async () => {
    const client = new TracewayReactNativeClient(
      "test-token@https://example.com/api/report",
      { debounceMs: 20, ignoreErrors: ["IgnoreMe"] },
    );

    client.addException({
      traceId: null,
      stackTrace: "Error: IgnoreMe please\n",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await sleep(80);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("re-queues exceptions on transport failure and retries", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        calls++;
        return { status: calls === 1 ? 500 : 200 };
      }),
    );

    const client = new TracewayReactNativeClient(
      "test-token@https://example.com/api/report",
      { debounceMs: 20, retryDelayMs: 30 },
    );

    client.addException({
      traceId: null,
      stackTrace: "Error: transient\n",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await sleep(150);
    expect(calls).toBe(2);
  });

  it("flush forces a sync immediately", async () => {
    const client = createClient(60_000);
    client.addException({
      traceId: null,
      stackTrace: "Error: flush me\n",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await client.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
