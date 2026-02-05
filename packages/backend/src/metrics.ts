import * as os from "os";
import { METRIC_MEM_USED, METRIC_MEM_TOTAL, METRIC_CPU_USED_PCNT } from "@tracewayapp/core";
import type { MetricRecord } from "@tracewayapp/core";
import { nowISO } from "@tracewayapp/core";

let prevCpuUsage: NodeJS.CpuUsage | null = null;
let prevCpuTime: number | null = null;

export function collectMetrics(): MetricRecord[] {
  const metrics: MetricRecord[] = [];
  const recordedAt = nowISO();

  const mem = process.memoryUsage();
  metrics.push({
    name: METRIC_MEM_USED,
    value: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    recordedAt,
  });

  const totalMem = os.totalmem();
  metrics.push({
    name: METRIC_MEM_TOTAL,
    value: Math.round((totalMem / 1024 / 1024) * 100) / 100,
    recordedAt,
  });

  const currentCpuUsage = process.cpuUsage();
  const currentTime = Date.now();
  if (prevCpuUsage !== null && prevCpuTime !== null) {
    const elapsedMs = currentTime - prevCpuTime;
    if (elapsedMs > 0) {
      const userDelta = currentCpuUsage.user - prevCpuUsage.user;
      const systemDelta = currentCpuUsage.system - prevCpuUsage.system;
      const totalDeltaMs = (userDelta + systemDelta) / 1000;
      const cpuCount = os.cpus().length || 1;
      const cpuPercent = (totalDeltaMs / elapsedMs / cpuCount) * 100;
      metrics.push({
        name: METRIC_CPU_USED_PCNT,
        value: Math.round(cpuPercent * 100) / 100,
        recordedAt,
      });
    }
  }
  prevCpuUsage = currentCpuUsage;
  prevCpuTime = currentTime;

  return metrics;
}

export function resetCpuTracking(): void {
  prevCpuUsage = null;
  prevCpuTime = null;
}
