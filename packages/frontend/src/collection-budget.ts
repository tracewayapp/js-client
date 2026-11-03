export interface CollectionLimits {
  maxBytes: number;
  maxEvents: number;
}

export class CollectionBudget {
  private sessionId: string | null | undefined;
  private bytes = 0;
  private events = 0;
  private dropped = 0;
  private readonly limits: CollectionLimits;

  constructor(
    private readonly token: string,
    options: Partial<CollectionLimits> = {},
  ) {
    this.limits = {
      maxBytes:
        Number.isFinite(options.maxBytes) && options.maxBytes! > 0
          ? Math.min(options.maxBytes!, 50 * 1024 * 1024)
          : 50 * 1024 * 1024,
      maxEvents:
        Number.isFinite(options.maxEvents) && options.maxEvents! > 0
          ? Math.max(1, Math.floor(Math.min(options.maxEvents!, 10_000)))
          : 10_000,
    };
  }

  admit(sessionId: string | null, bytes: number, events = 1): boolean {
    if (this.sessionId !== sessionId) {
      this.sessionId = sessionId;
      this.bytes = this.events = this.dropped = 0;
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(`traceway:budget:${this.token}`) ?? "{}",
        );
        if (saved.sessionId === sessionId) {
          for (const key of ["bytes", "events", "dropped"] as const) {
            if (Number.isFinite(saved[key]) && saved[key] >= 0)
              this[key] = saved[key];
          }
        }
      } catch {}
    }
    if (
      this.bytes + bytes > this.limits.maxBytes ||
      this.events + events > this.limits.maxEvents
    ) {
      this.dropped += events;
      return false;
    }
    this.bytes += bytes;
    this.events += events;
    try {
      sessionStorage.setItem(
        `traceway:budget:${this.token}`,
        JSON.stringify({
          sessionId,
          bytes: this.bytes,
          events: this.events,
          dropped: this.dropped,
        }),
      );
    } catch {}
    return true;
  }

  snapshot(): Record<string, number> {
    return {
      "traceway.collection.bytes": this.bytes,
      "traceway.collection.events": this.events,
      "traceway.collection.dropped": this.dropped,
      "traceway.collection.max_bytes": this.limits.maxBytes,
      "traceway.collection.max_events": this.limits.maxEvents,
    };
  }
}
