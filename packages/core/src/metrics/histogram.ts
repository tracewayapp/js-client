/**
 * Base-2 exponential histogram at one fixed scale, the shape OTLP calls ExponentialHistogram. Bucket `i` holds the
 * values in (2^(i/8), 2^((i+1)/8)], about 9% wide, so a percentile read from it is within about 4.5% of the true
 * value. One scale everywhere means histograms from different devices add up bucket by bucket.
 */
export const HISTOGRAM_SCALE = 3;

const BUCKETS_PER_DOUBLING = 1 << HISTOGRAM_SCALE;
const ZERO_THRESHOLD = 1e-6;
const MAX_VALUE = 1e12;

export function bucketIndex(value: number): number {
  return Math.ceil(Math.log2(value) * BUCKETS_PER_DOUBLING) - 1;
}

export class Histogram {
  count = 0;
  sum = 0;
  min = Infinity;
  max = -Infinity;
  zeroCount = 0;
  readonly buckets = new Map<number, number>();

  /** Returns false for a value a histogram cannot hold (negative, NaN, infinite). */
  record(value: number): boolean {
    if (!Number.isFinite(value) || value < 0) return false;
    const v = Math.min(value, MAX_VALUE);
    this.count++;
    this.sum += v;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
    if (v < ZERO_THRESHOLD) {
      this.zeroCount++;
    } else {
      const index = bucketIndex(v);
      this.buckets.set(index, (this.buckets.get(index) ?? 0) + 1);
    }
    return true;
  }
}
