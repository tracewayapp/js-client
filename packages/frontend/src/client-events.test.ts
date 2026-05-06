import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TracewayFrontendClient } from "./client.js";
import type { ReportRequest, SessionRecordingPayload } from "@tracewayapp/core";

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

function makeClient(): TracewayFrontendClient {
  return new TracewayFrontendClient(
    "test-token@https://example.com/api/report",
    {
      debounceMs: 0,
      sessionRecording: false,
      ignoreErrors: [],
    },
  );
}

describe("TracewayFrontendClient timeline events", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    vi.stubGlobal("CompressionStream", createMockCompressionStream());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recordLog buffers a LogEvent", () => {
    const client = makeClient();
    client.recordLog("info", "hello world");
    const logs = client.bufferedLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      type: "log",
      level: "info",
      message: "hello world",
    });
    expect(client.bufferedActions()).toHaveLength(0);
  });

  it("recordLog is a no-op when captureLogs is false", () => {
    const client = new TracewayFrontendClient(
      "test-token@https://example.com/api/report",
      { sessionRecording: false, captureLogs: false },
    );
    client.recordLog("info", "ignored");
    expect(client.bufferedLogs()).toHaveLength(0);
  });

  it("recordNetworkEvent / recordNavigationEvent / recordAction land in actions", () => {
    const client = makeClient();
    client.recordNetworkEvent({
      method: "GET",
      url: "https://api.test/x",
      durationMs: 12,
      statusCode: 200,
    });
    client.recordNavigationEvent({ action: "push", from: "/a", to: "/b" });
    client.recordAction("cart", "add_item", { sku: "SKU-1" });

    const actions = client.bufferedActions();
    expect(actions).toHaveLength(3);
    expect(actions.map((a) => a.type)).toEqual([
      "network",
      "navigation",
      "custom",
    ]);
    expect(client.bufferedLogs()).toHaveLength(0);
  });

  it("captureNetwork:false / captureNavigation:false suppress only that channel", () => {
    const client = new TracewayFrontendClient(
      "test-token@https://example.com/api/report",
      {
        sessionRecording: false,
        captureNetwork: false,
        captureNavigation: false,
      },
    );

    client.recordNetworkEvent({
      method: "GET",
      url: "/x",
      durationMs: 1,
    });
    client.recordNavigationEvent({ action: "push", to: "/x" });
    client.recordAction("flow", "still_recorded");

    const actions = client.bufferedActions();
    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe("custom");
  });

  it("addException attaches logs and actions into the session recording payload", async () => {
    const client = makeClient();
    client.recordLog("warn", "user tapped pay");
    client.recordAction("cart", "add_item", { sku: "SKU-1" });
    client.recordNetworkEvent({
      method: "POST",
      url: "https://api.test/checkout",
      durationMs: 234,
      statusCode: 500,
      requestBytes: 42,
    });

    client.addException({
      traceId: null,
      stackTrace: "Error: boom",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await client.flush();

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      new TextDecoder().decode(
        fetchMock.mock.calls[0]![1]!.body as Uint8Array,
      ),
    ) as ReportRequest;

    const frame = body.collectionFrames[0]!;
    expect(frame.stackTraces).toHaveLength(1);
    expect(frame.stackTraces[0]!.sessionRecordingId).toBeTruthy();

    const recording = frame.sessionRecordings![0] as SessionRecordingPayload;
    expect(recording.exceptionId).toBe(frame.stackTraces[0]!.sessionRecordingId);

    expect(recording.logs).toHaveLength(1);
    expect(recording.logs![0]).toMatchObject({
      type: "log",
      level: "warn",
      message: "user tapped pay",
    });

    expect(recording.actions).toHaveLength(2);
    expect(recording.actions!.map((a) => a.type)).toEqual([
      "custom",
      "network",
    ]);
  });

  it("recordAllSessions emits a SessionPayload with the persistent sessionId on first sync", async () => {
    const client = new TracewayFrontendClient(
      "test-token@https://example.com/api/report",
      {
        debounceMs: 0,
        sessionRecording: false,
        recordAllSessions: true,
        ignoreErrors: [],
      },
    );
    await client.flush();

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse(
      new TextDecoder().decode(
        fetchMock.mock.calls[0]![1]!.body as Uint8Array,
      ),
    ) as ReportRequest;
    const frame = body.collectionFrames[0]!;
    expect(frame.sessions).toBeDefined();
    expect(frame.sessions!.length).toBeGreaterThanOrEqual(1);
    const opening = frame.sessions![0]!;
    expect(opening.id).toBe(client.currentSessionId());
    expect(opening.startedAt).toBeTruthy();
  });

  it("addException during always-on sessions stamps sessionId AND emits the per-exception 10s clip", async () => {
    const client = new TracewayFrontendClient(
      "test-token@https://example.com/api/report",
      {
        debounceMs: 0,
        sessionRecording: false,
        recordAllSessions: true,
        ignoreErrors: [],
      },
    );
    const sid = client.currentSessionId();
    expect(sid).toBeTruthy();

    // Buffer some timeline data so the legacy clip path has something to ship.
    client.recordLog("warn", "user tapped pay");
    client.recordAction("cart", "add_item", { sku: "SKU-1" });

    client.addException({
      traceId: null,
      stackTrace: "Error: boom",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    await client.flush();

    const fetchMock = vi.mocked(fetch);
    const allBodies = fetchMock.mock.calls.map((c) =>
      JSON.parse(new TextDecoder().decode(c[1]!.body as Uint8Array)) as ReportRequest,
    );
    const allFrames = allBodies.flatMap((b) => b.collectionFrames);
    const ex = allFrames.flatMap((f) => f.stackTraces).find((s) => s.stackTrace.includes("boom"))!;

    // Both linkages must be present — sessionId for the dashboard link,
    // sessionRecordingId for the per-exception 10s clip.
    expect(ex.sessionId).toBe(sid);
    expect(ex.sessionRecordingId).toBeTruthy();

    const recordings = allFrames.flatMap((f) => f.sessionRecordings ?? []);
    const exceptionClip = recordings.find((r) => r.exceptionId === ex.sessionRecordingId);
    expect(exceptionClip).toBeDefined();
    expect(exceptionClip!.logs).toBeDefined();
  });

  it("flush emits a closing SessionPayload with endedAt populated", async () => {
    const client = new TracewayFrontendClient(
      "test-token@https://example.com/api/report",
      {
        debounceMs: 0,
        sessionRecording: false,
        recordAllSessions: true,
        ignoreErrors: [],
      },
    );
    const sid = client.currentSessionId();
    await client.flush();

    const fetchMock = vi.mocked(fetch);
    const allBodies = fetchMock.mock.calls.map((c) =>
      JSON.parse(new TextDecoder().decode(c[1]!.body as Uint8Array)) as ReportRequest,
    );
    const allSessions = allBodies
      .flatMap((b) => b.collectionFrames)
      .flatMap((f) => f.sessions ?? []);

    const closing = allSessions.find((s) => s.id === sid && s.endedAt);
    expect(closing).toBeDefined();
    expect(closing!.startedAt).toBeTruthy();
  });

  it("pagehide flushes the closing payload via fetch keepalive", async () => {
    const client = new TracewayFrontendClient(
      "test-token@https://example.com/api/report",
      {
        debounceMs: 0,
        recordAllSessions: true,
        ignoreErrors: [],
      },
    );
    const sid = client.currentSessionId();

    // Block sendBeacon so the keepalive fetch path is exercised.
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: undefined });

    window.dispatchEvent(new Event("pagehide"));

    // The pagehide handler runs synchronously and dispatches an async sync;
    // wait for the fetch promise chain to resolve.
    await new Promise((r) => setTimeout(r, 10));

    const fetchMock = vi.mocked(fetch);
    const keepaliveCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.keepalive === true);
    expect(keepaliveCall).toBeDefined();

    // Keepalive path skips gzip and sends raw JSON so the fetch can dispatch
    // synchronously inside the pagehide handler. Body should be a plain
    // string, no Content-Encoding header.
    const init = keepaliveCall![1] as RequestInit;
    expect(typeof init.body).toBe("string");
    expect((init.headers as Record<string, string>)["Content-Encoding"]).toBeUndefined();

    const body = JSON.parse(init.body as string) as ReportRequest;
    const closing = body.collectionFrames
      .flatMap((f) => f.sessions ?? [])
      .find((s) => s.id === sid && s.endedAt);
    expect(closing).toBeDefined();

    void client.flush();
  });

  it("bfcache restore generates a new sessionId and clears the unloading flag", async () => {
    const client = new TracewayFrontendClient(
      "test-token@https://example.com/api/report",
      {
        debounceMs: 0,
        recordAllSessions: true,
        ignoreErrors: [],
      },
    );
    const original = client.currentSessionId();
    expect(original).toBeTruthy();

    // Close the page.
    window.dispatchEvent(new Event("pagehide"));

    // Drain microtasks so the pagehide-triggered doSync fully resolves
    // (releases the isSyncing guard) before we restart. In a real browser
    // the bfcache freeze gives plenty of time for this; in synchronous
    // test code we have to wait explicitly.
    await new Promise((r) => setTimeout(r, 0));

    // Restore from bfcache.
    const restore = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(restore, "persisted", { value: true });
    window.dispatchEvent(restore);

    const restored = client.currentSessionId();
    expect(restored).toBeTruthy();
    expect(restored).not.toBe(original);

    // Subsequent syncs after restart must go back to the gzipped
    // (non-keepalive) path. Find any fetch call that carries the new
    // session id and confirm it didn't use keepalive.
    client.recordLog("info", "post-restore");
    await client.flush();

    const fetchMock = vi.mocked(fetch);
    const decoder = new TextDecoder();
    const restoredCall = fetchMock.mock.calls.find((call) => {
      const init = call[1] as RequestInit | undefined;
      const body = init?.body;
      const text =
        typeof body === "string" ? body :
        body instanceof Uint8Array ? decoder.decode(body) :
        "";
      return text.includes(restored!) && !text.includes(`"id":"${original}"`);
    });
    expect(restoredCall).toBeDefined();
    expect((restoredCall![1] as RequestInit).keepalive).not.toBe(true);
  });

  it("setAttribute attaches scope to subsequent exceptions and to the open session", async () => {
    const client = new TracewayFrontendClient(
      "test-token@https://example.com/api/report",
      {
        debounceMs: 0,
        recordAllSessions: true,
        sessionRecording: false,
        ignoreErrors: [],
      },
    );
    client.setAttribute("userId", "42");
    client.setAttributes({ tenant: "acme", flag_v2: "on" });

    client.addException({
      traceId: null,
      stackTrace: "Error: post-scope",
      recordedAt: new Date().toISOString(),
      isMessage: false,
      attributes: { userId: "override" }, // caller wins over global
    });

    await client.flush();

    const fetchMock = vi.mocked(fetch);
    const allBodies = fetchMock.mock.calls
      .map((c) => (c[1] as RequestInit).body)
      .map((b) => (typeof b === "string" ? b : new TextDecoder().decode(b as Uint8Array)))
      .map((s) => JSON.parse(s) as ReportRequest);

    const allExceptions = allBodies.flatMap((b) => b.collectionFrames).flatMap((f) => f.stackTraces);
    const ex = allExceptions.find((e) => e.stackTrace.includes("post-scope"))!;
    expect(ex.attributes?.userId).toBe("override"); // caller win
    expect(ex.attributes?.tenant).toBe("acme");
    expect(ex.attributes?.flag_v2).toBe("on");

    const allSessions = allBodies.flatMap((b) => b.collectionFrames).flatMap((f) => f.sessions ?? []);
    const opening = allSessions.find((s) => !s.endedAt && s.attributes?.tenant === "acme");
    expect(opening).toBeDefined();
    expect(opening!.attributes?.userId).toBe("42");
  });

  it("removeAttribute and clearAttributes drop keys from subsequent payloads", async () => {
    const client = new TracewayFrontendClient(
      "test-token@https://example.com/api/report",
      {
        debounceMs: 0,
        recordAllSessions: true,
        sessionRecording: false,
        ignoreErrors: [],
      },
    );
    client.setAttributes({ a: "1", b: "2" });
    client.removeAttribute("a");
    expect(client.currentAttributes()).toEqual({ b: "2" });

    client.clearAttributes();
    expect(client.currentAttributes()).toEqual({});

    client.addException({
      traceId: null,
      stackTrace: "Error: cleared",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });
    await client.flush();

    const fetchMock = vi.mocked(fetch);
    const lastBody = fetchMock.mock.calls.at(-1)![1] as RequestInit;
    const text = typeof lastBody.body === "string" ? lastBody.body : new TextDecoder().decode(lastBody.body as Uint8Array);
    const ex = (JSON.parse(text) as ReportRequest).collectionFrames
      .flatMap((f) => f.stackTraces)
      .find((e) => e.stackTrace.includes("cleared"))!;
    expect(ex.attributes?.a).toBeUndefined();
    expect(ex.attributes?.b).toBeUndefined();
  });

  it("does not record the SDK's own /api/report calls as network actions", () => {
    const client = makeClient();

    // App's own request — should be recorded.
    client.recordNetworkEvent({
      method: "GET",
      url: "https://api.example.com/orders",
      durationMs: 12,
    });

    // SDK self-upload — should be filtered.
    client.recordNetworkEvent({
      method: "POST",
      url: "https://example.com/api/report",
      durationMs: 80,
    });
    // And the same URL with a query suffix (defensive).
    client.recordNetworkEvent({
      method: "POST",
      url: "https://example.com/api/report?token=abc",
      durationMs: 80,
    });

    const actions = client.bufferedActions();
    expect(actions).toHaveLength(1);
    expect((actions[0] as any).url).toBe("https://api.example.com/orders");
  });

  it("logs and actions are independently capped at 200 entries", () => {
    const client = makeClient();
    for (let i = 0; i < 250; i++) {
      client.recordLog("info", `log-${i}`);
      client.recordAction("flow", `action-${i}`);
    }
    expect(client.bufferedLogs()).toHaveLength(200);
    expect(client.bufferedActions()).toHaveLength(200);
    expect(client.bufferedLogs()[0]!.message).toBe("log-50");
    expect(client.bufferedLogs()[199]!.message).toBe("log-249");
  });

  it("populates startedAt/endedAt from buffered events when no rrweb segments", async () => {
    const client = makeClient();
    const before = Date.now();
    client.recordLog("info", "first");
    client.recordAction("flow", "second");
    client.recordLog("warn", "third");

    client.addException({
      traceId: null,
      stackTrace: "Error: boom",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });
    const after = Date.now();
    await client.flush();

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse(
      new TextDecoder().decode(
        fetchMock.mock.calls[0]![1]!.body as Uint8Array,
      ),
    ) as ReportRequest;

    const recording = body.collectionFrames[0]!.sessionRecordings![0]!;
    expect(recording.startedAt).toBeTruthy();
    expect(recording.endedAt).toBeTruthy();

    const startMs = Date.parse(recording.startedAt!);
    const endMs = Date.parse(recording.endedAt!);
    expect(startMs).toBeGreaterThanOrEqual(before - 1000);
    expect(endMs).toBeLessThanOrEqual(after + 1000);
    expect(startMs).toBeLessThanOrEqual(endMs);

    // Every buffered event must fall inside [startedAt, endedAt].
    for (const e of recording.logs ?? []) {
      const t = Date.parse(e.timestamp);
      expect(t).toBeGreaterThanOrEqual(startMs);
      expect(t).toBeLessThanOrEqual(endMs);
    }
    for (const e of recording.actions ?? []) {
      const t = Date.parse(e.timestamp);
      expect(t).toBeGreaterThanOrEqual(startMs);
      expect(t).toBeLessThanOrEqual(endMs);
    }
  });

  it("toJSON shape: omits logs/actions when empty", async () => {
    const client = makeClient();
    client.addException({
      traceId: null,
      stackTrace: "Error: no events",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });
    await client.flush();

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse(
      new TextDecoder().decode(
        fetchMock.mock.calls[0]![1]!.body as Uint8Array,
      ),
    ) as ReportRequest;
    const frame = body.collectionFrames[0]!;
    // No timeline data → no session recording, no sessionRecordingId on the
    // exception. The empty-buffer path must NOT create a phantom recording.
    expect(frame.sessionRecordings).toBeUndefined();
    expect(frame.stackTraces[0]!.sessionRecordingId).toBeFalsy();
  });
});
