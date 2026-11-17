import type { Matcher, Trigger, TriggerAction, TriggerStep } from "../settings/types.js";
import type { FieldLookup } from "./matcher.js";
import { matches } from "./matcher.js";

export interface ObservedEvent {
  timeMs: number;
  lookup: FieldLookup;
  /**
   * Set for the click and hover events the page feeds in directly. They answer
   * almost no field, so only a step that names this event type may match them:
   * a negated condition would otherwise match every click.
   */
  sequence?: "click" | "hover";
}

export interface FiredTrigger {
  trigger: Trigger;
  actions: TriggerAction[];
  /** The event that completed the trigger, e.g. the exception a clip belongs to. */
  cause: ObservedEvent;
}

/** A completed prefix waiting for its next step: when it completed, and the hit it started counting from. */
interface Anchor {
  at: number;
  from: number;
}

interface StepState {
  /** Unused on the first step, which is always open. Oldest first. */
  anchors: Anchor[];
  /** Times of the records counted towards this step, when it needs more than one. */
  hits: number[];
  /** Hits dropped from the front of `hits`, so an anchor's `from` stays valid. */
  base: number;
}

interface TriggerState {
  signature: string;
  steps: StepState[];
  /** Per step, the page event types its matcher names. */
  kinds: Array<Set<string>>;
  fires: number;
  lastFireMs: number;
}

const MAX_ANCHORS = 8;
const MAX_HITS = 1000;
const MAX_RESTORE_AGE_MS = 86_400_000;

/**
 * Runs the server-defined triggers against every event on the device. A
 * trigger is a sequence of steps. Every way the sequence could be under way is
 * followed at once: each step remembers when the steps before it last
 * completed, so an event that could also start the sequence over does not
 * discard the progress already made. A step that arrives later than its
 * `withinSeconds` is dropped, and the last step fires the trigger's actions.
 * Progress and fire counts are per session.
 */
export class TriggerEngine {
  private triggers: Trigger[] = [];
  readonly skipped = new Map<string, string>();
  sessionLimits: Record<string, { fires: number; lastFireMs: number }> =
    Object.create(null);
  private states = new Map<string, TriggerState>();
  /** Changes whenever progress does, so the caller can skip saving it. */
  progressVersion = 0;

  constructor(private readonly random: () => number = Math.random) {}

  setTriggers(triggers: Trigger[]): void {
    this.triggers = triggers.filter(
      (t) => t.enabled !== false && t.steps.length > 0 && t.actions.length > 0,
    );
    const next = new Map<string, TriggerState>();
    for (const trigger of this.triggers) {
      const signature = hash(JSON.stringify([trigger.steps, trigger.actions]));
      const prev = this.states.get(trigger.id);
      next.set(
        trigger.id,
        prev && prev.signature === signature
          ? prev
          : {
              signature,
              steps: trigger.steps.map(emptyStep),
              kinds: trigger.steps.map((step) => eventKinds(step.match)),
              fires: prev?.fires ?? this.sessionLimits[trigger.id]?.fires ?? 0,
              lastFireMs:
                prev?.lastFireMs ??
                this.sessionLimits[trigger.id]?.lastFireMs ??
                0,
            },
      );
    }
    this.states = next;
    this.progressVersion++;
  }

  snapshotProgress(): unknown {
    return [...this.states.entries()]
      .filter(([, s]) =>
        s.steps.some((step) => step.anchors.length > 0 || step.hits.length > 0),
      )
      .map(([id, s]) => ({
        id,
        v: 2,
        signature: s.signature,
        steps: s.steps.map((step) => ({
          anchors: step.anchors.map((a) => [
            a.at,
            Math.max(0, a.from - step.base),
          ]),
          hits: step.hits,
        })),
      }));
  }

  restoreProgress(saved: unknown, now = Date.now()): void {
    if (!Array.isArray(saved)) return;
    for (const item of saved.slice(0, 20)) {
      if (!item || typeof item !== "object" || item.v !== 2) continue;
      const state = this.states.get(item.id);
      const trigger = this.triggers.find((t) => t.id === item.id);
      if (
        !state ||
        !trigger ||
        state.signature !== item.signature ||
        !Array.isArray(item.steps) ||
        item.steps.length !== trigger.steps.length
      )
        continue;
      state.steps = trigger.steps.map((step, k) => {
        const from = item.steps[k];
        const restored = emptyStep();
        if (!from || typeof from !== "object") return restored;
        if ((step.count ?? 1) > 1) {
          const oldest = step.periodSeconds
            ? now - step.periodSeconds * 1000
            : now - MAX_RESTORE_AGE_MS;
          restored.hits = Array.isArray(from.hits)
            ? from.hits
                .filter(
                  (v: unknown) =>
                    typeof v === "number" &&
                    Number.isFinite(v) &&
                    v <= now &&
                    v >= oldest,
                )
                .slice(-MAX_HITS)
            : [];
        }
        if (k === 0 || !Array.isArray(from.anchors)) {
          if (k > 0) restored.hits = [];
          return restored;
        }
        const maxAge = step.withinSeconds
          ? step.withinSeconds * 1000
          : MAX_RESTORE_AGE_MS;
        const dropped =
          Array.isArray(from.hits) && (step.count ?? 1) > 1
            ? from.hits.length - restored.hits.length
            : 0;
        for (const anchor of from.anchors.slice(0, MAX_ANCHORS)) {
          if (!Array.isArray(anchor)) continue;
          const [at, start] = anchor;
          if (
            typeof at !== "number" ||
            !Number.isFinite(at) ||
            at > now ||
            now - at > maxAge ||
            !Number.isInteger(start) ||
            start < 0
          )
            continue;
          restored.anchors.push({
            at,
            from: Math.min(restored.hits.length, Math.max(0, start - dropped)),
          });
        }
        if (restored.anchors.length === 0) restored.hits = [];
        return restored;
      });
      this.progressVersion++;
    }
  }

  resetSession(): void {
    this.sessionLimits = Object.create(null);
    for (const state of this.states.values()) {
      state.steps = state.steps.map(emptyStep);
      state.fires = 0;
      state.lastFireMs = 0;
    }
    this.progressVersion++;
  }

  restoreSessionLimits(saved: unknown): void {
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
    for (const [id, value] of Object.entries(saved)) {
      if (
        !value ||
        !Number.isFinite(value.fires) ||
        value.fires < 0 ||
        !Number.isFinite(value.lastFireMs)
      )
        continue;
      this.sessionLimits[id] = {
        fires: value.fires,
        lastFireMs: value.lastFireMs,
      };
      const state = this.states.get(id);
      if (state) {
        state.fires = value.fires;
        state.lastFireMs = value.lastFireMs;
      }
    }
  }

  observe(event: ObservedEvent): FiredTrigger[] {
    this.skipped.clear();
    const fired: FiredTrigger[] = [];
    for (const trigger of this.triggers) {
      const state = this.states.get(trigger.id);
      if (!state) continue;
      if (!this.advance(trigger, state, event)) continue;
      if (!this.mayFire(trigger, state, event.timeMs)) continue;
      state.fires++;
      state.lastFireMs = event.timeMs;
      this.sessionLimits[trigger.id] = {
        fires: state.fires,
        lastFireMs: state.lastFireMs,
      };
      fired.push({ trigger, actions: trigger.actions, cause: event });
    }
    return fired;
  }

  /**
   * Feeds one record to a trigger; true when it completed the last step. Later
   * steps are tried first, so the progress a record makes on one step is not
   * also counted towards the next one.
   */
  private advance(
    trigger: Trigger,
    state: TriggerState,
    event: ObservedEvent,
  ): boolean {
    const last = trigger.steps.length - 1;
    const now = event.timeMs;
    let completed = false;
    for (let k = last; k >= 1 && !completed; k--) {
      const step = trigger.steps[k]!;
      const at = state.steps[k]!;
      if (at.anchors.length === 0) continue;
      if (step.withinSeconds) {
        const oldest = now - step.withinSeconds * 1000;
        if (at.anchors[0]!.at < oldest) {
          at.anchors = at.anchors.filter((a) => a.at >= oldest);
          if (at.anchors.length === 0) at.hits = [];
          this.progressVersion++;
          if (at.anchors.length === 0) continue;
        }
      }
      if (!stepMatches(step, state.kinds[k]!, event)) continue;
      this.progressVersion++;
      if ((step.count ?? 1) > 1) {
        countHit(at, step, now);
        const counted =
          at.base + at.hits.length - Math.max(at.anchors[0]!.from, at.base);
        if (counted < step.count!) continue;
        at.anchors.shift();
        if (at.anchors.length === 0) at.hits = [];
      } else {
        at.anchors = [];
      }
      if (k === last) completed = true;
      else open(state.steps[k + 1]!, trigger.steps[k + 1]!, now);
    }
    if (!completed) {
      const step = trigger.steps[0]!;
      if (!stepMatches(step, state.kinds[0]!, event)) return false;
      const first = state.steps[0]!;
      if ((step.count ?? 1) > 1) {
        this.progressVersion++;
        countHit(first, step, now);
        if (first.hits.length < step.count!) return false;
        first.hits = [];
        first.base = 0;
      }
      if (last === 0) completed = true;
      else {
        this.progressVersion++;
        open(state.steps[1]!, trigger.steps[1]!, now);
      }
    }
    if (!completed) return false;
    if (last > 0) {
      state.steps = state.steps.map(emptyStep);
      this.progressVersion++;
    }
    return true;
  }

  private mayFire(
    trigger: Trigger,
    state: TriggerState,
    nowMs: number,
  ): boolean {
    if (
      trigger.maxPerSession !== undefined &&
      state.fires >= trigger.maxPerSession
    ) {
      this.skipped.set(trigger.id, "session_clip_limit");
      return false;
    }
    if (
      trigger.cooldownSeconds &&
      state.fires > 0 &&
      nowMs - state.lastFireMs < trigger.cooldownSeconds * 1000
    ) {
      this.skipped.set(trigger.id, "cooldown");
      return false;
    }
    const sampleRate = trigger.sampleRate ?? 1;
    const accepted = sampleRate >= 1 || this.random() < sampleRate;
    if (!accepted) this.skipped.set(trigger.id, "sampled_out");
    return accepted;
  }
}

function emptyStep(): StepState {
  return { anchors: [], hits: [], base: 0 };
}

function countHit(at: StepState, step: TriggerStep, now: number): void {
  at.hits.push(now);
  let drop = Math.max(0, at.hits.length - MAX_HITS);
  if (step.periodSeconds) {
    const cutoff = now - step.periodSeconds * 1000;
    while (drop < at.hits.length && at.hits[drop]! < cutoff) drop++;
  }
  if (drop > 0) {
    at.hits.splice(0, drop);
    at.base += drop;
  }
}

/** Records that the steps before this one just completed. */
function open(at: StepState, step: TriggerStep, now: number): void {
  if ((step.count ?? 1) <= 1) {
    at.anchors = [{ at: now, from: 0 }];
    return;
  }
  const anchor = { at: now, from: at.base + at.hits.length };
  if (at.anchors.length >= MAX_ANCHORS) at.anchors[MAX_ANCHORS - 1] = anchor;
  else at.anchors.push(anchor);
}

function stepMatches(
  step: TriggerStep,
  kinds: Set<string>,
  event: ObservedEvent,
): boolean {
  if (event.sequence && !kinds.has(event.sequence)) return false;
  return matches(step.match, event.lookup);
}

function eventKinds(matcher: Matcher, into = new Set<string>()): Set<string> {
  if ("event" in matcher) into.add(matcher.event.type);
  else if ("all" in matcher) for (const m of matcher.all) eventKinds(m, into);
  else if ("any" in matcher) for (const m of matcher.any) eventKinds(m, into);
  else if ("not" in matcher) eventKinds(matcher.not, into);
  return into;
}

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length.toString(36)}.${(h >>> 0).toString(36)}`;
}
