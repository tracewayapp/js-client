import { gzipSync, strToU8 } from "fflate";

export interface RecordingSegment {
  /** The `traceway.exception.id` of the exception this segment is a clip of. */
  exceptionId?: string;
  sessionId?: string;
  segmentIndex?: number;
  events: unknown[];
  startedAt?: string;
  endedAt?: string;
}

interface Batch {
  segments: string[];
  attempts: number;
}

const MAX_SEGMENTS_PER_REQUEST = 100;
/** Batches kept while uploads fail (offline, an outage): the oldest go first, counted as failed. */
const MAX_QUEUED_BATCHES = 20;
/**
 * Browsers cap all in-flight keepalive bodies of a page at 64 KiB. Replay takes what is left after the room
 * kept for the session's closing event, which must not be the request that is refused.
 */
const KEEPALIVE_BUDGET_BYTES = 44 * 1024;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
const PERMANENT_FAILURES = new Set([400, 401, 403, 404, 413, 422]);

/**
 * Sends replay segments to the dedicated, non-OpenTelemetry recordings
 * endpoint. Failed batches are retried a few times with growing delays and
 * then dropped, so a server that keeps rejecting them cannot grow memory.
 */
export class RecordingsTransport {
  private queue: Batch[] = [];
  failedSegments = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private generation = 0;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly admit: (segment: RecordingSegment, serialized: string) => boolean = () => true,
    private readonly onFailure: () => void = () => {},
  ) {}

  send(
    segments: RecordingSegment[],
    options: { unloading?: boolean; onAdmitted?: (segment: RecordingSegment) => void } = {},
  ): number {
    const accepted: string[] = [];
    for (const segment of segments) {
      // Later events can take the embedded pictures out of the live segment. Queue the exact snapshot admitted here.
      let serialized: string;
      try {
        serialized = JSON.stringify(segment);
      } catch {
        this.recordFailure(1);
        continue;
      }
      if (this.admit(segment, serialized)) {
        accepted.push(serialized);
        options.onAdmitted?.(segment);
      }
    }
    for (let i = 0; i < accepted.length; i += MAX_SEGMENTS_PER_REQUEST) {
      this.queue.push({
        segments: accepted.slice(i, i + MAX_SEGMENTS_PER_REQUEST),
        attempts: 0,
      });
    }
    while (this.queue.length > MAX_QUEUED_BATCHES)
      this.recordFailure(this.queue.shift()!.segments.length);
    if (options.unloading) {
      this.drainKeepalive();
    } else {
      this.schedule(0);
    }
    return accepted.length;
  }

  discard(): void {
    this.generation++;
    this.queue = [];
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  pending(): number {
    return this.queue.reduce((n, b) => n + b.segments.length, 0);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.inFlight;
    await this.drain();
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.drain();
      },
      // A longer Retry-After would run at once: browsers wrap delays over 2^31 - 1 ms.
      Math.min(delayMs, 2 ** 31 - 1),
    );
  }

  private drain(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      while (this.queue.length > 0) {
        const batch = this.queue.shift()!;
        const generation = this.generation;
        const retryAfterMs = await this.post(batch, false);
        if (generation !== this.generation) continue;
        if (retryAfterMs !== null) {
          this.queue.unshift(batch);
          this.schedule(retryAfterMs);
          return;
        }
      }
    })().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private drainKeepalive(): void {
    let budget = KEEPALIVE_BUDGET_BYTES;
    const remaining: Batch[] = [];
    for (const batch of this.queue) {
      const body = this.encode(batch.segments);
      if (body.byteLength > budget) {
        remaining.push(batch);
        continue;
      }
      budget -= body.byteLength;
      void this.request(body, true)
        .then((response) => {
          if (!response.ok) this.recordFailure(batch.segments.length);
        })
        .catch(() => this.recordFailure(batch.segments.length));
    }
    this.queue = remaining;
  }

  /** Returns null when the batch is done (sent or given up), else how long to wait before retrying. */
  private async post(batch: Batch, keepalive: boolean): Promise<number | null> {
    batch.attempts++;
    let response: Response;
    try {
      response = await this.request(this.encode(batch.segments), keepalive);
    } catch {
      return this.retryDelay(batch, null);
    }
    if (response.ok) return null;
    if (PERMANENT_FAILURES.has(response.status)) {
      this.recordFailure(batch.segments.length);
      return null;
    }
    const retryAfter = Number(response.headers.get("Retry-After"));
    return this.retryDelay(
      batch,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
    );
  }

  private retryDelay(batch: Batch, requested: number | null): number | null {
    if (batch.attempts > RETRY_DELAYS_MS.length) {
      this.recordFailure(batch.segments.length);
      return null;
    }
    return requested ?? RETRY_DELAYS_MS[batch.attempts - 1]!;
  }

  private recordFailure(count: number): void {
    this.failedSegments += count;
    this.onFailure();
  }

  private encode(segments: string[]): Uint8Array {
    return gzipSync(strToU8('{"segments":[' + segments.join(",") + ']}'));
  }

  private request(body: Uint8Array, keepalive: boolean): Promise<Response> {
    return this.fetchImpl(this.url, {
      method: "POST",
      keepalive,
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        Authorization: `Bearer ${this.token}`,
      },
      body: body as BodyInit,
    });
  }
}
