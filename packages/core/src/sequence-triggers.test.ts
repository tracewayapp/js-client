import { describe, it, expect } from "vitest";
import { TriggerEngine } from "./triggers/engine.js";
import { parseMatcher } from "./settings/merge.js";
import { matches } from "./triggers/matcher.js";
import type { Trigger } from "./settings/types.js";
const trigger: Trigger = {
  id: "journey",
  steps: [
    { match: { event: { type: "click", value: "#users .open" } } },
    {
      match: { event: { type: "navigation", value: "/users/{id}" } },
      withinSeconds: 10,
    },
    { match: { event: { type: "log", value: "loaded" } }, withinSeconds: 5 },
  ],
  actions: [{ type: "capture", replay: true, durationSeconds: 30 }],
  maxPerSession: 1,
};
const event = (timeMs: number, fields: Record<string, unknown>) => ({
  timeMs,
  lookup: (key: string) => fields[key],
});
describe("browser event sequences", () => {
  it("restores a click across navigation, fires once, and ignores unrelated logs", () => {
    const first = new TriggerEngine();
    first.setTriggers([trigger]);
    first.observe(
      event(1000, {
        "browser.action": "click",
        "browser.target.matches": (s: string) => s === "#users .open",
      }),
    );
    const next = new TriggerEngine();
    next.setTriggers([trigger]);
    next.restoreProgress(first.snapshotProgress(), 2000);
    expect(
      next.observe(
        event(2000, {
          "event.name": "browser.navigation",
          "attributes.url.full": "https://app.test/users/42?secret=hidden",
        }),
      ),
    ).toHaveLength(0);
    expect(
      next.observe(
        event(2100, { "event.name": "browser.console", body: "other" }),
      ),
    ).toHaveLength(0);
    expect(
      next.observe(
        event(2200, { "event.name": "browser.console", body: "loaded" }),
      ),
    ).toHaveLength(1);
    expect(
      next.observe(
        event(2300, { "event.name": "browser.console", body: "loaded" }),
      ),
    ).toHaveLength(0);
  });
  it("rejects expired and changed-rule progress", () => {
    const engine = new TriggerEngine();
    engine.setTriggers([trigger]);
    engine.observe(
      event(1000, {
        "browser.action": "click",
        "browser.target.matches": () => true,
      }),
    );
    for (const [rule, now] of [
      [trigger, 12000],
      [
        { ...trigger, actions: [{ type: "startReplay", durationSeconds: 10 }] },
        2000,
      ],
    ] as const) {
      const restored = new TriggerEngine();
      restored.setTriggers([rule as Trigger]);
      restored.restoreProgress(engine.snapshotProgress(), now);
      restored.observe(
        event(now, {
          "event.name": "browser.navigation",
          "attributes.url.full": "/users/42",
        }),
      );
      expect(
        restored.observe(
          event(now + 1, { "event.name": "browser.console", body: "loaded" }),
        ),
      ).toHaveLength(0);
    }
  });
  it("matches exactly one route segment and preserves case", () => {
    const m = { event: { type: "navigation" as const, value: "/users/{id}" } };
    for (const [url, expected] of [
      ["/users/42", true],
      ["/users/42/edit", false],
      ["/Users/42", false],
      ["/users/", false],
    ] as const)
      expect(
        matches(m, (k) => (k === "event.name" ? "browser.navigation" : url)),
      ).toBe(expected);
  });
  it("validates bounded event matchers and distinguishes exact and contains logs", () => {
    expect(
      parseMatcher({ event: { type: "hover", value: "#menu" } }),
    ).not.toBeNull();
    expect(
      parseMatcher({ event: { type: "click", value: ":has(*)" } }),
    ).toBeNull();
    expect(parseMatcher({ event: { type: "unknown", value: "x" } })).toBeNull();
    const lookup = (k: string) =>
      k === "event.name" ? "browser.console" : "some loaded message";
    expect(matches({ event: { type: "log", value: "loaded" } }, lookup)).toBe(
      false,
    );
    expect(
      matches(
        { event: { type: "log", value: "loaded", mode: "contains" } },
        lookup,
      ),
    ).toBe(true);
  });
});
