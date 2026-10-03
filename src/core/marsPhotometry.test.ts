import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MALLAMA_L1,
  MALLAMA_L2,
  mallamaCorrection,
  mallamaHiltonFullV,
  mallamaHiltonV,
  type MarsPhotometry,
} from './marsPhotometry';
import { AU_KM, SUN_V_MAGNITUDE } from './photometry';

const photometry = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../public/data/mars/photometry.json'), 'utf8'),
) as MarsPhotometry;

describe("Mars's brightness", () => {
  it('reads Mallama & Hilton Eq. 6 as published', () => {
    expect(mallamaHiltonV(0)).toBe(-1.601);
    expect(mallamaHiltonV(40)).toBeCloseTo(-1.601 + 0.02267 * 40 - 0.0001302 * 1600, 12);
    expect(mallamaHiltonV(-40)).toBe(mallamaHiltonV(40));
  });

  it('gives a V geometric albedo of 0.171 for the zero-phase magnitude', () => {
    const p = (AU_KM / 3389.5) ** 2 * 10 ** (-0.4 * (mallamaHiltonV(0) - SUN_V_MAGNITUDE));
    expect(p).toBeCloseTo(0.171, 3);
  });

  it('builds a disc that follows Eq. 6 from 0 to 50 degrees once calibrated', () => {
    expect(photometry.curve.length).toBeGreaterThan(5);
    // Calibrated at zero phase, the curve's departures are the fit's shape residuals: their RMS
    // is the one the fit recorded, and every point is inside the owner's 0.06 mag (W7 spec).
    let sum = 0;
    for (const point of photometry.curve) {
      expect(point.mallamaHilton).toBeCloseTo(mallamaHiltonV(point.alphaDeg), 4);
      expect(Math.abs(point.built - point.mallamaHilton)).toBeLessThan(0.06);
      sum += (point.built - point.mallamaHilton) ** 2;
    }
    expect(Math.sqrt(sum / photometry.curve.length)).toBeCloseTo(photometry.shapeRmsMag, 3);
    expect(photometry.curve[0]?.built).toBeCloseTo(-1.601, 3);
  });

  it('scales every band down to Mars measured brightness, and records why', () => {
    expect(photometry.calibration.map((c) => c.nm)).toEqual([440, 530, 750, 970]);
    for (const c of photometry.calibration) {
      expect(c.built * c.factor).toBeCloseTo(c.target, 3);
    }
  });
});

describe("Mars's light curve", () => {
  it("follows Mallama's L1 within 0.035 mag RMS (owner-approved, SS-14 W3 part 3)", () => {
    // 0.035 mag is the RMS of the longitude term Mallama & Hilton (2018) give.
    expect(photometry.lightCurve.points).toHaveLength(36);
    expect(photometry.lightCurve.rmsMag).toBeLessThanOrEqual(0.035);
  });
});

describe("Mallama & Hilton's longitude and season corrections", () => {
  it('interpolates their tables through every tabulated point', () => {
    for (let k = 0; k <= 35; k++) {
      expect(mallamaCorrection(MALLAMA_L1, 10 * k)).toBeCloseTo(MALLAMA_L1[k + 2] ?? 0, 12);
      expect(mallamaCorrection(MALLAMA_L2, 10 * k)).toBeCloseTo(MALLAMA_L2[k + 2] ?? 0, 12);
    }
  });

  it("reproduces their code's Mars test magnitude (Ap_Mag_Input_V3.txt, 2003-08-28)", () => {
    // Horizons row: Ob-lon 329.27, Sl-lon 330.76 (west), hEcl-Lon 334.4996, r 1.381191244505,
    // delta 0.37274381097911, S-T-O 4.8948; their computed new_ap_mag -2.862. Ls = hEcl-Lon - 85.
    const r = 1.381191244505;
    const d = 0.37274381097911;
    const v = 5 * Math.log10(r * d) + mallamaHiltonFullV(4.8948, -329.27, -330.76, 334.4996 - 85);
    expect(v).toBeCloseTo(-2.862, 2);
  });
});
