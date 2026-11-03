import { describe, expect, it } from "vitest";
import { ErrorLimiter } from "./error-limiter.js";

describe("error protection", () => {
  it("keeps the first occurrence, suppresses duplicates and reports the suppressed count", () => {
    let now = 0;
    const limiter = new ErrorLimiter({}, () => now);
    expect(limiter.accept("same stack")).toBe(0);
    for (let i = 0; i < 100; i++)
      expect(limiter.accept("same stack")).toBeNull();
    now = 1000;
    expect(limiter.accept("same stack")).toBe(100);
    expect(limiter.accept("different stack")).toBe(0);
  });

  it("bounds a burst of distinct errors and recovers after a rolling minute", () => {
    let now = 10_000;
    const limiter = new ErrorLimiter({}, () => now);
    for (let i = 0; i < 60; i++) expect(limiter.accept(`stack-${i}`)).toBe(0);
    for (let i = 0; i < 1000; i++)
      expect(limiter.accept(`new-${i}`)).toBeNull();
    now += 59_999;
    expect(limiter.accept("still limited")).toBeNull();
    now++;
    expect(limiter.accept("recovered")).toBe(1001);
  });

  it("supports disabling only duplicate suppression while keeping the burst ceiling", () => {
    const limiter = new ErrorLimiter(
      { duplicateWindowMs: 0, maxPerMinute: 2 },
      () => 0,
    );
    expect(limiter.accept("same")).toBe(0);
    expect(limiter.accept("same")).toBe(0);
    expect(limiter.accept("same")).toBeNull();
  });
});
