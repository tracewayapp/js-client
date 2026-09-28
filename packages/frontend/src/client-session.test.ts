import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gunzipSync, strFromU8 } from "fflate";
import type { ReportRequest, SessionRecordingPayload } from "@tracewayapp/core";
import { TracewayFrontendClient } from "./client.js";

const CONNECTION = "test-token@https://example.com/api/report";

class PassthroughCompressionStream {
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
}

function decode(init: RequestInit): ReportRequest {
  const body = init.body as Uint8Array;
  const text = init.keepalive ? strFromU8(gunzipSync(body)) : new TextDecoder().decode(body);
  return JSON.parse(text) as ReportRequest;
}

function keepaliveReports(): ReportRequest[] {
  return vi
    .mocked(fetch)
    .mock.calls.map((c) => c[1] as RequestInit)
    .filter((init) => init.keepalive === true)
    .map(decode);
}

function allReports(): ReportRequest[] {
  return vi.mocked(fetch).mock.calls.map((c) => decode(c[1] as RequestInit));
}

function sessionClient(options: Record<string, unknown> = {}): TracewayFrontendClient {
  return new TracewayFrontendClient(CONNECTION, {
    debounceMs: 60_000,
    sessionRecording: false,
    recordAllSessions: true,
    ignoreErrors: [],
    ...options,
  });
}

// The recorder is off in these tests (jsdom has no layout for rrweb), so
// segments are queued the way the recorder hands them over.
function queueSegment(client: TracewayFrontendClient, events: unknown[]): void {
  const now = new Date().toISOString();
  (client as unknown as { queueSegment: (s: unknown) => void }).queueSegment({
    events,
    startedAt: now,
    endedAt: now,
  });
}

function pendingRecordings(client: TracewayFrontendClient): SessionRecordingPayload[] {
  return (client as unknown as { pendingRecordings: SessionRecordingPayload[] }).pendingRecordings;
}

function randomText(bytes: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

describe("always-on sessions", () => {
  const clients: TracewayFrontendClient[] = [];
  const track = (c: TracewayFrontendClient) => {
    clients.push(c);
    return c;
  };

  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    vi.stubGlobal("CompressionStream", PassthroughCompressionStream);
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.flush();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a segment too large for keepalive never takes the closing row down with it", () => {
    const client = track(sessionClient());
    const sid = client.currentSessionId();
    queueSegment(client, [{ type: 2, timestamp: Date.now(), data: randomText(200_000) }]);

    window.dispatchEvent(new Event("pagehide"));

    const reports = keepaliveReports();
    const closing = reports
      .flatMap((r) => r.collectionFrames)
      .flatMap((f) => f.sessions ?? [])
      .find((s) => s.id === sid && s.endedAt);
    expect(closing).toBeDefined();
    expect(reports.flatMap((r) => r.collectionFrames).flatMap((f) => f.sessionRecordings ?? [])).toHaveLength(0);
    expect(pendingRecordings(client)).toHaveLength(1);
  });

  it("a full-snapshot-sized segment fits once gzipped and goes in its own request", () => {
    const client = track(sessionClient());
    const sid = client.currentSessionId();
    const card = { type: 3, data: { tagName: "div", attributes: { class: "card" }, text: "Jackpot coins" } };
    const snapshot = { type: 2, timestamp: Date.now(), data: Array.from({ length: 2_000 }, () => card) };
    expect(JSON.stringify(snapshot).length).toBeGreaterThan(150_000);
    queueSegment(client, [snapshot]);

    window.dispatchEvent(new Event("pagehide"));

    const frames = keepaliveReports().map((r) => r.collectionFrames[0]!);
    const segmentFrame = frames.find((f) => (f.sessionRecordings ?? []).some((r) => r.sessionId === sid));
    expect(segmentFrame).toBeDefined();
    expect(segmentFrame!.sessions).toBeUndefined();
    expect(pendingRecordings(client)).toHaveLength(0);
  });

  it("an exception and its clip leave in the same keepalive request", () => {
    const client = track(sessionClient());
    client.recordLog("warn", "about to fail");
    client.addException({
      traceId: null,
      stackTrace: "Error: boom",
      recordedAt: new Date().toISOString(),
      isMessage: false,
    });

    window.dispatchEvent(new Event("pagehide"));

    const frame = keepaliveReports()
      .map((r) => r.collectionFrames[0]!)
      .find((f) => f.stackTraces.length > 0)!;
    expect(frame.stackTraces[0]!.stackTrace).toBe("Error: boom");
    expect(frame.sessionRecordings).toHaveLength(1);
    expect(frame.sessionRecordings![0]!.exceptionId).toBe(frame.stackTraces[0]!.sessionRecordingId);
  });

  it("the next page of the tab continues the session and its segment numbering", () => {
    const first = track(sessionClient());
    const sid = first.currentSessionId();
    queueSegment(first, [{ type: 3, timestamp: Date.now() }]);
    queueSegment(first, [{ type: 3, timestamp: Date.now() }]);
    window.dispatchEvent(new Event("pagehide"));

    const second = track(sessionClient());
    expect(second.currentSessionId()).toBe(sid);
    queueSegment(second, [{ type: 3, timestamp: Date.now() }]);
    expect(pendingRecordings(second).at(-1)!.segmentIndex).toBe(2);
  });

  it("a continued session keeps the landing page's url, path and referrer", async () => {
    window.history.replaceState({}, "", "/partners/?utm_campaign=spring");
    const first = track(sessionClient());
    const sid = first.currentSessionId();
    window.dispatchEvent(new Event("pagehide"));

    window.history.replaceState({}, "", "/lobby/");
    const second = track(sessionClient());
    await second.flush();

    const rows = allReports()
      .flatMap((r) => r.collectionFrames)
      .flatMap((f) => f.sessions ?? [])
      .filter((s) => s.id === sid);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.attributes?.path).toBe("/partners/");
      expect(row.attributes?.url).toContain("utm_campaign=spring");
    }
    window.history.replaceState({}, "", "/");
  });

  it("a tab duplicated from a live page starts its own session", () => {
    const original = track(sessionClient());
    const duplicate = track(sessionClient());
    expect(duplicate.currentSessionId()).not.toBe(original.currentSessionId());
  });

  it("a page opened after the inactivity window starts a new session", () => {
    const first = track(sessionClient());
    const sid = first.currentSessionId();
    window.dispatchEvent(new Event("pagehide"));

    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 16 * 60_000);
    const next = track(sessionClient());
    expect(next.currentSessionId()).not.toBe(sid);
  });

  it("hiding the page flushes what is pending over keepalive without ending the session", () => {
    const client = track(sessionClient());
    const sid = client.currentSessionId();
    queueSegment(client, [{ type: 3, timestamp: Date.now() }]);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });

    const frames = keepaliveReports().flatMap((r) => r.collectionFrames);
    const sessions = frames.flatMap((f) => f.sessions ?? []);
    expect(sessions.find((s) => s.id === sid)).toBeDefined();
    expect(sessions.some((s) => s.endedAt)).toBe(false);
    expect(frames.flatMap((f) => f.sessionRecordings ?? []).map((r) => r.segmentIndex)).toEqual([0]);
    expect(client.currentSessionId()).toBe(sid);
  });

  it("nothing is attached to a session after it idled out", async () => {
    vi.useFakeTimers();
    const client = track(sessionClient({ debounceMs: 0 }));
    const sid = client.currentSessionId();
    await vi.advanceTimersByTimeAsync(16 * 60_000);

    const closing = allReports()
      .flatMap((r) => r.collectionFrames)
      .flatMap((f) => f.sessions ?? [])
      .find((s) => s.id === sid && s.endedAt);
    expect(closing).toBeDefined();
    expect(sessionStorage.length).toBe(0);

    vi.mocked(fetch).mockClear();
    client.setAttribute("userId", "late");
    client.addException({ traceId: null, stackTrace: "Error: late", recordedAt: new Date().toISOString(), isMessage: false });
    await vi.advanceTimersByTimeAsync(1);

    const frames = allReports().flatMap((r) => r.collectionFrames);
    expect(frames.flatMap((f) => f.sessions ?? [])).toHaveLength(0);
    expect(frames.flatMap((f) => f.stackTraces)[0]!.sessionId).toBeUndefined();
  });

  it("a keepalive delivery that fails while the page lives is retried", async () => {
    vi.useFakeTimers();
    const client = track(sessionClient({ retryDelayMs: 1_000 }));
    const sid = client.currentSessionId();
    vi.mocked(fetch).mockImplementation(async (_url, init) =>
      (init as RequestInit).keepalive ? Promise.reject(new TypeError("Failed to fetch")) : ({ status: 200 } as Response),
    );

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await vi.advanceTimersByTimeAsync(1_500);

    const retried = vi
      .mocked(fetch)
      .mock.calls.map((c) => c[1] as RequestInit)
      .filter((init) => !init.keepalive)
      .map(decode)
      .flatMap((r) => r.collectionFrames)
      .flatMap((f) => f.sessions ?? []);
    expect(retried.find((s) => s.id === sid)).toBeDefined();
  });
});
