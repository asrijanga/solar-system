import { describe, expect, it } from 'vitest';
import { bandLimitedOctave, detailM, hashUnit, MEASURED_PPD, OCTAVES } from './approximation';

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
