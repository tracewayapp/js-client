import { describe, expect, it } from "vitest";
import { applyOverlay } from "./settings/merge.js";
import { defaultSettings } from "./settings/defaults.js";
import { globMatch, matches } from "./triggers/matcher.js";
import { TriggerEngine } from "./triggers/engine.js";
import type { Trigger } from "./settings/types.js";

const fields = (values: Record<string, unknown>) => (key: string) => values[key];

describe("log-line operators", () => {
  it("glob matches wildcards case-insensitively", () => {
    expect(globMatch("Payment FAILED for order 1042", "payment failed*")).toBe(true);
    expect(globMatch("payment failed for order 1042", "*order ????")).toBe(true);
    expect(globMatch("payment failed for order 1042", "*order ???")).toBe(false);
    expect(globMatch("abc", "a*b*c*")).toBe(true);
    expect(globMatch("abc", "a*d")).toBe(false);
    expect(globMatch("", "*")).toBe(true);
  });

  it("stays fast on inputs that make backtracking regexes explode", () => {
    const line = "a".repeat(10_000);
    const started = performance.now();
    expect(globMatch(line, "*a*a*a*a*a*a*a*b")).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("icontains, starts_with and glob read the log body", () => {
    const lookup = fields({ body: "WARN: Payment provider timeout after 30s", "event.name": "browser.console" });
    expect(matches({ key: "body", op: "icontains", value: "provider TIMEOUT" }, lookup)).toBe(true);
    expect(matches({ key: "body", op: "starts_with", value: "WARN:" }, lookup)).toBe(true);
    expect(matches({ key: "body", op: "glob", value: "*timeout after *s" }, lookup)).toBe(true);
    expect(matches({ key: "body", op: "contains", value: "TIMEOUT" }, lookup)).toBe(false);
  });
});

describe("counted steps", () => {
  const errorLines = (count: number, periodSeconds?: number): Trigger => ({
    id: "error-burst",
    steps: [{ match: { key: "body", op: "icontains", value: "payment failed" }, count, periodSeconds: periodSeconds ?? null }],
    actions: [{ type: "capture", durationSeconds: 1800, lookbackSeconds: 120 }],
  });

  it("fires after N matching lines within the period", () => {
    const engine = new TriggerEngine();
    engine.setTriggers([errorLines(3, 60)]);
    const line = (timeMs: number, body = "payment failed for order 7") => engine.observe({ timeMs, lookup: fields({ body }) });
    expect(line(0)).toHaveLength(0);
    expect(line(10_000, "unrelated")).toHaveLength(0);
    expect(line(20_000)).toHaveLength(0);
    expect(line(70_000)).toHaveLength(0);
    expect(line(75_000)).toHaveLength(1);
  });

  it("without a period counts every match", () => {
    const engine = new TriggerEngine();
    engine.setTriggers([errorLines(2)]);
    expect(engine.observe({ timeMs: 0, lookup: fields({ body: "Payment failed" }) })).toHaveLength(0);
    expect(engine.observe({ timeMs: 9_000_000, lookup: fields({ body: "payment FAILED" }) })).toHaveLength(1);
  });
});

describe("capture action", () => {
  it("parses from a remote document with its defaults", () => {
    const settings = applyOverlay(defaultSettings(), {
      triggers: [
        {
          id: "log-capture",
          steps: [{ match: { key: "body", op: "glob", value: "*payment failed*" }, count: 5, periodSeconds: 60 }],
          actions: [{ type: "capture", durationSeconds: 1800, lookbackSeconds: 120, replay: true }],
        },
        { id: "bad-capture", steps: [{ match: { key: "body", op: "exists" } }], actions: [{ type: "capture" }] },
      ],
    });
    const trigger = settings.triggers.find((t) => t.id === "log-capture")!;
    expect(trigger.steps[0]).toMatchObject({ count: 5, periodSeconds: 60 });
    expect(trigger.actions[0]).toEqual({ type: "capture", durationSeconds: 1800, lookbackSeconds: 120, replay: true, signals: undefined });
    expect(settings.triggers.find((t) => t.id === "bad-capture")).toBeUndefined();
  });
});
