import {
  applyLimits,
  applyOverlay,
  clampToCeilings,
  lowerMode,
  modeRank,
} from "../settings/merge.js";
import type {
  Ceilings,
  Mode,
  Settings,
  SignalName,
  SignalSelector,
} from "../settings/types.js";

export interface StreamOverride {
  /**
   * `"*"` covers every signal that is not off; listing a signal also turns it on. Either way the result stays
   * within the page's ceilings and the plan's limits.
   */
  signals: SignalSelector;
  replay: boolean;
  untilMs: number;
  /**
   * A capture: `"*"` also brings back the signals rules switched off, everything this page collects by default.
   * Signals that are off in the defaults (resource timing) still need to be listed.
   */
  includeOff?: boolean;
}

/**
 * The effective collection settings at any moment: built-in defaults, then
 * the remote overlay, clamped to the page's ceilings, then any temporary
 * "stream for a while" overrides from triggers and captures.
 */
export class ControlState {
  private remote: Record<string, unknown> | null = null;
  private effective: Settings;
  private overrides = new Map<string, StreamOverride[]>();
  private overrideSequence = 0;
  private listeners = new Set<(settings: Settings) => void>();
  /** The page's ceilings lowered to the plan limits of the current remote document. */
  private ceilings: Ceilings;

  constructor(
    private readonly defaults: Settings,
    private readonly pageCeilings: Ceilings,
    private readonly now: () => number = Date.now,
  ) {
    this.ceilings = pageCeilings;
    this.effective = clampToCeilings(defaults, pageCeilings);
  }

  settings(): Settings {
    return this.effective;
  }

  remoteOverlay(): Record<string, unknown> | null {
    return this.remote;
  }

  /** Applies a parsed remote document, or `null` to fall back to the defaults. */
  applyRemote(overlay: Record<string, unknown> | null): void {
    this.remote = overlay;
    this.ceilings = applyLimits(this.pageCeilings, overlay);
    const merged = overlay
      ? applyOverlay(this.defaults, overlay)
      : this.defaults;
    this.effective = clampToCeilings(merged, this.ceilings);
    for (const listener of this.listeners) {
      try {
        listener(this.effective);
      } catch {
        // A listener must not stop the others from seeing the change.
      }
    }
  }

  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addOverride(override: StreamOverride): void {
    this.setOverrides(`stream:${this.overrideSequence++}`, [override]);
  }

  setOverrides(owner: string, overrides: StreamOverride[]): void {
    if (overrides.length) this.overrides.set(owner, overrides);
    else this.overrides.delete(owner);
    this.activeOverrides();
  }

  nextOverrideExpiry(): number | undefined {
    const active = this.activeOverrides();
    return active.length
      ? Math.min(...active.map((o) => o.untilMs))
      : undefined;
  }

  private activeOverrides(): StreamOverride[] {
    const now = this.now();
    for (const [owner, overrides] of this.overrides) {
      const active = overrides.filter((o) => o.untilMs > now);
      if (active.length) this.overrides.set(owner, active);
      else this.overrides.delete(owner);
    }
    return [...this.overrides.values()].flat();
  }

  canExport(signal: SignalName): boolean {
    return (
      this.enabled() &&
      this.ceilings.signals[signal] === "stream" &&
      this.modeFor(signal) !== "off"
    );
  }

  enabled(): boolean {
    return this.effective.enabled;
  }

  modeFor(signal: SignalName): Mode {
    if (!this.effective.enabled) return "off";
    const base = this.effective.signals[signal].mode;
    if (base === "stream") return base;
    for (const override of this.activeOverrides()) {
      if (this.covers(override, signal, base))
        return lowerMode("stream", this.ceilings.signals[signal]);
    }
    return base;
  }

  private covers(
    override: StreamOverride,
    signal: SignalName,
    base: Mode,
  ): boolean {
    if (override.signals.includes(signal)) return true;
    if (!override.signals.includes("*")) return false;
    return (
      base !== "off" ||
      (override.includeOff === true &&
        this.defaults.signals[signal].mode !== "off")
    );
  }

  replayMode(): Mode {
    if (!this.effective.enabled) return "off";
    const base = this.effective.replay.mode;
    const boosted = this.activeOverrides().some((o) => o.replay);
    if (boosted && modeRank(base) < modeRank("stream")) {
      return lowerMode("stream", this.ceilings.replay);
    }
    return base;
  }

  sampleRate(signal: SignalName): number {
    return this.effective.signals[signal].sampleRate;
  }
}
