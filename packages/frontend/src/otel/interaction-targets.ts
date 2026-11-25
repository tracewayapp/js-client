import { selectorOf } from "./selector.js";

/** The events the browser groups into interactions. */
const INPUT_EVENTS = ["pointerdown", "pointerup", "click", "keydown", "keyup"];
/** Named events kept for their entries, which arrive a frame or a few later (more while the page is blocked). */
const NAMED_KEPT = 64;

/**
 * Names the element of each input event while the event is dispatched, before a handler can remove it. The
 * browser's `event` entry arrives after the next paint; by then a deleted row, the item of a menu that closed or the
 * form of a view that was left is no longer in the page, and the entry's `target` is null. An entry's `startTime`
 * is its event's `timeStamp`, which pairs the two.
 */
export class InteractionTargets {
  private readonly names = new Map<number, string>();
  private users = 0;

  private readonly name = (event: Event): void => {
    if (this.names.has(event.timeStamp)) return;
    const target = selectorOf(event.target);
    if (!target) return;
    this.names.set(event.timeStamp, target);
    if (this.names.size > NAMED_KEPT)
      this.names.delete(this.names.keys().next().value!);
  };

  /** Listens while anything that measures interactions is running. */
  retain(): void {
    if (this.users++ || typeof addEventListener !== "function") return;
    for (const type of INPUT_EVENTS)
      addEventListener(type, this.name, { capture: true, passive: true });
  }

  release(): void {
    if (!this.users || --this.users || typeof removeEventListener !== "function")
      return;
    for (const type of INPUT_EVENTS)
      removeEventListener(type, this.name, { capture: true });
    this.names.clear();
  }

  /** The element of an `event` entry: its target, or the one named when its event was dispatched. */
  of(entry: { target?: unknown; startTime: number }): string | undefined {
    return selectorOf(entry.target) ?? this.names.get(entry.startTime);
  }
}

/** One for the page: per-view vitals and the web vitals instrumentation share the listeners. */
export const interactionTargets = new InteractionTargets();
