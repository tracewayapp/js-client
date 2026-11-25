import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractionTargets } from "./interaction-targets.js";

let targets: InteractionTargets;
let now = 1000;

/** jsdom stamps an event with `Date.now()`; each one gets its own. */
function dispatch(type: string, target: EventTarget): number {
  vi.setSystemTime(++now);
  const event = new Event(type, { bubbles: true });
  target.dispatchEvent(event);
  return event.timeStamp;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  targets = new InteractionTargets();
  targets.retain();
});

afterEach(() => {
  targets.release();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("InteractionTargets", () => {
  it("names the element of an event before a handler removes it", () => {
    document.body.innerHTML = `<table><tr class="row"><td><button data-slot="delete">Delete</button></td></tr></table>`;
    const button = document.querySelector("button")!;
    button.addEventListener("click", () => button.closest("tr")!.remove());
    const time = dispatch("click", button);
    expect(button.isConnected).toBe(false);
    // The browser's entry for an element that has left the page has no target.
    expect(targets.of({ target: null, startTime: time })).toBe(
      'tr.row>td>button[data-slot="delete"]',
    );
    expect(targets.of({ target: null, startTime: time + 1 })).toBeUndefined();
  });

  it("prefers the entry's own target while it is in the page", () => {
    document.body.innerHTML = `<button data-testid="save">Save</button><a class="nav">Home</a>`;
    const time = dispatch("keydown", document.querySelector("button")!);
    expect(
      targets.of({ target: document.querySelector("a"), startTime: time }),
    ).toBe("a.nav");
  });

  it("keeps the first element named at a time, and only the latest 64 events", () => {
    document.body.innerHTML = `<button data-testid="first">1</button><button data-testid="second">2</button>`;
    const [first, second] = document.querySelectorAll("button");
    const time = dispatch("pointerdown", first!);
    second!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(targets.of({ startTime: time })).toBe('button[data-testid="first"]');
    const later = [];
    for (let i = 0; i < 64; i++) later.push(dispatch("keyup", second!));
    expect(targets.of({ startTime: time })).toBeUndefined();
    expect(targets.of({ startTime: later[0]! })).toBe(
      'button[data-testid="second"]',
    );
  });

  it("listens while anything retains it", () => {
    document.body.innerHTML = `<button data-testid="go">Go</button>`;
    const button = document.querySelector("button")!;
    targets.retain();
    targets.release();
    const named = dispatch("pointerup", button);
    expect(targets.of({ startTime: named })).toBe('button[data-testid="go"]');
    targets.release();
    expect(targets.of({ startTime: named })).toBeUndefined();
    expect(
      targets.of({ startTime: dispatch("click", button) }),
    ).toBeUndefined();
    targets.retain();
  });
});
