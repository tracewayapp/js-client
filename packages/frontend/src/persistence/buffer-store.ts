import type { BufferEntry } from "@tracewayapp/core";
import type { BufferedItem } from "../otel/router.js";
import type { StoredBatch } from "./idb.js";
import { BUFFER_STORE, updateToken, writeSessionSnapshot } from "./idb.js";
import { logsToJson, spansToJson } from "./otlp-json.js";

/**
 * Keeps the on-device buffer across page loads. When a page is hidden its
 * buffer is written here; the next page of the same session loads it, so a
 * trigger there can still upload what happened on the page before.
 */
export class BufferStore {
  constructor(private readonly token: string) {}

  async save(
    entries: BufferEntry<BufferedItem>[],
    sessionId: string,
  ): Promise<void> {
    try {
      const batches = serializeBuffer(entries, this.token, sessionId);
      await writeSessionSnapshot(this.token, sessionId, batches);
    } catch {
      // Losing the persisted buffer only loses context from earlier pages.
    }
  }

  /** Takes the stored entries of `sessionId` and drops entries older than the buffer's age limit. */
  async take(sessionId: string, maxAgeMs: number): Promise<StoredBatch[]> {
    try {
      const cutoff = Date.now() - maxAgeMs;
      let taken: StoredBatch[] = [];
      await updateToken(BUFFER_STORE, this.token, (all) => {
        taken = all.filter(
          (b) => b.sessionId === sessionId && (b.timeMs ?? 0) >= cutoff,
        );
        const expired = all.filter((b) => (b.timeMs ?? 0) < cutoff);
        return { remove: [...taken, ...expired].map((b) => b.id!), put: [] };
      });
      return taken;
    } catch {
      return [];
    }
  }
}

export function serializeBuffer(
  entries: BufferEntry<BufferedItem>[],
  token: string,
  sessionId: string,
): StoredBatch[] {
  const now = Date.now();
  return entries.map(
    (entry): StoredBatch => ({
      token,
      kind:
        entry.item.kind === "stored"
          ? entry.item.batch.kind
          : entry.item.kind === "log"
            ? "logs"
            : "traces",
      body:
        entry.item.kind === "stored"
          ? entry.item.batch.body
          : entry.item.kind === "log"
            ? logsToJson([entry.item.record])
            : spansToJson([entry.item.span]),
      createdAtMs: now,
      attempts: 0,
      timeMs: entry.timeMs,
      signal: entry.signal,
      sessionId,
    }),
  );
}
