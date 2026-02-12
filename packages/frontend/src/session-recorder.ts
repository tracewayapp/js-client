import type { eventWithTime } from "rrweb";
import { record } from "rrweb";

export interface SessionRecorderOptions {
  segmentDuration?: number;
}

interface Segment {
  events: eventWithTime[];
  startedAt: string;
}

export class SessionRecorder {
  private segmentDuration: number;
  private current: Segment;
  private previous: Segment | null = null;
  private stopFn: (() => void) | null = null;
  private rotateInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionRecorderOptions = {}) {
    this.segmentDuration = options.segmentDuration ?? 10_000;
    this.current = { events: [], startedAt: new Date().toISOString() };
  }

  start(): void {
    this.stopFn = record({
      emit: (event) => {
        this.onEvent(event);
      },
    });

    this.rotateInterval = setInterval(() => {
      this.rotateSegment();
    }, this.segmentDuration);
  }

  stop(): void {
    if (this.stopFn) {
      this.stopFn();
      this.stopFn = null;
    }
    if (this.rotateInterval) {
      clearInterval(this.rotateInterval);
      this.rotateInterval = null;
    }
  }

  private onEvent(event: eventWithTime): void {
    this.current.events.push(event);
  }

  private rotateSegment(): void {
    this.previous = this.current;
    this.current = { events: [], startedAt: new Date().toISOString() };
    record.takeFullSnapshot();
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
    this.current = { events: [], startedAt: new Date().toISOString() };
    if (this.stopFn) {
      record.takeFullSnapshot();
    }
  }
}
