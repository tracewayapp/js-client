import { describe, expect, it } from "vitest";
import { matches, satisfiesVersion } from "./triggers/matcher.js";
import { TriggerEngine } from "./triggers/engine.js";
import { RingBuffer } from "./buffer/ring-buffer.js";
import type { Trigger } from "./settings/types.js";

const fields = (values: Record<string, unknown>) => (key: string) => values[key];

describe("matcher", () => {
  it("evaluates conditions and combinators", () => {
    const lookup = fields({ "event.name": "exception", "attributes.status": "503", "resource.service.version": "2.4.1" });
    expect(matches({ key: "event.name", op: "eq", value: "exception" }, lookup)).toBe(true);
    expect(matches({ key: "attributes.status", op: "gte", value: 500 }, lookup)).toBe(true);
    expect(matches({ key: "attributes.status", op: "in", values: [502, 503] }, lookup)).toBe(true);
    expect(matches({ key: "missing", op: "not_exists" }, lookup)).toBe(true);
    expect(matches({ key: "resource.service.version", op: "version", value: ">=2.4 <3" }, lookup)).toBe(true);
    expect(matches({ all: [{ key: "event.name", op: "eq", value: "exception" }, { not: { key: "attributes.status", op: "eq", value: 503 } }] }, lookup)).toBe(false);
    expect(matches({ any: [{ key: "missing", op: "exists" }, { key: "event.name", op: "contains", value: "cept" }] }, lookup)).toBe(true);
  });

  it("compares versions numerically, including four-part browser versions", () => {
    expect(satisfiesVersion("120.0.6099.109", ">=120")).toBe(true);
    expect(satisfiesVersion("1.10.0", ">1.9.9")).toBe(true);
    expect(satisfiesVersion("2.0.0", "<2")).toBe(false);
    expect(satisfiesVersion("garbage", ">=1")).toBe(false);
  });
});

function failedRequests(overrides: Partial<Trigger> = {}): Trigger {
  const step = { match: { key: "status", op: "gte" as const, value: 500 }, withinSeconds: 60 };
  return {
    id: "failed-requests",
    steps: [step, step, step],
    actions: [{ type: "flush", lookbackSeconds: 120, signals: ["*"] }],
    ...overrides,
  };
}

describe("TriggerEngine", () => {
  it("fires a multi-step trigger only when every step arrives in time", () => {
    const engine = new TriggerEngine();
    engine.setTriggers([failedRequests()]);
    const at = (timeMs: number, status: number) => engine.observe({ timeMs, lookup: fields({ status }) });

    expect(at(0, 500)).toHaveLength(0);
    expect(at(10_000, 200)).toHaveLength(0);
    expect(at(20_000, 502)).toHaveLength(0);
    const fired = at(30_000, 503);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.trigger.id).toBe("failed-requests");

    expect(at(100_000, 500)).toHaveLength(0);
    expect(at(200_000, 500)).toHaveLength(0);
    expect(at(210_000, 500)).toHaveLength(0);
    expect(at(220_000, 500)).toHaveLength(1);
  });

  it("applies cooldown, per-session cap and sampling", () => {
    const single = (o: Partial<Trigger>): Trigger => ({ ...failedRequests(o), steps: [failedRequests().steps[0]!] });
    const engine = new TriggerEngine(() => 0.9);
    engine.setTriggers([single({ id: "a", cooldownSeconds: 30, maxPerSession: 2 }), single({ id: "b", sampleRate: 0.5 })]);
    const fire = (timeMs: number) => engine.observe({ timeMs, lookup: fields({ status: 500 }) }).map((f) => f.trigger.id);

    expect(fire(0)).toEqual(["a"]);
    expect(fire(10_000)).toEqual([]);
    expect(fire(40_000)).toEqual(["a"]);
    expect(fire(80_000)).toEqual([]);
    engine.resetSession();
    expect(fire(90_000)).toEqual(["a"]);
  });

  it("skips disabled triggers", () => {
    const engine = new TriggerEngine();
    engine.setTriggers([{ ...failedRequests(), steps: [failedRequests().steps[0]!], enabled: false }]);
    expect(engine.observe({ timeMs: 0, lookup: fields({ status: 500 }) })).toEqual([]);
  });
});

describe("RingBuffer", () => {
  it("evicts by bytes and age and takes by window and signal", () => {
    let now = 0;
    const buffer = new RingBuffer<string>({ maxBytes: 30, maxAgeMs: 1_000, now: () => now });
    buffer.push({ timeMs: 0, signal: "console", bytes: 10, item: "a" });
    buffer.push({ timeMs: 100, signal: "network", bytes: 10, item: "b" });
    buffer.push({ timeMs: 200, signal: "console", bytes: 10, item: "c" });
    buffer.push({ timeMs: 300, signal: "console", bytes: 10, item: "d" });
    expect(buffer.size).toBe(3);
    expect(buffer.evictedCount).toBe(1);

    const consoleOnly = buffer.take(150, new Set(["console"]));
    expect(consoleOnly.map((e) => e.item)).toEqual(["c", "d"]);
    expect(buffer.bytes).toBe(10);

    now = 1_200;
    buffer.push({ timeMs: 1_150, signal: "console", bytes: 10, item: "e" });
    expect(buffer.take(0, "*").map((e) => e.item)).toEqual(["e"]);
  });
});
