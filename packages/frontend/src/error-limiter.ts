export interface ErrorLimits {
  maxPerMinute: number;
  duplicateWindowMs: number;
}

export class ErrorLimiter {
  private acceptedByFingerprint = new Map<string, number>();
  private acceptedAt: number[] = [];
  private suppressed = 0;
  totalSuppressed = 0;
  private readonly limits: ErrorLimits;

  constructor(
    options: Partial<ErrorLimits> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.limits = {
      maxPerMinute:
        Number.isFinite(options.maxPerMinute) && options.maxPerMinute! > 0
          ? Math.max(1, Math.min(1000, Math.floor(options.maxPerMinute!)))
          : 60,
      duplicateWindowMs:
        Number.isFinite(options.duplicateWindowMs) &&
        options.duplicateWindowMs! >= 0
          ? Math.min(60_000, options.duplicateWindowMs!)
          : 1000,
    };
  }

  /** Null suppresses this occurrence; an accepted error reports suppressions since the previous accepted one. */
  accept(fingerprint: string): number | null {
    // Hash both ways so retained fingerprints cannot grow with stack trace size.
    let fnvHash = 0x811c9dc5;
    let djbHash = 5381;
    for (let i = 0; i < fingerprint.length; i++) {
      const charCode = fingerprint.charCodeAt(i);
      fnvHash = Math.imul(fnvHash ^ charCode, 0x01000193);
      djbHash = Math.imul(djbHash, 33) ^ charCode;
    }
    fingerprint = `${fnvHash >>> 0}:${djbHash >>> 0}:${fingerprint.length}`;
    const now = this.now();
    this.acceptedAt = this.acceptedAt.filter((time) => time > now - 60_000);
    for (const [key, time] of this.acceptedByFingerprint) {
      if (time <= now - this.limits.duplicateWindowMs)
        this.acceptedByFingerprint.delete(key);
    }
    if (
      this.acceptedAt.length >= this.limits.maxPerMinute ||
      this.acceptedByFingerprint.has(fingerprint)
    ) {
      this.suppressed++;
      this.totalSuppressed++;
      return null;
    }
    this.acceptedAt.push(now);
    this.acceptedByFingerprint.set(fingerprint, now);
    const count = this.suppressed;
    this.suppressed = 0;
    return count;
  }
}
