// The whole Moon's brightness against phase angle (docs/stories/SS-8b.md): Hapke's model with
// the parameters LRO measured for every 1° tile, summed over the disc facing Earth, must follow
// the phase curve in Allen's Astrophysical Quantities (core/hapke.ts moonPhaseMagnitude).
//
// This checks the parameters and the model together against observations of the real Moon that
// share nothing with LRO. The albedo map plays no part: each tile's brightness is Hapke's
// absolute I/F from its own w. The absolute level is compared too: at the fact sheet's
// geometric albedo 0.12 the formula's zero-phase magnitude is the Moon's.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hapke, moonPhaseMagnitude, type HapkeParameters } from '../src/core/hapke';
import { halfToFloat } from '../src/core/half';
import { MOON_GEOMETRIC_ALBEDO } from '../src/core/photometry';

const DATA = join(import.meta.dirname, '..', 'public', 'data', 'moon');
const manifest = JSON.parse(readFileSync(join(DATA, 'hapke.json'), 'utf8')) as {
  texture: { width: number; height: number };
};
const bytes = readFileSync(join(DATA, 'hapke.bin'));
const halves = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
const { width, height } = manifest.texture;

/** The tile's parameters: nearest texel, as the tile is uniform in the source. */
function parametersAt(latDeg: number, lonDeg: number): HapkeParameters {
  const row = Math.min(height - 1, Math.max(0, Math.floor(90 - latDeg)));
  const col = ((Math.floor(lonDeg) % 360) + 360) % 360;
  const t = row * width + col;
  const rgba = (k: number): number => halfToFloat(halves[t * 4 + k] ?? 0);
  return {
    w: rgba(0),
    b: rgba(1),
    c: rgba(2),
    bs0: rgba(3),
    hs: halfToFloat(halves[width * height * 4 + t * 2] ?? 0),
  };
}

/**
 * Mean I/F over the projected disc seen from over longitude 0, latitude 0, with the Sun at
 * phase angle alpha towards the east: the disc's brightness as a fraction of a perfect Lambert
 * disc's, so p · Φ(α) in the usual notation.
 */
function discMeanIOverF(alphaDeg: number, n = 240): number {
  const a = (alphaDeg * Math.PI) / 180;
  const sun = [Math.cos(a), Math.sin(a), 0] as const;
  let sum = 0;
  let count = 0;
  for (let iy = 0; iy < n; iy++) {
    for (let iz = 0; iz < n; iz++) {
      const y = -1 + (2 * (iy + 0.5)) / n;
      const z = -1 + (2 * (iz + 0.5)) / n;
      const r2 = y * y + z * z;
      if (r2 >= 1) continue;
      count++;
      const x = Math.sqrt(1 - r2);
      const mu0 = x * sun[0] + y * sun[1];
      if (mu0 <= 0) continue;
      const lat = (Math.asin(z) * 180) / Math.PI;
      const lon = (Math.atan2(y, x) * 180) / Math.PI;
      sum += hapke(mu0, x, Math.cos(a), parametersAt(lat, lon));
    }
  }
  return sum / count;
}

describe("the Moon's phase curve", () => {
  // Tolerance, owner's approval sought in the PR: 0.25 magnitude, about 25% in brightness.
  // Chosen after seeing this comparison (at most 0.20 off), not before; stated in the PR.
  const TOLERANCE_MAG = 0.25;

  for (const alpha of [10, 20, 30, 45, 60, 75, 90, 105, 120]) {
    it(`matches Allen's Astrophysical Quantities within ${TOLERANCE_MAG} mag at ${alpha}°`, () => {
      const model = -2.5 * Math.log10(discMeanIOverF(alpha) / MOON_GEOMETRIC_ALBEDO);
      expect(Math.abs(model - moonPhaseMagnitude(alpha))).toBeLessThan(TOLERANCE_MAG);
    });
  }

  it('brightens at opposition beyond the formula, the surge the formula leaves out', () => {
    const surge = discMeanIOverF(0.5) / discMeanIOverF(5);
    const formula = 10 ** (-0.4 * (moonPhaseMagnitude(0.5) - moonPhaseMagnitude(5)));
    expect(surge).toBeGreaterThan(formula);
  });
});
