/**
 * Tracks user-session boundaries when `recordAllSessions: true`.
 *
 *   - Inactivity timeout: 15 minutes since the last `markActivity()` call.
 *   - Max duration: 60 minutes from session start ends the session unconditionally.
 *   - Page unload: `pagehide` ends the session and triggers a final flush.
 *   - Visibility transitions to `hidden` trigger a soft flush without ending the session.
 *   - Activity after an inactivity or max-duration end starts a new session.
 *
 * Activity detection itself is delegated to the caller — `client.ts` taps
 * rrweb's `emit` callback and forwards each event to `markActivity()`. That
 * single hook covers every input rrweb captures (mouse, keyboard, touch,
 * scroll, navigation) without re-registering the same listeners on `window`.
 */

export const DEFAULT_INACTIVITY_MS = 15 * 60_000;
export const DEFAULT_MAX_DURATION_MS = 60 * 60_000;

export interface SessionLifecycleOptions {
  inactivityMs?: number;
  maxDurationMs?: number;
  /** Polling interval for inactivity/max checks. Defaults to 30 s. */
  checkIntervalMs?: number;
  /** Start of a session resumed from a previous page load. Defaults to now. */
  startedAtMs?: number;
  /** Last activity of a session resumed from a previous page load. Defaults to now. */
  lastActivityMs?: number;
  /**
   * Receives when the session ended: the last activity for an inactivity
   * end, so a tab frozen in the background does not stretch the session
   * over the time it sat unattended; the current time otherwise.
   */
  onSessionEnd: (endedAtMs: number) => void;
  onSoftFlush?: () => void;
  /** Fires when the page becomes visible again with the session still open. */
  onResume?: () => void;
  /**
   * Fires synchronously *before* `onSessionEnd` when the page is actually
   * unloading (`pagehide`). The client uses this to flip an `unloading`
   * flag so the closing flush picks the keepalive transport path.
   */
  onUnloading?: () => void;
  /**
   * Fires when a session should open again after it ended: the page was
   * restored from the back/forward cache (`pageshow` with `persisted`), or
   * activity arrived after an inactivity or max-duration end.
   */
  onSessionRestart?: () => void;
}

export class SessionLifecycle {
  private inactivityMs: number;
  private maxDurationMs: number;
  private checkIntervalMs: number;
  private onSessionEnd: (endedAtMs: number) => void;
  private onSoftFlush: () => void;
  private onResume: () => void;
  private onUnloading: () => void;
  private onSessionRestart: () => void;

  private startedAtMs: number;
  private lastActivityMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private installed = false;
  private ended = false;
  private unloaded = false;

  private boundPagehide = () => this.handlePagehide();
  private boundVisibility = () => this.handleVisibility();
  private boundPageshow = (e: PageTransitionEvent) => this.handlePageshow(e);

  constructor(options: SessionLifecycleOptions) {
    this.inactivityMs = options.inactivityMs ?? DEFAULT_INACTIVITY_MS;
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    this.checkIntervalMs = options.checkIntervalMs ?? 30_000;
    this.onSessionEnd = options.onSessionEnd;
    this.onSoftFlush = options.onSoftFlush ?? (() => {});
    this.onResume = options.onResume ?? (() => {});
    this.onUnloading = options.onUnloading ?? (() => {});
    this.onSessionRestart = options.onSessionRestart ?? (() => {});

    const now = Date.now();
    this.startedAtMs = options.startedAtMs ?? now;
    this.lastActivityMs = options.lastActivityMs ?? now;
  }

  install(): void {
    if (this.installed || typeof window === "undefined") return;
    window.addEventListener("pagehide", this.boundPagehide);
    window.addEventListener("pageshow", this.boundPageshow);
    document.addEventListener("visibilitychange", this.boundVisibility);
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);
    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) return;
    window.removeEventListener("pagehide", this.boundPagehide);
    window.removeEventListener("pageshow", this.boundPageshow);
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
    if (this.ended && !this.unloaded) {
      this.restart();
    }
  }

  lastActivity(): number {
    return this.lastActivityMs;
  }

  /** Start fresh — used after a previous session ended via timeout. */
  reset(): void {
    const now = Date.now();
    this.startedAtMs = now;
    this.lastActivityMs = now;
    this.ended = false;
  }

  /** Carry on a session that started on an earlier page load. */
  continueFrom(startedAtMs: number, lastActivityMs: number): void {
    this.startedAtMs = startedAtMs;
    this.lastActivityMs = lastActivityMs;
  }

  startedAt(): Date {
    return new Date(this.startedAtMs);
  }

  private tick(): void {
    if (this.ended) return;
    const now = Date.now();
    if (now - this.lastActivityMs >= this.inactivityMs) {
      this.endSession(this.lastActivityMs);
    } else if (now - this.startedAtMs >= this.maxDurationMs) {
      this.endSession(now);
    }
  }

  private handlePagehide(): void {
    this.unloaded = true;
    try {
      this.onUnloading();
    } catch {
      // ignore
    }
    this.endSession(Date.now());
  }

  private handlePageshow(event: PageTransitionEvent): void {
    // event.persisted === true means the browser restored the page from
    // bfcache (back/forward navigation). The previous session was already
    // closed by pagehide; the client needs a fresh one. The persisted ===
    // false case is just the initial page load, which the SDK handled at
    // construction time — nothing to do.
    if (!event.persisted) return;
    this.unloaded = false;
    this.restart();
  }

  private handleVisibility(): void {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      this.onSoftFlush();
      return;
    }
    // A background tab's timers are throttled or frozen, so the inactivity
    // check may not have run while it was hidden. Settle it before anything
    // the page does on becoming visible counts as fresh activity.
    this.tick();
    if (!this.ended) {
      try {
        this.onResume();
      } catch {
        // ignore
      }
    }
  }

  private restart(): void {
    this.reset();
    try {
      this.onSessionRestart();
    } catch {
      // ignore
    }
  }

  private endSession(endedAtMs: number): void {
    if (this.ended) return;
    this.ended = true;
    try {
      this.onSessionEnd(endedAtMs);
    } catch {
      // Caller errors must not bubble into a unload handler.
    }
  }
}
