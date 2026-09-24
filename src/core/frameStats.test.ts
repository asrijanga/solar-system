import { describe, expect, it } from 'vitest';
import { FrameStats, type Percentiles } from './frameStats';

const empty = (): Percentiles => ({ p50: 0, p95: 0, p99: 0, max: 0, count: 0 });

describe('FrameStats', () => {
  it('reports NaN with no samples rather than a misleading zero', () => {
    const p = new FrameStats(10).percentiles(empty());
    expect(p.count).toBe(0);
    expect(p.p95).toBeNaN();
  });

  it('computes nearest-rank percentiles over 1..100', () => {
    const stats = new FrameStats(100);
    for (let ms = 100; ms >= 1; ms--) stats.push(ms); // insertion order must not matter
    const p = stats.percentiles(empty());
    expect(p).toEqual({ p50: 50, p95: 95, p99: 99, max: 100, count: 100 });
  });

  it('exposes the hitch a mean hides', () => {
    const stats = new FrameStats(300);
    for (let i = 0; i < 300; i++) stats.push(i % 60 === 0 ? 90 : 11.1);
    const p = stats.percentiles(empty());
    const mean = (11.1 * 295 + 90 * 5) / 300;
    expect(mean).toBeLessThan(13);
    expect(p.p50).toBeCloseTo(11.1);
    expect(p.p99).toBe(90);
  });

  it('keeps only the most recent window once full', () => {
    const stats = new FrameStats(4);
    for (const ms of [100, 100, 100, 100, 1, 2, 3, 4]) stats.push(ms);
    expect(stats.percentiles(empty()).max).toBe(4);
    const out = new Float64Array(4);
    expect(stats.copyOrdered(out)).toBe(4);
    expect([...out]).toEqual([1, 2, 3, 4]);
  });

  it('returns samples oldest first before the window is full', () => {
    const stats = new FrameStats(8);
    for (const ms of [5, 6, 7]) stats.push(ms);
    const out = new Float64Array(8);
    expect(stats.copyOrdered(out)).toBe(3);
    expect([...out.subarray(0, 3)]).toEqual([5, 6, 7]);
  });
});
