import { describe, it, expect, vi, beforeEach } from "vitest";

// rrweb is mocked so we can drive synthetic events on a controlled clock and
// faithfully reproduce its checkout behaviour: record() captures the emit
// callback, and takeFullSnapshot() synchronously emits a meta (type 4) + full
// snapshot (type 2), exactly as rrweb does on record start and on each manual
// checkout.
let emitFn: ((e: unknown) => void) | null = null;
let snapshotClock = 0;

vi.mock("@rrweb/record", () => {
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

import { record } from "@rrweb/record";
import {
  BLOCK_SELECTOR,
  IMAGE_SELECTOR,
  MASK_TEXT_SELECTOR,
  SessionRecorder,
} from "./session-recorder.js";

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

  it("bounds the clip to a single segment over a long-running session", async () => {
    const rec = new SessionRecorder({ segmentDuration: SEGMENT_MS });
    await rec.start();

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

  it("stays bounded even when the error fires just before a rotation", async () => {
    const rec = new SessionRecorder({ segmentDuration: SEGMENT_MS });
    await rec.start();
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

  it("still hands every completed segment to onSegmentReady and keeps two in getSegments", async () => {
    const ready: Array<{ events: unknown[]; startedAt: string; endedAt: string }> = [];
    const rec = new SessionRecorder({
      segmentDuration: SEGMENT_MS,
      onSegmentReady: (seg) => ready.push(seg),
    });
    await rec.start();

    emitSnapshot(T0);
    for (let t = T0; t <= T0 + 85_000; t += 1_000) emitIncremental(t);

    // Rotations at +30 s and +60 s → two completed segments handed off.
    expect(ready.length).toBe(2);
    expect(ready.every((s) => s.events.length > 0)).toBe(true);

    // The in-memory window still holds previous + current for the always-on path.
    expect(rec.getSegments().length).toBe(2);
  });
});

describe("SessionRecorder privacy options", () => {
  beforeEach(() => {
    emitFn = null;
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("passes the traceway mask and blank selectors and leaves rrweb's own classes at their defaults", async () => {
    const rec = new SessionRecorder();
    await rec.start({ maskAllInputs: false });
    expect(record).toHaveBeenCalledTimes(1);
    const options = vi.mocked(record).mock.calls[0]![0]!;
    expect(options).toMatchObject({
      maskTextSelector: ".traceway-mask",
      blockSelector: BLOCK_SELECTOR,
    });
    // rrweb then masks passwords only.
    expect(options.maskInputOptions).toBeUndefined();
    expect(options.maskAllInputs).toBeUndefined();
    expect(options.blockClass).toBeUndefined();
    expect(options.maskTextClass).toBeUndefined();
    expect(options.ignoreClass).toBeUndefined();
    rec.stop();
  });

  it("starts rrweb with the policy and masking asked for last, also when they change while rrweb loads (§14.5)", async () => {
    const rec = new SessionRecorder();
    // A rule arrives while rrweb is still being loaded: the replay restarts with images off and inputs masked.
    const first = rec.start({ maskAllInputs: false, images: "wifi" });
    rec.stop();
    const second = rec.start({ maskAllInputs: true, images: "off" });
    await Promise.all([first, second]);
    expect(record).toHaveBeenCalledTimes(1);
    expect(vi.mocked(record).mock.calls[0]![0]).toMatchObject({
      // rrweb's own `maskAllInputs: true` would replace this list with one that has no hidden or file inputs.
      maskInputOptions: { text: true, textarea: true, select: true, password: true, hidden: true, file: true },
      blockSelector: `${BLOCK_SELECTOR}, ${IMAGE_SELECTOR}`,
    });
    expect(vi.mocked(record).mock.calls[0]![0]!.maskAllInputs).toBeUndefined();
    rec.stop();
  });

  it("blocks blank areas and the media of masked areas, and masks only the text of the rest", () => {
    document.body.innerHTML = `
      <div class="traceway-mask">
        <p id="masked-text">secret</p>
        <img id="img"><picture id="picture"></picture><video id="video"></video>
        <canvas id="canvas"></canvas><svg id="svg"></svg>
      </div>
      <img id="self-masked" class="traceway-mask">
      <div id="blank" class="traceway-blank"><p>secret</p></div>
      <img id="plain-img"><p id="plain-text">visible</p>
    `;
    const matches = (id: string) =>
      document.getElementById(id)!.matches(BLOCK_SELECTOR);
    for (const id of ["img", "picture", "video", "canvas", "svg", "self-masked", "blank"])
      expect(matches(id), id).toBe(true);
    for (const id of ["masked-text", "plain-img", "plain-text"])
      expect(matches(id), id).toBe(false);
    expect(document.getElementById("masked-text")!.closest(MASK_TEXT_SELECTOR)).not.toBeNull();
    expect(document.getElementById("plain-text")!.closest(MASK_TEXT_SELECTOR)).toBeNull();
  });
});
