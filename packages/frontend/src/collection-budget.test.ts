import { afterEach, expect, it } from "vitest";
import { CollectionBudget } from "./collection-budget.js";
afterEach(() => sessionStorage.clear());
it("persists shared byte and event limits across reloads and resets for a new session", () => {
  const first = new CollectionBudget("project", {
    maxBytes: 100,
    maxEvents: 3,
  });
  expect(first.admit("session-a", 60, 2)).toBe(true);
  const nextPage = new CollectionBudget("project", {
    maxBytes: 100,
    maxEvents: 3,
  });
  expect(nextPage.admit("session-a", 41)).toBe(false);
  expect(nextPage.admit("session-a", 40)).toBe(true);
  expect(nextPage.admit("session-a", 1)).toBe(false);
  expect(nextPage.admit("session-b", 100)).toBe(true);
});
it("ignores corrupt persisted counters and respects project isolation", () => {
  sessionStorage.setItem(
    "traceway:budget:a",
    JSON.stringify({ sessionId: "s", bytes: -1000, events: -10 }),
  );
  expect(new CollectionBudget("a", { maxBytes: 10 }).admit("s", 11)).toBe(
    false,
  );
  expect(new CollectionBudget("b", { maxBytes: 10 }).admit("s", 10)).toBe(true);
});
