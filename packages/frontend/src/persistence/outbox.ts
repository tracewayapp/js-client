import type { StoredBatch } from "./idb.js";
import { deleteIds, listByToken, OUTBOX_STORE, putAll } from "./idb.js";

export type SendResult = "sent" | "retry" | "drop";

const MAX_ATTEMPTS = 8;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_BATCHES = 200;

/**
 * OTLP batches that could not be sent: offline, a server error, or more than
 * the browser lets leave during unload. They wait in IndexedDB and the next
 * page of the app, any tab, sends them. A Web Lock keeps two tabs from
 * sending the same batch.
 */
export class Outbox {
  private draining: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private online = () => {
    void this.drain();
  };

  start(): void {
    if (this.active) return;
    this.active = true;
    if (typeof window !== "undefined")
      window.addEventListener("online", this.online);
    this.schedule(2_000);
  }

  stop(): void {
    this.active = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (typeof window !== "undefined")
      window.removeEventListener("online", this.online);
  }

  private schedule(delayMs: number): void {
    if (!this.active || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, delayMs);
  }

  constructor(
    private readonly token: string,
    private readonly send: (
      kind: StoredBatch["kind"],
      body: string,
    ) => Promise<SendResult>,
    private readonly now: () => number = Date.now,
  ) {}

  async add(kind: StoredBatch["kind"], body: string): Promise<void> {
    try {
      await putAll(OUTBOX_STORE, [
        { token: this.token, kind, body, createdAtMs: this.now(), attempts: 0 },
      ]);
      this.schedule(5_000);
    } catch {
      // Storage full or refused: the batch is lost, as it would be without the outbox.
    }
  }

  drain(): Promise<void> {
    if (this.draining) return this.draining;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const run = () => this.drainLocked();
    const locks =
      typeof navigator !== "undefined"
        ? (navigator as Navigator & { locks?: LockManager }).locks
        : undefined;
    this.draining = (
      locks
        ? locks.request(
            `traceway-outbox-${this.token}`,
            { ifAvailable: true },
            (lock) => (lock ? run() : this.schedule(5_000)),
          )
        : run()
    )
      .catch(() => this.schedule(30_000))
      .finally(() => {
        this.draining = null;
      }) as Promise<void>;
    return this.draining;
  }

  private async drainLocked(): Promise<void> {
    const batches = await listByToken(OUTBOX_STORE, this.token);
    const stale = batches.filter(
      (b, i) =>
        this.now() - b.createdAtMs > MAX_AGE_MS ||
        b.attempts >= MAX_ATTEMPTS ||
        i < batches.length - MAX_BATCHES,
    );
    await deleteIds(
      OUTBOX_STORE,
      stale.map((b) => b.id!),
    );
    const staleIds = new Set(stale.map((b) => b.id));
    for (const batch of batches) {
      if (staleIds.has(batch.id)) continue;
      const result = await this.send(batch.kind, batch.body);
      if (result === "retry") {
        await putAll(OUTBOX_STORE, [
          { ...batch, attempts: batch.attempts + 1 },
        ]);
        this.schedule(Math.min(5_000 * 2 ** batch.attempts, 300_000));
        return;
      }
      await deleteIds(OUTBOX_STORE, [batch.id!]);
    }
  }
}
