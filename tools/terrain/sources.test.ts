import { describe, expect, it } from 'vitest';
import { Blend, Grid, boxMean } from './sources.ts';

/** A 10 x 10 degree grid at 10 px/deg, north edge 0, west edge 0, constant height. */
function flat(km: number, nanAt?: [number, number]): Grid {
  const values = new Float32Array(100 * 100).fill(km);
  if (nanAt !== undefined) values[nanAt[0] * 100 + nanAt[1]] = Number.NaN;
  return new Grid(values, 100, 100, 0, 0, 10);
}

describe('Blend', () => {
  const blend = new Blend(flat(1), flat(0), [2, -8, 8, -2], 1);

  it('is the fine grid inside the band, the base outside, linear between', () => {
    expect([5, 1, 2, 2.5].map((lon) => blend.heightM(-5, lon))).toEqual([1000, 0, 0, 500]);
  });

  it('takes the base measurement wherever the fine grid has a hole', () => {
    const holed = new Blend(flat(1, [50, 50]), flat(0), [2, -8, 8, -2], 1);
    // Every bilinear sample touching the no-data sample is the base's, not a mix.
    expect([holed.heightM(-5, 5), holed.heightM(-5.05, 5.05), holed.heightM(-3, 3)]).toEqual([
      0, 0, 1000,
    ]);
  });
});

describe('Grid', () => {
  it('wraps longitude on a global grid', () => {
    const values = Float32Array.from({ length: 2 * 4 }, (_, i) => i % 4);
    const global = new Grid(values, 2, 4, 90, 0, 4 / 360, true);
    // Samples sit at 45, 135, 225 and 315 E; 0 E is half way between the last (3) and the first (0).
    expect(global.heightM(0, 0)).toBeCloseTo(1500);
    expect(global.heightM(0, -360)).toBeCloseTo(1500);
  });
});

describe('boxMean', () => {
  it('averages each neighbourhood, repeating the edges outwards', () => {
    const grid = Float32Array.from({ length: 25 }, (_, i) => i);
    const out = boxMean(grid, 5, 5, 3);
    expect(out[2 * 5 + 2]).toBeCloseTo((6 + 7 + 8 + 11 + 12 + 13 + 16 + 17 + 18) / 9);
    expect(out[0]).toBeCloseTo((0 + 0 + 1 + 0 + 0 + 1 + 5 + 5 + 6) / 9);
  });
});
