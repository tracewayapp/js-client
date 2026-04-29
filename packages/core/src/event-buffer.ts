import type { TracewayEventBase } from "./types.js";

export interface EventBufferOptions {
  /** Window kept relative to `now`. Older entries are pruned. Default 10_000ms. */
  windowMs?: number;
  /** Hard cap on entries kept regardless of window. Default 200. */
  maxSize?: number;
}

/**
 * Time-windowed FIFO buffer with a hard size cap.
 *
 * Drops entries older than `windowMs` and keeps at most `maxSize` entries.
 * Pruning runs on every `add` and `snapshot` so the buffer is self-maintaining
 * without a background timer. Mirrors the Flutter SDK's EventBuffer.
 */
export class EventBuffer<T extends TracewayEventBase> {
  readonly windowMs: number;
  readonly maxSize: number;
  private q: T[] = [];

  constructor(options: EventBufferOptions = {}) {
    this.windowMs = options.windowMs ?? 10_000;
    this.maxSize = options.maxSize ?? 200;
  }

  add(event: T): void {
    this.q.push(event);
    this.prune();
  }

  /** Returns events ordered oldest -> newest. */
  snapshot(): T[] {
    this.prune();
    return this.q.slice();
  }

  clear(): void {
    this.q.length = 0;
  }

  get length(): number {
    return this.q.length;
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.q.length > 0 && Date.parse(this.q[0]!.timestamp) < cutoff) {
      this.q.shift();
    }
    while (this.q.length > this.maxSize) {
      this.q.shift();
    }
  }
}
