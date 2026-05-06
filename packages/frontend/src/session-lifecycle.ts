/**
 * Tracks user-session boundaries when `recordAllSessions: true`.
 *
 *   - Inactivity timeout: 15 minutes since the last `markActivity()` call.
 *   - Max duration: 60 minutes from session start ends the session unconditionally.
 *   - Page unload: `pagehide` ends the session and triggers a final flush.
 *   - Visibility transitions to `hidden` trigger a soft flush without ending the session.
 *
 * Activity detection itself is delegated to the caller — `client.ts` taps
 * rrweb's `emit` callback and forwards each event to `markActivity()`. That
 * single hook covers every input rrweb captures (mouse, keyboard, touch,
 * scroll, navigation) without re-registering the same listeners on `window`.
 */

export interface SessionLifecycleOptions {
  inactivityMs?: number;
  maxDurationMs?: number;
  /** Polling interval for inactivity/max checks. Defaults to 30 s. */
  checkIntervalMs?: number;
  onSessionEnd: () => void;
  onSoftFlush?: () => void;
}

export class SessionLifecycle {
  private inactivityMs: number;
  private maxDurationMs: number;
  private checkIntervalMs: number;
  private onSessionEnd: () => void;
  private onSoftFlush: () => void;

  private startedAtMs: number;
  private lastActivityMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private installed = false;
  private ended = false;

  private boundPagehide = () => this.handlePagehide();
  private boundVisibility = () => this.handleVisibility();

  constructor(options: SessionLifecycleOptions) {
    this.inactivityMs = options.inactivityMs ?? 15 * 60_000;
    this.maxDurationMs = options.maxDurationMs ?? 60 * 60_000;
    this.checkIntervalMs = options.checkIntervalMs ?? 30_000;
    this.onSessionEnd = options.onSessionEnd;
    this.onSoftFlush = options.onSoftFlush ?? (() => {});

    const now = Date.now();
    this.startedAtMs = now;
    this.lastActivityMs = now;
  }

  install(): void {
    if (this.installed || typeof window === "undefined") return;
    window.addEventListener("pagehide", this.boundPagehide);
    document.addEventListener("visibilitychange", this.boundVisibility);
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);
    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) return;
    window.removeEventListener("pagehide", this.boundPagehide);
    document.removeEventListener("visibilitychange", this.boundVisibility);
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.installed = false;
  }

  /**
   * Bump the last-activity timestamp. Wire this to rrweb's `emit` callback —
   * every DOM mutation/input rrweb captures becomes an activity tick here.
   */
  markActivity(): void {
    this.lastActivityMs = Date.now();
  }

  /** Start fresh — used after a previous session ended via timeout. */
  reset(): void {
    const now = Date.now();
    this.startedAtMs = now;
    this.lastActivityMs = now;
    this.ended = false;
  }

  startedAt(): Date {
    return new Date(this.startedAtMs);
  }

  private tick(): void {
    if (this.ended) return;
    const now = Date.now();
    if (now - this.lastActivityMs >= this.inactivityMs || now - this.startedAtMs >= this.maxDurationMs) {
      this.endSession();
    }
  }

  private handlePagehide(): void {
    this.endSession();
  }

  private handleVisibility(): void {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      this.onSoftFlush();
    }
  }

  private endSession(): void {
    if (this.ended) return;
    this.ended = true;
    try {
      this.onSessionEnd();
    } catch {
      // Caller errors must not bubble into a unload handler.
    }
  }
}
