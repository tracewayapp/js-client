import type { eventWithTime } from "rrweb";
import { record } from "rrweb";

export interface SessionRecorderOptions {
  segmentDuration?: number;
  /**
   * Fires when a segment fills up and rotates out (i.e., when `current`
   * becomes `previous`). The handed-off segment is not yet uploaded — the
   * caller decides whether to flush it. Used by the always-on path to drop
   * each completed ~10s segment onto the upload queue immediately.
   */
  onSegmentReady?: (segment: { events: eventWithTime[]; startedAt: string; endedAt: string }) => void;
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
  private onSegmentReady: SessionRecorderOptions["onSegmentReady"];
  private onActivity: SessionRecorderOptions["onActivity"];

  constructor(options: SessionRecorderOptions = {}) {
    this.segmentDuration = options.segmentDuration ?? 10_000;
    this.current = this.newSegment();
    this.onSegmentReady = options.onSegmentReady;
    this.onActivity = options.onActivity;
  }

  start(): void {
    this.stopFn = record({
      emit: (event) => {
        this.onEvent(event);
      },
    });
  }

  stop(): void {
    if (this.stopFn) {
      this.stopFn();
      this.stopFn = null;
    }
  }

  // Rotation is driven off rrweb event timestamps rather than wall-clock
  // setInterval — when a tab is backgrounded the timer can be throttled or
  // suspended for arbitrarily long, which used to leave page-load events
  // sitting in `current` for tens of minutes and inflate the reported
  // recording duration.
  private onEvent(event: eventWithTime): void {
    if (this.onActivity) {
      try {
        this.onActivity();
      } catch {
        // Subscriber errors must not break recording.
      }
    }
    if (
      this.current.events.length > 0 &&
      event.timestamp - this.current.startedAtMs >= this.segmentDuration
    ) {
      const completed = this.current;
      const tooStale =
        event.timestamp - this.current.startedAtMs >= 2 * this.segmentDuration;
      this.previous = tooStale ? null : this.current;
      this.current = this.newSegment();
      record.takeFullSnapshot();
      // Notify subscribers about the completed segment after we've rotated so
      // they observe a stable recorder state. `endedAt` is the timestamp of
      // the last event included in the segment.
      if (this.onSegmentReady && completed.events.length > 0) {
        const lastTs = completed.events[completed.events.length - 1].timestamp;
        try {
          this.onSegmentReady({
            events: completed.events,
            startedAt: completed.startedAt,
            endedAt: new Date(lastTs).toISOString(),
          });
        } catch {
          // Subscriber errors must not break recording — rrweb keeps emitting.
        }
      }
    }
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
  drainCurrent(): { events: eventWithTime[]; startedAt: string; endedAt: string } | null {
    if (this.current.events.length === 0) return null;
    const completed = this.current;
    this.current = this.newSegment();
    const lastTs = completed.events[completed.events.length - 1].timestamp;
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

  hasSegments(): boolean {
    return (
      this.current.events.length > 0 ||
      (this.previous !== null && this.previous.events.length > 0)
    );
  }

  flush(): void {
    this.previous = null;
    this.current = this.newSegment();
    if (this.stopFn) {
      record.takeFullSnapshot();
    }
  }
}
