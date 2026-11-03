import type { ControlState, RingBuffer, SignalName } from "@tracewayapp/core";
import type { BufferedItem } from "../otel/router.js";
import { BufferStore, serializeBuffer } from "./buffer-store.js";
import { BUFFER_STORE, OUTBOX_STORE, replaceForToken } from "./idb.js";
import type { StoredBatch } from "./idb.js";
import { Outbox } from "./outbox.js";
import type { SendResult } from "./outbox.js";

/** Owns restoration and durable delivery; restored and new records share the same ring budget. */
export class TelemetryPersistence {
  readonly outbox: Outbox;
  private readonly store: BufferStore;
  private ready: Promise<void> = Promise.resolve();
  private writes: Promise<void> = Promise.resolve();
  private pending = new Set<Promise<void>>();
  private started = false;
  private restored = false;
  private checkpointTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.started = true;
    this.configure();
    if (!this.enabled || !sessionId) {
      this.restored = true;
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
      typeof indexedDB !== "undefined";
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
      const entries = this.buffer.snapshot();
      try {
        sessionStorage.setItem(
          this.checkpointKey(),
          JSON.stringify({
            sessionId,
            entries: serializeBuffer(entries, this.token, sessionId),
          }),
        );
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

  checkpoint(sessionId: string | null): void {
    if (
      !sessionId ||
      !this.enabled ||
      this.stopped ||
      this.checkpointTimer !== null
    )
      return;
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = null;
      this.save(sessionId);
    }, 1_000);
  }

  sendStored(batch: StoredBatch): void {
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
    if (this.checkpointTimer !== null) clearTimeout(this.checkpointTimer);
    this.checkpointTimer = null;
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
