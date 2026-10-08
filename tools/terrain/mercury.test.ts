import { describe, expect, it } from 'vitest';
import { DEM_TO_DEG, MLA_FROM_DEG, latOfRow, median, mlaWeight } from './mercury.ts';

describe("Mercury's terrain composite (SS-16 W4)", () => {
  it('takes MLA alone north of 80 N, the DEM alone south of 70 N, linear between', () => {
    expect(mlaWeight(MLA_FROM_DEG + 0.01)).toBe(1);
    expect(mlaWeight(90)).toBe(1);
    expect(mlaWeight(DEM_TO_DEG - 0.01)).toBe(0);
    expect(mlaWeight(-90)).toBe(0);
    expect(mlaWeight(75)).toBeCloseTo(0.5, 12);
  });

  it('places rows at pixel centres, 64 per degree from 90 N', () => {
    expect(latOfRow(0)).toBeCloseTo(90 - 0.5 / 64, 12);
    expect(latOfRow(11519)).toBeCloseTo(-90 + 0.5 / 64, 12);
  });

  it('takes the median of odd and even counts', () => {
    expect(median(Float32Array.from([3, 1, 2]))).toBe(2);
    expect(median(Float32Array.from([4, 1, 3, 2]))).toBe(2.5);
    expect(median(new Float32Array(0))).toBeNaN();
  });
});
