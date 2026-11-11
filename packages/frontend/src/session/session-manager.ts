import { generateUUID } from "@tracewayapp/core";
import { collectDefaultAttributes } from "../default-attributes.js";
import {
  DEFAULT_INACTIVITY_MS,
  DEFAULT_MAX_DURATION_MS,
  SessionLifecycle,
} from "../session-lifecycle.js";
import {
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
} from "../session-store.js";

const ENTRY_ATTRIBUTE_KEYS = ["url", "path", "referrer"] as const;
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "scroll",
  "touchstart",
] as const;
const ACTIVITY_THROTTLE_MS = 1_000;

export interface SessionInfo {
  id: string;
  startedAtMs: number;
}

export interface SessionManagerOptions {
  storeKey: string;
  onStart(session: SessionInfo, resumed: boolean): void;
  onEnd(session: SessionInfo, endedAtMs: number, unloading: boolean): void;
  /** The page was hidden: the browser may freeze or discard it without a pagehide. */
  onHidden(): void;
  onVisible(): void;
  inactivityMs?: number;
  maxDurationMs?: number;
}

function entryAttributes(): Record<string, string> {
  const defaults = collectDefaultAttributes();
  const entry: Record<string, string> = {};
  for (const key of ENTRY_ATTRIBUTE_KEYS) {
    if (defaults[key] !== undefined) entry[key] = defaults[key]!;
  }
  return entry;
}

/**
 * One session per tab, as in 1.x: it ends after 15 minutes without activity
 * or 60 minutes in total, and the next page of the same tab continues it.
 * Activity is any input, so sessions work whether or not replay is recording.
 */
export class SessionManager {
  private session: SessionInfo | null = null;
  private active = false;
  private segmentIndex = 0;
  private entry: Record<string, string> = {};
  private lifecycle: SessionLifecycle | null = null;
  private lastActivityPersistMs = 0;
  private boundActivity = () => this.markActivity();

  constructor(private readonly options: SessionManagerOptions) {}

  start(): void {
    if (typeof window === "undefined") return;
    const lastActivityMs = this.open();
    this.lifecycle = new SessionLifecycle({
      startedAtMs: this.session!.startedAtMs,
      lastActivityMs,
      inactivityMs: this.options.inactivityMs,
      maxDurationMs: this.options.maxDurationMs,
      onSessionEnd: (endedAtMs) => this.end(endedAtMs, false),
      onUnloading: () => this.end(Date.now(), true),
      onSessionRestart: () => this.restart(),
      onSoftFlush: () => {
        if (this.active) this.persist(Date.now());
        this.options.onHidden();
      },
      onResume: () => {
        if (this.active) this.persist();
        this.options.onVisible();
      },
    });
    this.lifecycle.install();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, this.boundActivity, {
        passive: true,
        capture: true,
      });
    }
  }

  close(): void {
    this.end(Date.now(), true);
  }

  stop(): void {
    this.lifecycle?.uninstall();
    this.lifecycle = null;
    if (typeof window !== "undefined") {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, this.boundActivity, {
          capture: true,
        });
      }
    }
  }

  /** The open session's id; null between an inactivity end and the next activity. */
  currentId(): string | null {
    return this.active && this.session ? this.session.id : null;
  }

  current(): SessionInfo | null {
    return this.active ? this.session : null;
  }

  /** url/path/referrer of the page the session started on; they stay pinned for the whole session. */
  entryAttributes(): Record<string, string> {
    return { ...this.entry };
  }

  nextSegmentIndex(): number {
    const index = this.segmentIndex++;
    this.persist();
    return index;
  }

  markActivity(): void {
    const now = Date.now();
    if (now - this.lastActivityPersistMs < ACTIVITY_THROTTLE_MS && this.active)
      return;
    this.lastActivityPersistMs = now;
    this.lifecycle?.markActivity();
  }

  private open(): number {
    const now = Date.now();
    const stored = readStoredSession(this.options.storeKey);
    const inactivity = this.options.inactivityMs ?? DEFAULT_INACTIVITY_MS;
    const maxDuration = this.options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    const resumable =
      stored !== null &&
      stored.closedAtMs !== undefined &&
      now - stored.lastActivityMs < inactivity &&
      now - stored.startedAtMs < maxDuration;

    let lastActivityMs = now;
    if (resumable) {
      this.session = { id: stored.id, startedAtMs: stored.startedAtMs };
      this.segmentIndex = stored.segmentIndex;
      this.entry = stored.entry ?? {};
      lastActivityMs = stored.lastActivityMs;
    } else {
      this.session = { id: generateUUID(), startedAtMs: now };
      this.segmentIndex = 0;
      this.entry = entryAttributes();
    }
    this.active = true;
    this.persist();
    this.options.onStart(this.session, resumable);
    return lastActivityMs;
  }

  private end(endedAtMs: number, unloading: boolean): void {
    if (!this.session || !this.active) return;
    try {
      this.options.onEnd(this.session, endedAtMs, unloading);
    } finally {
      if (unloading) this.persist(Date.now());
      else clearStoredSession(this.options.storeKey);
      this.active = false;
    }
  }

  private restart(): void {
    const lastActivityMs = this.open();
    this.lifecycle?.continueFrom(this.session!.startedAtMs, lastActivityMs);
  }

  private persist(closedAtMs?: number, force = false): void {
    if (!this.session || (!this.active && !force)) return;
    writeStoredSession(this.options.storeKey, {
      id: this.session.id,
      startedAt: new Date(this.session.startedAtMs).toISOString(),
      startedAtMs: this.session.startedAtMs,
      lastActivityMs: this.lifecycle?.lastActivity() ?? Date.now(),
      segmentIndex: this.segmentIndex,
      entry: this.entry,
      closedAtMs,
    });
  }
}
