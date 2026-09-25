import { describe, expect, it } from 'vitest';
import {
  bandLimitedCraters,
  bandLimitedOctave,
  craterDensityPerKm2,
  craterField,
  CRATER_CLASSES,
  CRATER_MAX_M,
  detailM,
  hashUnit,
  MEASURED_PPD,
  OCTAVES,
} from './approximation';

const A = [1, 1, 1];

describe('approximated detail', () => {
  it('is exactly zero at every measured sample, so the surface passes through each measurement', () => {
    let worst = 0;
    for (let n = 0; n < 2000; n++) {
      // Random measured samples: whole multiples of 1/3600 degree, anywhere on the Moon.
      const lat = Math.round((Math.random() * 168 - 84) * MEASURED_PPD) / MEASURED_PPD;
      const lon = Math.round((Math.random() * 360 - 180) * MEASURED_PPD) / MEASURED_PPD;
      worst = Math.max(worst, Math.abs(detailM(lat, lon, A)));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('is non-zero between samples: it adds variation shorter than the measured spacing', () => {
    let sumSq = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const v = detailM(-11 + Math.random() * 0.01, 4 + Math.random() * 0.01, A);
      sumSq += v * v;
    }
    expect(Math.sqrt(sumSq / n)).toBeGreaterThan(0.1);
  });

  it('averages to zero', () => {
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++)
      sum += detailM(-11 + Math.random() * 0.1, 4 + Math.random() * 0.1, A);
    expect(Math.abs(sum / n)).toBeLessThan(0.02);
  });

  it('is continuous: a step of a millimetre changes it by a tiny amount', () => {
    const mm = (1e-3 / 1737400) * (180 / Math.PI);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const lat = -11 + Math.random() * 0.01;
      const lon = 4 + Math.random() * 0.01;
      worst = Math.max(worst, Math.abs(detailM(lat + mm, lon + mm, A) - detailM(lat, lon, A)));
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('is the same at the same place, and wraps across 180 degrees', () => {
    expect(detailM(-11.1234, 4.5678, A)).toBe(detailM(-11.1234, 4.5678, A));
    for (let k = 1; k <= OCTAVES; k++) {
      expect(bandLimitedOctave(10.00001, 180 - 1e-9, k)).toBeCloseTo(
        bandLimitedOctave(10.00001, -180 - 1e-9, k),
        9,
      );
    }
  });

  it('hashes to [-1, 1] with a mean near zero', () => {
    let sum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 100000; i++) {
      const h = hashUnit(i, i * 7 + 3, 2);
      sum += h;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThanOrEqual(1);
    expect(Math.abs(sum / 100000)).toBeLessThan(0.01);
  });
});

describe('approximated craters (NASA DSNE Rev. I, 3.4.1)', () => {
  it('uses the Trask equilibrium density: 794 craters of 10 m or more per km²', () => {
    expect(0.079433 * 0.01 ** -2).toBeCloseTo(794.33, 1);
    // 2 m to 16.8 m: N(≥2 m) − N(≥16.8 m).
    expect(craterDensityPerKm2()).toBeCloseTo(
      0.079433 * (0.002 ** -2 - (CRATER_MAX_M / 1000) ** -2),
      6,
    );
  });

  it('has class fractions that add up to the whole population', () => {
    expect(CRATER_CLASSES.reduce((s, c) => s + c.fraction, 0)).toBeCloseTo(1, 10);
  });

  it('only ever lowers the ground, by at most the deepest class times the largest crater', () => {
    let lowest = 0;
    for (let n = 0; n < 5000; n++) {
      const h = craterField(20 + Math.random() * 0.05, 30 + Math.random() * 0.05);
      expect(h).toBeLessThanOrEqual(0);
      lowest = Math.min(lowest, h);
    }
    // Overlapping bowls add, so allow a few.
    expect(lowest).toBeGreaterThan(-3 * 0.2 * CRATER_MAX_M);
    expect(lowest).toBeLessThan(-0.5);
  });

  it('covers the area the Trask law implies', () => {
    // Area covered per km² by 2-16.8 m bowls: integral of (pi/4) D² dN = (pi k / 2) ln(Dmax/Dmin);
    // random overlap leaves 1 - exp(-that) of the ground inside at least one crater.
    const expected = 1 - Math.exp(-((Math.PI * 0.079433) / 2) * Math.log(CRATER_MAX_M / 2));
    let inside = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      if (craterField(-30 + Math.random() * 0.02, 100 + Math.random() * 0.02) < 0) inside++;
    }
    expect(inside / n).toBeCloseTo(expected, 1);
    expect(Math.abs(inside / n - expected)).toBeLessThan(0.02);
  });

  it('is exactly zero at every measured sample after pinning', () => {
    let worst = 0;
    for (let n = 0; n < 300; n++) {
      const lat = Math.round((Math.random() * 120 - 60) * MEASURED_PPD) / MEASURED_PPD;
      const lon = Math.round((Math.random() * 360 - 180) * MEASURED_PPD) / MEASURED_PPD;
      worst = Math.max(worst, Math.abs(bandLimitedCraters(lat, lon)));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('is the same at the same place', () => {
    expect(craterField(-11.30012, 3.77045)).toBe(craterField(-11.30012, 3.77045));
  });
});
