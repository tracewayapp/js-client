import type { Trigger, TriggerAction } from "../settings/types.js";
import type { FieldLookup } from "./matcher.js";
import { matches } from "./matcher.js";

export interface ObservedEvent {
  timeMs: number;
  lookup: FieldLookup;
}

export interface FiredTrigger {
  trigger: Trigger;
  actions: TriggerAction[];
  /** The event that completed the trigger, e.g. the exception a clip belongs to. */
  cause: ObservedEvent;
}

interface TriggerState {
  signature: string;
  step: number;
  lastStepMs: number;
  /** Times of the records counted towards the current step, when it needs more than one. */
  hits: number[];
  fires: number;
  lastFireMs: number;
}

/**
 * Runs the server-defined triggers against every event on the device. A
 * trigger is a sequence of steps; each matching event advances it, a step
 * that arrives later than its `withinSeconds` starts it over, and the last
 * step fires the trigger's actions. Progress and fire counts are per session.
 */
export class TriggerEngine {
  private triggers: Trigger[] = [];
  private states = new Map<string, TriggerState>();

  constructor(private readonly random: () => number = Math.random) {}

  setTriggers(triggers: Trigger[]): void {
    this.triggers = triggers.filter((t) => t.enabled !== false && t.steps.length > 0 && t.actions.length > 0);
    const next = new Map<string, TriggerState>();
    for (const trigger of this.triggers) {
      const signature = JSON.stringify(trigger.steps);
      const prev = this.states.get(trigger.id);
      next.set(
        trigger.id,
        prev && prev.signature === signature
          ? prev
          : { signature, step: 0, lastStepMs: 0, hits: [], fires: prev?.fires ?? 0, lastFireMs: prev?.lastFireMs ?? 0 },
      );
    }
    this.states = next;
  }

  resetSession(): void {
    for (const state of this.states.values()) {
      state.step = 0;
      state.lastStepMs = 0;
      state.hits = [];
      state.fires = 0;
      state.lastFireMs = 0;
    }
  }

  observe(event: ObservedEvent): FiredTrigger[] {
    const fired: FiredTrigger[] = [];
    for (const trigger of this.triggers) {
      const state = this.states.get(trigger.id);
      if (!state) continue;
      if (state.step > 0) {
        const within = trigger.steps[state.step]!.withinSeconds;
        if (within && event.timeMs - state.lastStepMs > within * 1000) restart(state);
      }
      if (!this.advance(trigger, state, event)) continue;
      if (!this.mayFire(trigger, state, event.timeMs)) continue;
      state.fires++;
      state.lastFireMs = event.timeMs;
      fired.push({ trigger, actions: trigger.actions, cause: event });
    }
    return fired;
  }

  /** Feeds one record to a trigger; true when it completed the last step. */
  private advance(trigger: Trigger, state: TriggerState, event: ObservedEvent): boolean {
    if (!matches(trigger.steps[state.step]!.match, event.lookup)) {
      if (state.step === 0 || !matches(trigger.steps[0]!.match, event.lookup)) return false;
      restart(state);
    }
    const step = trigger.steps[state.step]!;
    const needed = step.count ?? 1;
    if (needed > 1) {
      state.hits.push(event.timeMs);
      if (step.periodSeconds) {
        const cutoff = event.timeMs - step.periodSeconds * 1000;
        state.hits = state.hits.filter((t) => t >= cutoff);
      }
      if (state.hits.length < needed) return false;
    }
    state.hits = [];
    state.step++;
    state.lastStepMs = event.timeMs;
    if (state.step < trigger.steps.length) return false;
    state.step = 0;
    return true;
  }

  private mayFire(trigger: Trigger, state: TriggerState, nowMs: number): boolean {
    if (trigger.maxPerSession !== undefined && state.fires >= trigger.maxPerSession) return false;
    if (trigger.cooldownSeconds && state.fires > 0 && nowMs - state.lastFireMs < trigger.cooldownSeconds * 1000) {
      return false;
    }
    const sampleRate = trigger.sampleRate ?? 1;
    return sampleRate >= 1 || this.random() < sampleRate;
  }
}

function restart(state: TriggerState): void {
  state.step = 0;
  state.hits = [];
}
