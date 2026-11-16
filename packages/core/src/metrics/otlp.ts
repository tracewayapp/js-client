import type { MetricBatch, MetricDims } from "./aggregator.js";
import { HISTOGRAM_SCALE, type Histogram } from "./histogram.js";

export type MetricResource = Record<string, string | number | boolean>;

/** OTLP AggregationTemporality.DELTA: each payload is "since my last flush". */
const DELTA = 1;

type AnyValue =
  { stringValue: string } | { boolValue: boolean } | { doubleValue: number };

function anyValue(value: string | number | boolean): AnyValue {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return { doubleValue: value };
}

function keyValues(attrs: MetricResource | MetricDims) {
  return Object.keys(attrs).map((key) => ({
    key,
    value: anyValue(attrs[key]!),
  }));
}

function nanos(ms: number): string {
  return `${Math.max(0, Math.floor(ms))}000000`;
}

function positiveBuckets(histogram: Histogram) {
  if (!histogram.buckets.size) return undefined;
  let low = Infinity;
  let high = -Infinity;
  for (const index of histogram.buckets.keys()) {
    if (index < low) low = index;
    if (index > high) high = index;
  }
  const bucketCounts = new Array<number>(high - low + 1).fill(0);
  for (const [index, count] of histogram.buckets)
    bucketCounts[index - low] = count;
  return { offset: low, bucketCounts };
}

/**
 * Renders a batch as an OTLP/HTTP JSON `ExportMetricsServiceRequest`. Written by hand: `@opentelemetry/sdk-metrics`
 * would cost more bytes in the bundle than the whole SDK is allowed.
 */
export function encodeMetrics(
  batch: MetricBatch,
  resource: MetricResource,
  scope: { name: string; version: string },
): Record<string, unknown> {
  const startTimeUnixNano = nanos(batch.startMs);
  const timeUnixNano = nanos(batch.endMs);
  const metrics = new Map<string, Record<string, any>>();

  for (const point of batch.histograms) {
    let metric = metrics.get(point.name);
    if (!metric) {
      metric = {
        name: point.name,
        unit: point.unit,
        exponentialHistogram: { aggregationTemporality: DELTA, dataPoints: [] },
      };
      metrics.set(point.name, metric);
    }
    const h = point.histogram;
    const dataPoint: Record<string, unknown> = {
      attributes: keyValues(point.dims),
      startTimeUnixNano,
      timeUnixNano,
      count: h.count,
      sum: h.sum,
      scale: HISTOGRAM_SCALE,
      zeroCount: h.zeroCount,
      min: h.min,
      max: h.max,
    };
    const positive = positiveBuckets(h);
    if (positive) dataPoint.positive = positive;
    if (point.exemplars.length) {
      dataPoint.exemplars = point.exemplars.map((e) => ({
        timeUnixNano: nanos(e.timeMs),
        asDouble: e.value,
        filteredAttributes: keyValues(
          e.target
            ? { "session.id": e.sessionId, "traceway.target": e.target }
            : { "session.id": e.sessionId },
        ),
      }));
    }
    metric.exponentialHistogram.dataPoints.push(dataPoint);
  }

  for (const point of batch.sums) {
    const key = `sum:${point.name}`;
    let metric = metrics.get(key);
    if (!metric) {
      metric = {
        name: point.name,
        sum: {
          aggregationTemporality: DELTA,
          isMonotonic: true,
          dataPoints: [],
        },
      };
      metrics.set(key, metric);
    }
    metric.sum.dataPoints.push({
      attributes: keyValues(point.dims),
      startTimeUnixNano,
      timeUnixNano,
      asDouble: point.value,
    });
  }

  return {
    resourceMetrics: [
      {
        resource: { attributes: keyValues(resource) },
        scopeMetrics: [{ scope, metrics: [...metrics.values()] }],
      },
    ],
  };
}
