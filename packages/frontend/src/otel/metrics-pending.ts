/** Device storage for the metrics recorder. `get` after `set` returning something else means storage is blocked. */
export interface MetricsStorage {
  get(name: string): string | null;
  set(name: string, value: string): void;
}

export interface PendingPayload {
  id: string;
  /** When it was stored, Unix ms. */
  t: number;
  /** The OTLP request as an object, so a resend can restamp its resource. */
  p: Record<string, any>;
}

const KEY = "pending";
const MAX_PAYLOADS = 3;
const MAX_BYTES = 64 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Metrics payloads whose upload failed or whose page went away before the answer. Small and short-lived on purpose:
 * a device that stays offline loses its oldest numbers, it never builds a backlog.
 */
export class PendingMetrics {
  constructor(private readonly storage: MetricsStorage) {}

  private read(): PendingPayload[] {
    try {
      const list = JSON.parse(this.storage.get(KEY) ?? "[]");
      if (!Array.isArray(list)) return [];
      const oldest = Date.now() - MAX_AGE_MS;
      return list.filter(
        (e) => e && typeof e.id === "string" && e.t > oldest && e.p,
      );
    } catch {
      return [];
    }
  }

  private write(list: PendingPayload[]): void {
    let value = JSON.stringify(list);
    while (
      list.length &&
      (list.length > MAX_PAYLOADS || value.length > MAX_BYTES)
    ) {
      list.shift();
      value = JSON.stringify(list);
    }
    this.storage.set(KEY, value);
  }

  add(id: string, payload: Record<string, any>): void {
    const list = this.read().filter((e) => e.id !== id);
    list.push({ id, t: Date.now(), p: payload });
    this.write(list);
  }

  remove(id: string): void {
    const list = this.read();
    if (list.some((e) => e.id === id))
      this.write(list.filter((e) => e.id !== id));
  }

  /** Hands over everything except `skip` and forgets it: a payload gets one more attempt, never a third. */
  take(skip: ReadonlySet<string>): PendingPayload[] {
    const list = this.read();
    const taken = list.filter((e) => !skip.has(e.id));
    if (taken.length) this.write(list.filter((e) => skip.has(e.id)));
    return taken;
  }
}
