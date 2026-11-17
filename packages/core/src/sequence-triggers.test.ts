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

describe("overlapping sequences", () => {
  const named = (name: string) => ({
    key: "event.name",
    op: "eq" as const,
    value: name,
  });
  const run = (steps: Trigger["steps"], events: Array<[number, string]>) => {
    const engine = new TriggerEngine();
    engine.setTriggers([
      { id: "t", steps, actions: [{ type: "emit", eventName: "x" }] },
    ]);
    return events.map(
      ([timeMs, name]) =>
        engine.observe(event(timeMs, { "event.name": name })).length,
    );
  };
  it("keeps progress when the first step happens again", () => {
    expect(
      run(
        [{ match: named("a") }, { match: named("b") }, { match: named("c") }],
        [
          [1, "a"],
          [2, "b"],
          [3, "a"],
          [4, "c"],
        ],
      ),
    ).toEqual([0, 0, 0, 1]);
  });
  it("fires an action after an error storm that keeps going", () => {
    expect(
      run(
        [
          { match: named("err"), count: 3, periodSeconds: 10 },
          { match: named("retry"), withinSeconds: 5 },
        ],
        [
          [0, "err"],
          [100, "err"],
          [200, "err"],
          [300, "err"],
          [400, "retry"],
        ],
      ),
    ).toEqual([0, 0, 0, 0, 1]);
  });
  it("measures a timeout from the latest earlier step", () => {
    const steps = [{ match: named("a") }, { match: named("b"), withinSeconds: 5 }];
    expect(
      run(steps, [
        [0, "a"],
        [4000, "a"],
        [8000, "b"],
      ]),
    ).toEqual([0, 0, 1]);
    expect(
      run(steps, [
        [0, "a"],
        [6000, "b"],
      ]),
    ).toEqual([0, 0]);
  });
  it("counts a later step only from the moment the earlier one completed", () => {
    const steps = [
      { match: named("a") },
      { match: named("b"), count: 2, withinSeconds: 10 },
    ];
    expect(
      run(steps, [
        [0, "b"],
        [1, "a"],
        [2, "b"],
        [3, "a"],
        [3, "b"],
      ]),
    ).toEqual([0, 0, 0, 0, 1]);
  });
  it("does not let one event complete two steps", () => {
    expect(
      run(
        [{ match: named("a") }, { match: named("a") }],
        [
          [0, "a"],
          [0, "a"],
          [0, "a"],
          [0, "a"],
        ],
      ),
    ).toEqual([0, 1, 0, 1]);
  });
  it("carries a count on the first step across pages", () => {
    const counted: Trigger = {
      id: "burst",
      steps: [{ match: named("err"), count: 3, periodSeconds: 60 }],
      actions: [{ type: "emit", eventName: "x" }],
    };
    const first = new TriggerEngine();
    first.setTriggers([counted]);
    first.observe(event(1000, { "event.name": "err" }));
    first.observe(event(2000, { "event.name": "err" }));
    const next = new TriggerEngine();
    next.setTriggers([counted]);
    next.restoreProgress(
      JSON.parse(JSON.stringify(first.snapshotProgress())),
      3000,
    );
    expect(next.observe(event(3000, { "event.name": "err" }))).toHaveLength(1);
  });
  it("keeps a step without a timeout for as long as the session", () => {
    const open: Trigger = {
      id: "open",
      steps: [{ match: named("a") }, { match: named("b") }],
      actions: [{ type: "emit", eventName: "x" }],
    };
    const first = new TriggerEngine();
    first.setTriggers([open]);
    first.observe(event(0, { "event.name": "a" }));
    const next = new TriggerEngine();
    next.setTriggers([open]);
    next.restoreProgress(first.snapshotProgress(), 3_600_000);
    expect(next.observe(event(3_600_000, { "event.name": "b" }))).toHaveLength(
      1,
    );
  });
  it("matches a click only against steps that name a click", () => {
    const engine = new TriggerEngine();
    engine.setTriggers([
      {
        id: "negated",
        steps: [{ match: { not: named("exception") } }],
        actions: [{ type: "emit", eventName: "x" }],
      },
      {
        id: "pro-click",
        steps: [
          {
            match: {
              all: [
                { event: { type: "click", value: "#buy" } },
                { key: "global.plan", op: "eq", value: "pro" },
              ],
            },
          },
        ],
        actions: [{ type: "emit", eventName: "x" }],
      },
    ]);
    const fired = engine.observe({
      ...event(0, {
        "browser.action": "click",
        "browser.target.matches": () => true,
        "global.plan": "pro",
      }),
      sequence: "click",
    });
    expect(fired.map((f) => f.trigger.id)).toEqual(["pro-click"]);
  });
  it("only reports a change of progress when there is one", () => {
    const engine = new TriggerEngine();
    engine.setTriggers([
      {
        id: "t",
        steps: [{ match: named("a") }, { match: named("b") }],
        actions: [{ type: "emit", eventName: "x" }],
      },
    ]);
    const before = engine.progressVersion;
    engine.observe(event(0, { "event.name": "other" }));
    expect(engine.progressVersion).toBe(before);
    engine.observe(event(1, { "event.name": "a" }));
    expect(engine.progressVersion).not.toBe(before);
  });
});
