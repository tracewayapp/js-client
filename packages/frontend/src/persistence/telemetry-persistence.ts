import type { ControlState, RingBuffer, SignalName } from "@tracewayapp/core";
import { guarded } from "../guarded.js";
import type { BufferedItem } from "../otel/router.js";
import { BufferStore, serializeBuffer } from "./buffer-store.js";
import { BUFFER_STORE, OUTBOX_STORE, replaceForToken } from "./idb.js";
import type { StoredBatch } from "./idb.js";
import { Outbox } from "./outbox.js";
import type { SendResult } from "./outbox.js";

/** 512 KiB of the origin's session storage at most (it holds UTF-16). */
const MAX_CHECKPOINT_CHARS = 256 * 1024;

/** Owns restoration and durable delivery; restored and new records share the same ring budget. */
export class TelemetryPersistence {
  readonly outbox: Outbox;
  private readonly store: BufferStore;
  private ready: Promise<void> = Promise.resolve();
  private writes: Promise<void> = Promise.resolve();
  private pending = new Set<Promise<void>>();
  private started = false;
  private restored = false;
  private enabled: boolean | null = null;
  private stopped = false;

  constructor(
    private readonly token: string,
    private readonly control: ControlState,
    private readonly buffer: RingBuffer<BufferedItem>,
    private readonly send: (
      kind: StoredBatch["kind"],
      body: string,
    ) => Promise<SendResult>,
  ) {
    this.store = new BufferStore(token);
    this.outbox = new Outbox(token, send);
  }

  start(sessionId: string | null): void {
    // A client started again after shutdown still holds its buffer in memory: loading the stored copy as
    // well would double it, so the copy is only cleared.
    const again = this.started && this.restored;
    this.started = true;
    this.stopped = false;
    this.configure();
    if (!this.enabled || !sessionId) {
      this.restored = true;
      return;
    }
    if (again) {
      void this.store.take(sessionId, 0);
      return;
    }
    const checkpoint = this.readCheckpoint(sessionId);
    this.ready = this.store
      .take(sessionId, this.control.settings().buffer.maxAgeSeconds * 1000)
      .then((entries) => {
        this.restored = true;
        if (this.stopped || !this.enabled) return;
        this.buffer.restore(
          (checkpoint ?? entries)
            .filter((entry) =>
              this.control.canExport(entry.signal as SignalName),
            )
            .map((batch) => ({
              timeMs: batch.timeMs ?? 0,
              signal: batch.signal!,
              bytes: batch.body.length * 2,
              item: { kind: "stored" as const, batch },
            })),
        );
      });
  }

  configure(): void {
    const next =
      this.control.settings().buffer.persist &&
      // The getter itself throws where site data is blocked (SecurityError), as in idb.ts.
      guarded("storage", () => typeof indexedDB !== "undefined", false);
    if (!this.started || next === this.enabled) return;
    this.enabled = next;
    if (next) this.outbox.start();
    else {
      this.outbox.stop();
      try {
        sessionStorage.removeItem(this.checkpointKey());
      } catch {
        /* Storage may be blocked. */
      }
      this.writes = this.writes
        .then(async () => {
          await replaceForToken(BUFFER_STORE, this.token, []);
          await replaceForToken(OUTBOX_STORE, this.token, []);
        })
        .catch(() => undefined);
    }
  }

  exporterOutbox(): Outbox | null {
    return this.enabled && !this.stopped ? this.outbox : null;
  }

  afterRestore(action: () => void): void {
    const task = this.ready.then(() => {
      if (!this.stopped) action();
    });
    this.track(task);
  }

  save(sessionId: string): void {
    if (!this.enabled || this.stopped) return;
    const save = () => {
      if (!this.enabled) return Promise.resolve();
      const entries = serializeBuffer(
        this.buffer.snapshot(),
        this.token,
        sessionId,
      );
      const checkpoint = JSON.stringify({ sessionId, entries });
      try {
        // The origin's 5 MB of session storage are the app's too: a larger buffer is kept in IndexedDB only.
        if (checkpoint.length > MAX_CHECKPOINT_CHARS) throw checkpoint.length;
        sessionStorage.setItem(this.checkpointKey(), checkpoint);
      } catch {
        try {
          sessionStorage.removeItem(this.checkpointKey());
        } catch {
          /* Storage may be blocked. */
        }
      }
      return this.store.save(entries, sessionId);
    };
    this.track(this.restored ? save() : this.ready.then(save));
  }

  sendStored(batch: Pick<StoredBatch, "kind" | "body">): void {
    this.track(
      this.send(batch.kind, batch.body).then(async (result) => {
        if (result === "retry")
          await this.exporterOutbox()?.add(batch.kind, batch.body);
      }),
    );
  }

  async flush(): Promise<void> {
    await this.ready;
    await this.writes;
    await Promise.all([...this.pending]);
  }

  stop(): void {
    this.stopped = true;
    this.enabled = null;
    this.outbox.stop();
  }

  private checkpointKey(): string {
    return `traceway:buffer:${this.token}`;
  }

  private readCheckpoint(sessionId: string): StoredBatch[] | null {
    try {
      const checkpoint = JSON.parse(
        sessionStorage.getItem(this.checkpointKey()) ?? "null",
      );
      if (
        checkpoint?.sessionId !== sessionId ||
        !Array.isArray(checkpoint.entries)
      )
        return null;
      return checkpoint.entries.filter(
        (entry: StoredBatch) =>
          entry.token === this.token &&
          typeof entry.body === "string" &&
          (entry.kind === "logs" || entry.kind === "traces"),
      );
    } catch {
      return null;
    }
  }

  private track(task: Promise<void>): void {
    this.pending.add(task);
    void task.catch(() => undefined).finally(() => this.pending.delete(task));
  }
}
