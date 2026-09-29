import { describe, expect, it } from 'vitest';
import { bandBasis, colourWeights, COLOUR_BANDS_NM, tint } from './moonColour';

describe("the Moon's colour", () => {
  const weights = colourWeights();

  it('shows a surface that reflects every wavelength equally as grey', () => {
    for (const row of weights) {
      expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
    const [r, g, b] = tint([1, 1, 1, 1], weights);
    expect(r).toBeCloseTo(1, 12);
    expect(g).toBeCloseTo(1, 12);
    expect(b).toBeCloseTo(1, 12);
  });

  it('interpolates linearly between the bands and holds flat beyond them', () => {
    expect(bandBasis(400)).toEqual([1, 0, 0, 0]);
    expect(bandBasis(700)).toEqual([0, 0, 0, 1]);
    const mid = bandBasis((566 + 643) / 2);
    expect(mid[1]).toBeCloseTo(0.5, 12);
    expect(mid[2]).toBeCloseTo(0.5, 12);
    for (const lambda of [380, 450, 566, 600, 660, 800]) {
      expect(bandBasis(lambda).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
    expect(COLOUR_BANDS_NM).toEqual([415, 566, 643, 689]);
  });

  it('makes a spectrum that rises to the red look warm: red above green above blue', () => {
    // The Moon's median band ratios (public/data/moon/albedo.json colour.medianRatios).
    const [r, g, b] = tint([0.69, 1, 1.15, 1.2], weights);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });
});
