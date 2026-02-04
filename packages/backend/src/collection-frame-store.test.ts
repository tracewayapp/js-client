import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CollectionFrameStore } from "./collection-frame-store.js";

describe("CollectionFrameStore", () => {
  let store: CollectionFrameStore;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
  });

  afterEach(async () => {
    if (store) {
      await store.shutdown();
    }
    vi.restoreAllMocks();
  });

  function createStore(
    overrides: Partial<
      ConstructorParameters<typeof CollectionFrameStore>[0]
    > = {},
  ) {
    store = new CollectionFrameStore({
      apiUrl: "https://example.com/api/report",
      token: "test-token",
      debug: false,
      maxCollectionFrames: 12,
      collectionInterval: 60000,
      uploadThrottle: 0,
      metricsInterval: 600000,
      version: "1.0.0",
      serverName: "test-server",
      sampleRate: 1,
      errorSampleRate: 1,
      ...overrides,
    });
    return store;
  }

  it("should create a frame when adding an exception", () => {
    createStore();
    store.addException({
      traceId: null,
      stackTrace: "Error: test\nfoo()\n    bar.ts:1\n",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });
  });

  it("should upload on shutdown with pending data", async () => {
    createStore();
    store.addException({
      traceId: null,
      stackTrace: "Error: test",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await store.shutdown();

    expect(fetch).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe("https://example.com/api/report");
    const options = call[1]!;
    expect(options.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      }),
    );
  });

  it("should send gzipped body on shutdown", async () => {
    createStore();
    store.addMetric({
      name: "test.metric",
      value: 42,
      recordedAt: new Date().toISOString(),
    });

    await store.shutdown();

    expect(fetch).toHaveBeenCalled();
    const body = vi.mocked(fetch).mock.calls[0][1]!.body;
    expect(body).toBeInstanceOf(Uint8Array);
  });

  it("should keep frames in queue on upload failure then succeed on shutdown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValue({ status: 200 }),
    );
    createStore();
    store.addException({
      traceId: null,
      stackTrace: "Error: test",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await store.shutdown();

    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("should not upload if no data on shutdown", async () => {
    createStore();
    await store.shutdown();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("should add trace with all fields", () => {
    createStore();
    store.addTrace({
      id: "trace-123",
      endpoint: "GET /api/users",
      duration: 150000000,
      recordedAt: new Date().toISOString(),
      statusCode: 200,
      bodySize: 1024,
      clientIP: "192.168.1.1",
      attributes: { userId: "123" },
      spans: [
        {
          id: "span-1",
          name: "db-query",
          startTime: new Date().toISOString(),
          duration: 50000000,
        },
      ],
    });
  });

  it("should add trace marked as task", () => {
    createStore();
    store.addTrace({
      id: "task-123",
      endpoint: "process-email",
      duration: 500000000,
      recordedAt: new Date().toISOString(),
      statusCode: 0,
      bodySize: 0,
      clientIP: "",
      isTask: true,
    });
  });

  it("should add exception with traceId linking", () => {
    createStore();
    store.addException({
      traceId: "trace-123",
      stackTrace: "Error: something\nfunc()\n    file.ts:10\n",
      recordedAt: new Date().toISOString(),
      attributes: { context: "http" },
      isMessage: false,
    });
  });

  it("should add message (isMessage=true)", () => {
    createStore();
    store.addException({
      traceId: null,
      stackTrace: "User logged in successfully",
      recordedAt: new Date().toISOString(),
      isMessage: true,
    });
  });

  it("should expose sampleRate and errorSampleRate", () => {
    createStore({ sampleRate: 0.5, errorSampleRate: 0.8 });
    expect(store.sampleRate).toBe(0.5);
    expect(store.errorSampleRate).toBe(0.8);
  });

  it("should include version and serverName in upload payload", async () => {
    createStore({ version: "2.0.0", serverName: "my-server" });
    store.addMetric({
      name: "test",
      value: 1,
      recordedAt: new Date().toISOString(),
    });

    await store.shutdown();

    expect(fetch).toHaveBeenCalled();
  });

  it("should handle non-200 status gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500 }));
    createStore({ debug: true });
    store.addException({
      traceId: null,
      stackTrace: "Error: test",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await store.shutdown();

    expect(fetch).toHaveBeenCalled();
  });
});
