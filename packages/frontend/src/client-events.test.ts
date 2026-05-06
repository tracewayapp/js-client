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
