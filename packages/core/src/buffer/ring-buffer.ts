export interface BufferEntry<T> {
  timeMs: number;
  signal: string;
  bytes: number;
  item: T;
}

export interface RingBufferOptions {
  maxBytes: number;
  maxAgeMs: number;
  now?: () => number;
}

/**
 * Keeps the newest telemetry on the device within a byte and age budget.
 * When the budget is exceeded the oldest entries go first; nothing leaves
 * the device until a flush takes entries out.
 */
export class RingBuffer<T> {
  private entries: BufferEntry<T>[] = [];
  private totalBytes = 0;
  private maxBytes: number;
  private maxAgeMs: number;
  private readonly now: () => number;
  private evicted = 0;

  constructor(options: RingBufferOptions) {
    this.maxBytes = options.maxBytes;
    this.maxAgeMs = options.maxAgeMs;
    this.now = options.now ?? Date.now;
  }

  configure(options: Omit<RingBufferOptions, "now">): void {
    this.maxBytes = options.maxBytes;
    this.maxAgeMs = options.maxAgeMs;
    this.trim();
  }

  push(entry: BufferEntry<T>): void {
    this.entries.push(entry);
    this.totalBytes += entry.bytes;
    this.trim();
  }

  /** Removes and returns the entries recorded at or after `sinceMs` for the selected signals, oldest first. */
  take(
    sinceMs: number,
    signals: ReadonlySet<string> | "*",
    untilMs = Infinity,
  ): BufferEntry<T>[] {
    this.trim();
    const taken: BufferEntry<T>[] = [];
    const kept: BufferEntry<T>[] = [];
    for (const entry of this.entries) {
      if (
        entry.timeMs >= sinceMs &&
        entry.timeMs <= untilMs &&
        (signals === "*" || signals.has(entry.signal))
      ) {
        taken.push(entry);
        this.totalBytes -= entry.bytes;
      } else {
        kept.push(entry);
      }
    }
    this.entries = kept;
    return taken;
  }

  /** The entries currently held, oldest first, without removing them. */
  snapshot(): BufferEntry<T>[] {
    this.trim();
    return this.entries.slice();
  }

  restore(entries: BufferEntry<T>[]): void {
    this.entries.push(...entries);
    this.totalBytes += entries.reduce((sum, entry) => sum + entry.bytes, 0);
    this.entries.sort((a, b) => a.timeMs - b.timeMs);
    this.trim();
  }

  retain(keep: (entry: BufferEntry<T>) => boolean): void {
    this.entries = this.entries.filter(keep);
    this.totalBytes = this.entries.reduce((sum, entry) => sum + entry.bytes, 0);
    this.trim();
  }

  clear(): void {
    this.entries = [];
    this.totalBytes = 0;
  }

  get size(): number {
    return this.entries.length;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  /** Entries dropped to stay within budget since the buffer was created. */
  get evictedCount(): number {
    return this.evicted;
  }

  private trim(): void {
    const cutoff = this.now() - this.maxAgeMs;
    let drop = 0;
    let bytes = this.totalBytes;
    while (
      drop < this.entries.length &&
      (bytes > this.maxBytes || this.entries[drop]!.timeMs < cutoff)
    ) {
      bytes -= this.entries[drop]!.bytes;
      drop++;
    }
    if (drop > 0) {
      this.entries = this.entries.slice(drop);
      this.totalBytes = bytes;
      this.evicted += drop;
    }
  }
}
