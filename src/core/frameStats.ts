// Rolling frame-time statistics. Percentiles, never a mean alone: a 12 ms mean can hide a
// 90 ms hitch every second. push() is on the per-frame path and allocates nothing.

export interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  count: number;
}

export class FrameStats {
  readonly capacity: number;
  private readonly samples: Float64Array;
  private readonly scratch: Float64Array;
  private next = 0;
  private filled = 0;

  constructor(capacity = 300) {
    this.capacity = capacity;
    this.samples = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  /** Records one frame time in milliseconds, overwriting the oldest once full. */
  push(ms: number): void {
    this.samples[this.next] = ms;
    this.next = (this.next + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  get count(): number {
    return this.filled;
  }

  /** Samples in insertion order, oldest first, written into `out`. Returns the count. */
  copyOrdered(out: Float64Array): number {
    const start = this.filled < this.capacity ? 0 : this.next;
    for (let i = 0; i < this.filled; i++) out[i] = this.samples[(start + i) % this.capacity] ?? 0;
    return this.filled;
  }

  /**
   * Nearest-rank percentiles over the current window, written into `out` so a caller can
   * reuse one object. With no samples, every value is NaN.
   */
  percentiles(out: Percentiles): Percentiles {
    const n = this.filled;
    out.count = n;
    if (n === 0) {
      out.p50 = out.p95 = out.p99 = out.max = Number.NaN;
      return out;
    }
    const sorted = this.scratch.subarray(0, n);
    sorted.set(this.samples.subarray(0, n));
    sorted.sort();
    out.p50 = nearestRank(sorted, 0.5);
    out.p95 = nearestRank(sorted, 0.95);
    out.p99 = nearestRank(sorted, 0.99);
    out.max = sorted[n - 1] ?? Number.NaN;
    return out;
  }
}

/** The smallest sample with at least fraction p of all samples at or below it. */
function nearestRank(sorted: Float64Array, p: number): number {
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1] ?? Number.NaN;
}
