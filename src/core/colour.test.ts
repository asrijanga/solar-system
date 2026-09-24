import { describe, expect, it } from 'vitest';
import {
  blackbodyChromaticity,
  bvToKelvin,
  bvToLinearSrgb,
  luminance,
  xyzToLinearSrgb,
} from './starColour';

describe('blackbody chromaticity (Planck × CIE 1931 multi-lobe fit)', () => {
  // CIE standard illuminant A is defined as a Planckian radiator at 2856 K. Its published
  // chromaticity is x = 0.44757, y = 0.40745 (CIE 015:2018). This anchors the fit constants:
  // a misremembered lobe coefficient moves this point.
  it('reproduces illuminant A at 2856 K', () => {
    // The fit's stated accuracy puts it within about 0.002 in xy; measured: 0.0012.
    const [x, y] = blackbodyChromaticity(2856);
    expect(Math.abs(x - 0.44757)).toBeLessThan(0.002);
    expect(Math.abs(y - 0.40745)).toBeLessThan(0.002);
  });

  it('moves from red towards blue as temperature rises', () => {
    const cool = blackbodyChromaticity(3000);
    const hot = blackbodyChromaticity(20000);
    expect(hot[0]).toBeLessThan(cool[0]);
    expect(hot[1]).toBeLessThan(cool[1]);
  });
});

describe('xyzToLinearSrgb', () => {
  it('maps the D65 white point to equal RGB', () => {
    // D65 XYZ with Y = 1 (IEC 61966-2-1).
    const [r, g, b] = xyzToLinearSrgb(0.9505, 1, 1.089);
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(1, 2);
    expect(b).toBeCloseTo(1, 2);
  });
});

describe('bvToKelvin (Ballesteros 2012)', () => {
  it('puts the Sun, B−V 0.65, near its 5772 K effective temperature', () => {
    expect(Math.abs(bvToKelvin(0.65) - 5772)).toBeLessThan(150);
  });

  it('puts Vega, B−V 0.00, near its roughly 9600 K', () => {
    expect(Math.abs(bvToKelvin(0) - 9600)).toBeLessThan(700);
  });
});

describe('bvToLinearSrgb', () => {
  it('always has unit luminance', () => {
    for (const bv of [-0.3, 0, 0.65, 1.85]) {
      expect(luminance(...bvToLinearSrgb(bv))).toBeCloseTo(1, 6);
    }
  });

  it('makes Betelgeuse (1.85) red and Rigel (−0.03) blue', () => {
    const [br, , bb] = bvToLinearSrgb(1.85);
    const [rr, , rb] = bvToLinearSrgb(-0.03);
    expect(br).toBeGreaterThan(bb);
    expect(rb).toBeGreaterThan(rr);
  });

  it('shows a missing index as neutral rather than guessing', () => {
    expect(bvToLinearSrgb(null)).toEqual([1, 1, 1]);
    expect(bvToLinearSrgb(Number.NaN)).toEqual([1, 1, 1]);
  });
});
