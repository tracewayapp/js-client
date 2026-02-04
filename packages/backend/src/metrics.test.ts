import { describe, it, expect } from "vitest";
import { collectMetrics, resetCpuTracking } from "./metrics.js";

describe("collectMetrics", () => {
  it("should return mem.used and mem.total on first call", () => {
    resetCpuTracking();
    const metrics = collectMetrics();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("mem.used");
    expect(names).toContain("mem.total");
  });

  it("should not return cpu.used_pcnt on first call (no baseline)", () => {
    resetCpuTracking();
    const metrics = collectMetrics();
    const names = metrics.map((m) => m.name);
    expect(names).not.toContain("cpu.used_pcnt");
  });

  it("should return cpu.used_pcnt on second call (with baseline)", async () => {
    resetCpuTracking();
    collectMetrics();
    await new Promise((r) => setTimeout(r, 10));
    const metrics = collectMetrics();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("cpu.used_pcnt");
  });

  it("should return positive values", () => {
    resetCpuTracking();
    const metrics = collectMetrics();
    for (const m of metrics) {
      expect(m.value).toBeGreaterThanOrEqual(0);
    }
  });

  it("should include recordedAt as ISO string", () => {
    resetCpuTracking();
    const metrics = collectMetrics();
    for (const m of metrics) {
      expect(() => new Date(m.recordedAt)).not.toThrow();
    }
  });

  it("should return memory values in MB", () => {
    resetCpuTracking();
    const metrics = collectMetrics();
    const memUsed = metrics.find((m) => m.name === "mem.used");
    const memTotal = metrics.find((m) => m.name === "mem.total");
    expect(memUsed).toBeDefined();
    expect(memTotal).toBeDefined();
    expect(memUsed!.value).toBeLessThan(memTotal!.value);
    expect(memTotal!.value).toBeGreaterThan(100);
  });

  it("should return cpu percentage between 0 and 100", async () => {
    resetCpuTracking();
    collectMetrics();
    await new Promise((r) => setTimeout(r, 10));
    const metrics = collectMetrics();
    const cpu = metrics.find((m) => m.name === "cpu.used_pcnt");
    expect(cpu).toBeDefined();
    expect(cpu!.value).toBeGreaterThanOrEqual(0);
    expect(cpu!.value).toBeLessThanOrEqual(100);
  });
});
