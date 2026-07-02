import { describe, it, expect, vi, beforeEach } from "vitest";

// rrweb is mocked so we can drive synthetic events on a controlled clock and
// faithfully reproduce its checkout behaviour: record() captures the emit
// callback, and takeFullSnapshot() synchronously emits a meta (type 4) + full
// snapshot (type 2), exactly as rrweb does on record start and on each manual
// checkout.
let emitFn: ((e: unknown) => void) | null = null;
let snapshotClock = 0;

vi.mock("rrweb", () => {
  const record = vi.fn((opts: { emit: (e: unknown) => void }) => {
    emitFn = opts.emit;
    return () => {
      emitFn = null;
    };
  }) as unknown as {
    (opts: { emit: (e: unknown) => void }): () => void;
    takeFullSnapshot: () => void;
  };
  record.takeFullSnapshot = vi.fn(() => {
    emitFn?.({
      type: 4,
      data: { href: "http://localhost/", width: 800, height: 600 },
      timestamp: snapshotClock,
    });
    emitFn?.({
      type: 2,
      data: { node: {}, initialOffset: { top: 0, left: 0 } },
      timestamp: snapshotClock,
    });
  });
  return { record };
});

import { SessionRecorder } from "./session-recorder.js";

const SEGMENT_MS = 30_000;
const T0 = 1_000_000_000_000;

function emitSnapshot(ts: number) {
  snapshotClock = ts;
  // Mirrors rrweb's initial snapshot on record start.
  emitFn?.({
    type: 4,
    data: { href: "http://localhost/", width: 800, height: 600 },
    timestamp: ts,
  });
  emitFn?.({
    type: 2,
    data: { node: {}, initialOffset: { top: 0, left: 0 } },
    timestamp: ts,
  });
}

function emitIncremental(ts: number) {
  snapshotClock = ts;
  emitFn?.({ type: 3, data: { source: 1 }, timestamp: ts });
}

function span(events: Array<{ timestamp: number }>): number {
  const ts = events.map((e) => e.timestamp);
  return Math.max(...ts) - Math.min(...ts);
}

describe("SessionRecorder exception clip", () => {
  beforeEach(() => {
    emitFn = null;
    snapshotClock = 0;
    vi.clearAllMocks();
  });

  it("bounds the clip to a single segment over a long-running session", () => {
    const rec = new SessionRecorder({ segmentDuration: SEGMENT_MS });
    rec.start();

    // Initial snapshot, then ~85 s of activity at 1 s cadence → two rotations
    // (at +30 s and +60 s), with the error landing 25 s into the third segment.
    emitSnapshot(T0);
    for (let t = T0; t <= T0 + 85_000; t += 1_000) emitIncremental(t);

    const clip = rec.getClipEvents() as Array<{ timestamp: number; type: number }>;
    const all = rec.getSegments().flatMap((s) => s.events) as Array<{ timestamp: number }>;

    // The clip never exceeds one segment, regardless of total session length.
    expect(span(clip)).toBeLessThanOrEqual(SEGMENT_MS);
    expect(span(all)).toBeGreaterThan(SEGMENT_MS); // session itself is longer

    // It is a strict subset of everything recorded (we dropped the older segment).
    expect(clip.length).toBeLessThan(all.length);

    // It is self-contained / replayable: begins with meta + full snapshot.
    expect(clip[0].type).toBe(4);
    expect(clip.some((e) => e.type === 2)).toBe(true);

    // Every clip event is from the most recent segment (after the last checkout).
    const checkoutTs = clip[0].timestamp;
    expect(clip.every((e) => e.timestamp >= checkoutTs)).toBe(true);
  });

  it("stays bounded even when the error fires just before a rotation", () => {
    const rec = new SessionRecorder({ segmentDuration: SEGMENT_MS });
    rec.start();
    emitSnapshot(T0);
    // Run right up to (but not past) the 2x boundary so `previous` is retained.
    for (let t = T0; t <= T0 + 59_000; t += 1_000) emitIncremental(t);

    const clip = rec.getClipEvents() as Array<{ timestamp: number }>;
    expect(span(clip)).toBeLessThanOrEqual(SEGMENT_MS);
  });
});

describe("SessionRecorder full-session path is unchanged", () => {
  beforeEach(() => {
    emitFn = null;
    snapshotClock = 0;
    vi.clearAllMocks();
  });

  it("still hands every completed segment to onSegmentReady and keeps two in getSegments", () => {
    const ready: Array<{ events: unknown[]; startedAt: string; endedAt: string }> = [];
    const rec = new SessionRecorder({
      segmentDuration: SEGMENT_MS,
      onSegmentReady: (seg) => ready.push(seg),
    });
    rec.start();

    emitSnapshot(T0);
    for (let t = T0; t <= T0 + 85_000; t += 1_000) emitIncremental(t);

    // Rotations at +30 s and +60 s → two completed segments handed off.
    expect(ready.length).toBe(2);
    expect(ready.every((s) => s.events.length > 0)).toBe(true);

    // The in-memory window still holds previous + current for the always-on path.
    expect(rec.getSegments().length).toBe(2);
  });
});
