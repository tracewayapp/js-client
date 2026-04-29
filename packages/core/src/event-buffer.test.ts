import { describe, it, expect } from "vitest";
import { EventBuffer } from "./event-buffer.js";
import type { LogEvent } from "./types.js";

function log(message: string, offsetMs = 0): LogEvent {
  return {
    type: "log",
    level: "info",
    message,
    timestamp: new Date(Date.now() + offsetMs).toISOString(),
  };
}

describe("EventBuffer", () => {
  it("starts empty", () => {
    const buf = new EventBuffer<LogEvent>();
    expect(buf.length).toBe(0);
    expect(buf.snapshot()).toEqual([]);
  });

  it("preserves insertion order", () => {
    const buf = new EventBuffer<LogEvent>();
    buf.add(log("a", -3000));
    buf.add(log("b", -2000));
    buf.add(log("c", -1000));
    expect(buf.snapshot().map((e) => e.message)).toEqual(["a", "b", "c"]);
  });

  it("drops events older than the time window", () => {
    const buf = new EventBuffer<LogEvent>({ windowMs: 10_000 });
    buf.add(log("old", -30_000));
    buf.add(log("stale", -11_000));
    buf.add(log("fresh", -2_000));
    expect(buf.snapshot().map((e) => e.message)).toEqual(["fresh"]);
  });

  it("enforces hard size cap even within the window", () => {
    const buf = new EventBuffer<LogEvent>({
      windowMs: 60 * 60 * 1000,
      maxSize: 3,
    });
    for (let i = 0; i < 6; i++) buf.add(log(`m${i}`, -100 + i));
    expect(buf.snapshot().map((e) => e.message)).toEqual(["m3", "m4", "m5"]);
  });

  it("snapshot returns a copy", () => {
    const buf = new EventBuffer<LogEvent>();
    buf.add(log("a"));
    const snap = buf.snapshot();
    snap.push(log("b"));
    expect(buf.length).toBe(1);
  });

  it("clear empties the buffer", () => {
    const buf = new EventBuffer<LogEvent>();
    buf.add(log("a"));
    buf.add(log("b"));
    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.snapshot()).toEqual([]);
  });
});
