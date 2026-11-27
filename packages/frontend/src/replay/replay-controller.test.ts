import { afterEach, describe, expect, it, vi } from "vitest";

let emit: ((e: unknown) => void) | null = null;
vi.mock("@rrweb/record", () => {
  const record = Object.assign(
    vi.fn((opts: { emit: (e: unknown) => void }) => {
      emit = opts.emit;
      return () => {
        emit = null;
      };
    }),
    { takeFullSnapshot: vi.fn() },
  );
  return { record };
});

import { SessionManager } from "../session/session-manager.js";
import { RecordingsTransport, type RecordingSegment } from "../transport/recordings.js";
import { ReplaySegmentImages } from "./inline-images.js";
import { record } from "@rrweb/record";
import { ReplayController } from "./replay-controller.js";

const SEGMENT_MS = 30_000;

function setup(realTransport?: RecordingsTransport) {
  const sent: RecordingSegment[][] = [];
  const transport = {
    discard: () => {},
    send: (segments: RecordingSegment[]) => {
      sent.push(segments);
      return segments.length;
    },
  } as unknown as RecordingsTransport;
  const session = new SessionManager({
    storeKey: "test",
    onStart: () => {},
    onEnd: () => {},
    onHidden: () => {},
    onVisible: () => {},
  });
  session.start();
  const replay = new ReplayController(session, realTransport ?? transport, SEGMENT_MS);
  return { sent, session, replay };
}

const options = {
  maskAllInputs: true,
  sessionSampled: true,
  maxBytes: 1_000_000,
  maxAgeMs: 600_000,
};

async function started(replay: ReplayController, mode: "buffer" | "stream") {
  replay.apply(mode, options);
  await vi.waitFor(() => expect(emit).not.toBeNull());
}

afterEach(() => {
  sessionStorage.clear();
  emit = null;
});

describe("ReplayController", () => {
  it("charges partial images only after that segment passes admission", async () => {
    let acceptPartial = false;
    const transport = new RecordingsTransport("u", "t", async () => new Response(null), segment =>
      segment.segmentIndex === 0 || acceptPartial);
    const { replay, session } = setup(transport);
    const exposed = vi.spyOn(ReplaySegmentImages.prototype, "expose");
    try {
      await started(replay, "buffer");
      const now = Date.now();
      emit!({ type: 2, timestamp: now - SEGMENT_MS - 1 });
      emit!({ type: 2, timestamp: now });
      replay.flush(60_000, "first");
      expect(replay.lastFlushSegments).toBe(1);
      expect(exposed).not.toHaveBeenCalled();
      acceptPartial = true;
      replay.flush(60_000, "second");
      expect(replay.lastFlushSegments).toBe(2);
      expect(exposed).toHaveBeenCalledOnce();
    } finally {
      exposed.mockRestore();
      transport.discard();
      replay.stop();
      session.stop();
    }
  });

  it("streams each completed segment under the session", async () => {
    const { sent, session, replay } = setup();
    await started(replay, "stream");
    const t0 = Date.now();
    emit!({ type: 2, timestamp: t0 });
    emit!({ type: 3, timestamp: t0 + SEGMENT_MS + 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toMatchObject({
      sessionId: session.currentId(),
      segmentIndex: 0,
    });
    replay.stop();
    session.stop();
  });

  it("buffers segments and uploads them with the in-progress clip on flush", async () => {
    const { sent, session, replay } = setup();
    await started(replay, "buffer");
    const t0 = Date.now();
    emit!({ type: 2, timestamp: t0 - 40_000 });
    emit!({ type: 3, timestamp: t0 - 5_000 });
    emit!({ type: 3, timestamp: t0 });
    expect(sent).toHaveLength(0);

    replay.flush(60_000, "0195f2a0-0000-7000-8000-00000000abcd");
    expect(sent).toHaveLength(1);
    const [completed, clip] = sent[0]!;
    expect(completed).toMatchObject({
      sessionId: session.currentId(),
      segmentIndex: 0,
    });
    expect(completed!.exceptionId).toBe("0195f2a0-0000-7000-8000-00000000abcd");
    expect(clip).toMatchObject({
      sessionId: session.currentId(),
      segmentIndex: 1,
      exceptionId: "0195f2a0-0000-7000-8000-00000000abcd",
    });

    emit!({ type: 3, timestamp: t0 + SEGMENT_MS + 1 });
    replay.flush(60_000);
    expect(sent[1]!.some((segment) => segment.segmentIndex === 0)).toBe(true);
    expect(sent[1]!.some((segment) => segment.segmentIndex === 1)).toBe(true);
    replay.stop();
    session.stop();
  });

  it("forgets what it kept when switched off", async () => {
    const { sent, session, replay } = setup();
    await started(replay, "buffer");
    emit!({ type: 2, timestamp: Date.now() - 40_000 });
    emit!({ type: 3, timestamp: Date.now() });
    replay.apply("off", options);
    replay.flush(600_000, "x");
    expect(sent).toHaveLength(0);
    session.stop();
  });

  it("keeps an unsampled session's replay buffered even when streaming is asked for", async () => {
    const { sent, session, replay } = setup();
    replay.apply("stream", { ...options, sessionSampled: false });
    await vi.waitFor(() => expect(emit).not.toBeNull());
    expect(replay.currentMode()).toBe("buffer");
    emit!({ type: 2, timestamp: Date.now() - 40_000 });
    emit!({ type: 3, timestamp: Date.now() });
    expect(sent).toHaveLength(0);
    replay.stop();
    session.stop();
  });
  it("restarts rrweb and drops old data when input masking changes", async () => {
    const { sent, session, replay } = setup();
    replay.apply("buffer", { ...options, maskAllInputs: false });
    await vi.waitFor(() => expect(emit).not.toBeNull());
    emit!({ type: 2, timestamp: Date.now(), data: { secret: "private" } });
    replay.apply("buffer", { ...options, maskAllInputs: true });
    await vi.waitFor(() =>
      expect(vi.mocked(record).mock.lastCall?.[0]?.maskAllInputs).toBe(true),
    );
    replay.flush(600_000);
    expect(sent).toHaveLength(0);
    replay.stop();
    session.stop();
  });

  it("restarts rrweb with the picture policy when replay.images changes (§14.5)", async () => {
    const { sent, session, replay } = setup();
    const blockSelector = () =>
      String(vi.mocked(record).mock.lastCall?.[0]?.blockSelector);
    replay.apply("buffer", options);
    await vi.waitFor(() => expect(emit).not.toBeNull());
    expect(blockSelector()).not.toContain("img, picture");
    emit!({ type: 2, timestamp: Date.now(), data: { photo: "url" } });
    const calls = vi.mocked(record).mock.calls.length;
    replay.apply("buffer", { ...options, images: "off" });
    await vi.waitFor(() =>
      expect(vi.mocked(record).mock.calls.length).toBe(calls + 1),
    );
    expect(blockSelector()).toContain("img, picture");
    // What was recorded under the other policy is gone.
    replay.flush(600_000);
    expect(sent).toHaveLength(0);
    replay.apply("buffer", { ...options, images: "off" });
    expect(vi.mocked(record).mock.calls.length).toBe(calls + 1);
    replay.apply("buffer", { ...options, images: "always" });
    await vi.waitFor(() =>
      expect(vi.mocked(record).mock.calls.length).toBe(calls + 2),
    );
    expect(blockSelector()).not.toContain("img, picture");
    // The recorder mock has no mirror and its events no nodes: nothing to add, and the events are still kept.
    emit!({ type: 2, timestamp: Date.now() });
    emit!({ type: 3, timestamp: Date.now(), data: { source: 0 } });
    replay.flush(600_000);
    expect(sent.flat()[0]?.events).toHaveLength(2);
    replay.onSessionStart();
    expect(replay.imageBytes()).toBe(0);
    replay.stop();
    session.stop();
  });

  it("keeps a new session's exception clip free of the previous session's buffered pictures", async () => {
    const { sent, session, replay } = setup();
    await started(replay, "buffer");
    const now = Date.now();
    emit!({ type: 2, timestamp: now - 40_000, data: { note: "prior avatar" } });
    emit!({ type: 3, timestamp: now, data: { source: 0 } });
    replay.onSessionEnd(false);
    const current = session.current()!;
    vi.spyOn(session, "current").mockReturnValue({ ...current, id: "new-session" });
    replay.onSessionStart();
    emit!({ type: 2, timestamp: now, data: { note: "current avatar" } });
    replay.flush(600_000, "new-exception");
    expect(JSON.stringify(sent)).toContain("current avatar");
    expect(JSON.stringify(sent)).not.toContain("prior avatar");
    replay.stop();
    session.stop();
  });

  it("keeps a session's picture budget across its pages, and starts a new session's at zero (§14.5)", async () => {
    const { session, replay } = setup();
    await started(replay, "stream");
    const clearCache = vi.spyOn((replay as any).recorder.images, "clearCache");
    replay.onSessionStart();
    expect(clearCache).toHaveBeenCalledTimes(1);
    (replay as any).recorder.images.bytes = 1_000;
    const t0 = Date.now();
    emit!({ type: 2, timestamp: t0 });
    emit!({ type: 3, timestamp: t0 + SEGMENT_MS + 1 });
    replay.stop();
    // The next page of the same session.
    const next = new ReplayController(session, { discard() {}, send: () => 1 } as any);
    next.onSessionStart();
    expect(next.imageBytes()).toBe(1_000);
    sessionStorage.setItem("traceway:replay-image-bytes", "{not json");
    next.onSessionStart();
    expect(next.imageBytes()).toBe(0);
    sessionStorage.setItem("traceway:replay-image-bytes", JSON.stringify(["another-session", 5]));
    next.onSessionStart();
    expect(next.imageBytes()).toBe(0);
    session.stop();
  });

  it("drains the final segment before ending the session and persists its index", async () => {
    const sent: RecordingSegment[][] = [];
    let replay: ReplayController;
    const session = new SessionManager({
      storeKey: "closing",
      onStart: () => {},
      onHidden: () => {},
      onVisible: () => {},
      onEnd: (_session, _at, unloading) => replay.onSessionEnd(unloading),
    });
    session.start();
    const id = session.currentId();
    replay = new ReplayController(session, {
      send: (segments: RecordingSegment[]) => {
        sent.push(segments);
        return segments.length;
      },
    } as unknown as RecordingsTransport);
    await started(replay, "stream");
    emit!({ type: 2, timestamp: Date.now() });
    window.dispatchEvent(new Event("pagehide"));
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toMatchObject({ sessionId: id, segmentIndex: 0 });
    expect(session.currentId()).toBeNull();
    replay.stop();
    session.stop();
    const next = new SessionManager({
      storeKey: "closing",
      onStart: () => {},
      onEnd: () => {},
      onHidden: () => {},
      onVisible: () => {},
    });
    next.start();
    expect(next.currentId()).toBe(id);
    expect(next.nextSegmentIndex()).toBe(1);
    next.stop();
  });
});
