import type { eventWithTime } from "@rrweb/types";
import type { TracewayImagePolicy } from "@tracewayapp/core";
import { guarded } from "./guarded.js";
import { ImageInliner } from "./replay/inline-images.js";
import { maskEvent } from "./replay/mask.js";

type RecordFn = typeof import("@rrweb/record").record;

/**
 * Text inside an element with class `traceway-mask` is recorded with every character but whitespace replaced by
 * `*`, the same as rrweb's own `rr-mask` class.
 */
export const MASK_TEXT_SELECTOR = ".traceway-mask";

/**
 * Elements rrweb records as an empty box of their size, without attributes or children: anything with class
 * `traceway-blank` (like rrweb's own `rr-block`), and the media inside or carrying `traceway-mask`, which hides
 * pictures the way it hides text. rrweb's `rr-block` class is still honoured through its default `blockClass`.
 */
export const BLOCK_SELECTOR = [
  ".traceway-blank",
  ...["img", "picture", "video", "canvas", "svg"].flatMap((tag) => [
    `.traceway-mask ${tag}`,
    `${tag}.traceway-mask`,
  ]),
].join(", ");

/** With `replay.images = "off"`: every picture is recorded as an empty box of its size. */
export const IMAGE_SELECTOR = "img, picture, image, input[type=image]";

export interface SessionRecorderOptions {
  segmentDuration?: number;
  /**
   * Fires when a segment fills up and rotates out (i.e., when `current`
   * becomes `previous`). The handed-off segment is not yet uploaded — the
   * caller decides whether to flush it. Used by the always-on path to drop
   * each completed segment onto the upload queue immediately. Segment length
   * is set by `segmentDuration` (default 30 s).
   */
  onSegmentReady?: (segment: {
    events: eventWithTime[];
    startedAt: string;
    endedAt: string;
  }) => void;
  /**
   * Fires once per rrweb event. Used by the lifecycle layer as the activity
   * heartbeat — every DOM mutation/input rrweb sees becomes an activity tick,
   * so we don't need to re-listen for mouse/keyboard/scroll on `window`.
   */
  onActivity?: () => void;
}

interface Segment {
  events: eventWithTime[];
  startedAt: string;
  startedAtMs: number;
}

export class SessionRecorder {
  private segmentDuration: number;
  private current: Segment;
  private previous: Segment | null = null;
  private stopFn: (() => void) | null = null;
  private recordFn: RecordFn | null = null;
  private starting: Promise<void> | null = null;
  private wanted = false;
  private maskAllInputs = true;
  /** The page's node rrweb recorded under `id`. */
  private readonly node = (id: number): Node | null =>
    this.recordFn?.mirror?.getNode(id) ?? null;
  /** `replay.images = "always"`: small copies of the page's images go into the recording. */
  readonly images = new ImageInliner(this.node);
  private inlineImages = false;
  /** `replay.images = "off"`; read when rrweb starts, so a change while it loads is not lost. */
  private blockImages = false;
  private onSegmentReady: SessionRecorderOptions["onSegmentReady"];
  private onActivity: SessionRecorderOptions["onActivity"];

  constructor(options: SessionRecorderOptions = {}) {
    this.segmentDuration = options.segmentDuration ?? 30_000;
    this.current = this.newSegment();
    this.onSegmentReady = options.onSegmentReady;
    this.onActivity = options.onActivity;
  }

  /**
   * Starts recording. rrweb is loaded on first use, so a page whose replay
   * is switched off never downloads or runs it.
   */
  start(
    options: { maskAllInputs?: boolean; images?: TracewayImagePolicy } = {},
  ): Promise<void> {
    this.wanted = true;
    this.maskAllInputs = options.maskAllInputs ?? true;
    const images = options.images ?? "wifi";
    this.inlineImages = images === "always";
    this.blockImages = images === "off";
    if (this.stopFn) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = import("@rrweb/record")
      .then(({ record }) => {
        this.recordFn = record;
        if (!this.wanted || this.stopFn) return;
        this.current = this.newSegment();
        this.previous = null;
        this.stopFn =
          record({
            // rrweb calls it inside the page's own calls too (insertRule, setProperty, attachShadow), before the
            // native method runs: a failure here would make the page's call throw.
            // No rrweb `errorHandler`: its proxies run the page's own insertRule/setProperty inside the same try,
            // so swallowing would also swallow the page's own errors (an invalid rule, a feature test).
            emit: (event) => guarded("replay", () => this.onEvent(event)),
            maskAllInputs: this.maskAllInputs,
            maskTextSelector: MASK_TEXT_SELECTOR,
            blockSelector: this.blockImages
              ? `${BLOCK_SELECTOR}, ${IMAGE_SELECTOR}`
              : BLOCK_SELECTOR,
          }) ?? null;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  stop(): void {
    this.wanted = false;
    this.current = this.newSegment();
    this.previous = null;
    if (this.stopFn) {
      this.stopFn();
      this.stopFn = null;
    }
  }

  isRecording(): boolean {
    return this.stopFn !== null;
  }

  /** The in-progress segment as it stands, without rotating it; null when empty. */
  peekCurrent(): {
    events: eventWithTime[];
    startedAt: string;
    endedAt: string;
  } | null {
    if (this.current.events.length === 0) return null;
    const lastTs =
      this.current.events[this.current.events.length - 1]!.timestamp;
    return {
      events: this.current.events.slice(),
      startedAt: this.current.startedAt,
      endedAt: new Date(lastTs).toISOString(),
    };
  }

  // Rotation is driven off rrweb event timestamps rather than wall-clock
  // setInterval — when a tab is backgrounded the timer can be throttled or
  // suspended for arbitrarily long, which used to leave page-load events
  // sitting in `current` for tens of minutes and inflate the reported
  // recording duration.
  private onEvent(event: eventWithTime): void {
    // Subscriber errors must not break recording.
    if (this.onActivity) guarded("replay", this.onActivity);
    if (
      this.current.events.length > 0 &&
      event.timestamp - this.current.startedAtMs >= this.segmentDuration
    ) {
      const completed = this.current;
      const tooStale =
        event.timestamp - this.current.startedAtMs >= 2 * this.segmentDuration;
      this.previous = tooStale ? null : this.current;
      this.current = this.newSegment();
      this.recordFn?.takeFullSnapshot();
      // Notify subscribers about the completed segment after we've rotated so
      // they observe a stable recorder state. `endedAt` is the timestamp of
      // the last event included in the segment.
      if (this.onSegmentReady && completed.events.length > 0) {
        const lastTs = completed.events[completed.events.length - 1]!.timestamp;
        // Subscriber errors must not break recording — rrweb keeps emitting.
        guarded("replay", () =>
          this.onSegmentReady!({
            events: completed.events,
            startedAt: completed.startedAt,
            endedAt: new Date(lastTs).toISOString(),
          }),
        );
      }
    }
    // An event that could not be masked is not kept: losing it costs part of the replay, keeping it could show
    // what the page masks.
    if (!guarded("mask", () => (maskEvent(event, this.node), true), false))
      return;
    // A picture that cannot be added leaves the event as rrweb wrote it.
    if (this.inlineImages) guarded("images", () => this.images.inline(event));
    if (this.current.events.length === 0) {
      this.current.startedAtMs = event.timestamp;
      this.current.startedAt = new Date(event.timestamp).toISOString();
    }
    this.current.events.push(event);
  }

  /**
   * Forcibly rotates the current segment and returns it. Used on session-end
   * triggers (pagehide / inactivity) to drain the in-flight segment before
   * upload. Returns `null` when there are no events to drain.
   */
  drainCurrent(): {
    events: eventWithTime[];
    startedAt: string;
    endedAt: string;
  } | null {
    if (this.current.events.length === 0) return null;
    const completed = this.current;
    this.current = this.newSegment();
    const lastTs = completed.events[completed.events.length - 1]!.timestamp;
    return {
      events: completed.events,
      startedAt: completed.startedAt,
      endedAt: new Date(lastTs).toISOString(),
    };
  }

  private newSegment(): Segment {
    const now = Date.now();
    return {
      events: [],
      startedAt: new Date(now).toISOString(),
      startedAtMs: now,
    };
  }

  getSegments(): { events: eventWithTime[]; timestamp: string }[] {
    const segments: { events: eventWithTime[]; timestamp: string }[] = [];
    if (this.previous && this.previous.events.length > 0) {
      segments.push({
        events: this.previous.events,
        timestamp: this.previous.startedAt,
      });
    }
    if (this.current.events.length > 0) {
      segments.push({
        events: this.current.events,
        timestamp: this.current.startedAt,
      });
    }
    return segments;
  }

  /**
   * Events for the per-exception clip. Returns a single segment so the clip is
   * bounded to `segmentDuration` (default 30 s) no matter how long the session
   * has been running: shipping `previous` + `current` would span up to two
   * segments (~60 s). We prefer `current` because it is closest to the error;
   * each segment is self-contained (it begins with the meta + full snapshot
   * rrweb emits at record start and on every rotation), so it replays
   * standalone without `previous`.
   */
  getClipEvents(): eventWithTime[] {
    if (this.current.events.length > 0) return this.current.events;
    if (this.previous && this.previous.events.length > 0) {
      return this.previous.events;
    }
    return [];
  }

  hasSegments(): boolean {
    return (
      this.current.events.length > 0 ||
      (this.previous !== null && this.previous.events.length > 0)
    );
  }

  /**
   * Discards the in-flight segment and starts a new one from a full
   * snapshot, so it replays on its own: used when a session opens again and
   * when a hidden page becomes visible after its segment was flushed.
   */
  startFresh(): void {
    this.previous = null;
    this.current = this.newSegment();
    if (this.stopFn) {
      this.recordFn?.takeFullSnapshot();
    }
  }

  flush(): void {
    this.previous = null;
    this.current = this.newSegment();
    if (this.stopFn) {
      this.recordFn?.takeFullSnapshot();
    }
  }
}
