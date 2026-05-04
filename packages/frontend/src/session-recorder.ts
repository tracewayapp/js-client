import type { eventWithTime } from "rrweb";
import { record } from "rrweb";

export interface SessionRecorderOptions {
  segmentDuration?: number;
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

  constructor(options: SessionRecorderOptions = {}) {
    this.segmentDuration = options.segmentDuration ?? 10_000;
    this.current = this.newSegment();
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
    if (
      this.current.events.length > 0 &&
      event.timestamp - this.current.startedAtMs >= this.segmentDuration
    ) {
      const tooStale =
        event.timestamp - this.current.startedAtMs >= 2 * this.segmentDuration;
      this.previous = tooStale ? null : this.current;
      this.current = this.newSegment();
      record.takeFullSnapshot();
    }
    if (this.current.events.length === 0) {
      this.current.startedAtMs = event.timestamp;
      this.current.startedAt = new Date(event.timestamp).toISOString();
    }
    this.current.events.push(event);
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
