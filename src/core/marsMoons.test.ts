import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { hapke, porosityFactor } from './hapke';
import {
  DEIMOS_LAW,
  decodeShape,
  discSum,
  discTable,
  earthMagnitudeV,
  facetBins,
  hiddenFraction,
  lookupDisc,
  magnitudeFromSum,
  monthFor,
  moonsAt,
  PHOBOS_LAW,
  sphereGeometricAlbedo,
  sunlitFraction,
  type MoonShape,
  type MoonsManifest,
} from './marsMoons';
import type { Mat3Rows, Vec3 } from './moon';
import { zeroPhaseMagnitude } from './photometry';

const data = (path: string): string => join(import.meta.dirname, '../../', path);
const MANIFEST = JSON.parse(
  readFileSync(data('public/data/mars/moons.json'), 'utf8'),
) as MoonsManifest & {
  positions: { measuredWorstError: Record<string, number> };
};
interface Truth {
  readonly utc: string;
  readonly tdbSecondsPastJ2000: number;
  readonly phobosJ2000Km: Vec3;
  readonly deimosJ2000Km: Vec3;
  readonly moonOffsetJ2000Km: Vec3;
  readonly moonDiscKm2: number;
  readonly j2000ToPhobos: Mat3Rows;
  readonly j2000ToDeimos: Mat3Rows;
}
const TRUTHS = (
  JSON.parse(readFileSync(data('test/fixtures/mars-moons-truth.json'), 'utf8')) as {
    moments: Truth[];
  }
).moments;

function samples(file: string): Float32Array {
  const bytes = readFileSync(data(`public/data/mars/moons/${file}`));
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function shape(name: 'phobos' | 'deimos'): MoonShape {
  const raw = gunzipSync(readFileSync(data(`public/data/mars/moons/${name}.bin.gz`)));
  return decodeShape(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angleDeg = (a: Vec3, b: Vec3): number => {
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
};
/** A body-fixed direction in J2000: the transpose of J2000 → body. */
const toJ2000 = (m: Mat3Rows, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
  m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
  m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
];
const lonLat = (lonDeg: number, latDeg: number): Vec3 => {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
};

describe("Mars's moons: where they are", () => {
  const worst = MANIFEST.positions.measuredWorstError;

  it('interpolates SPICE to the errors the pipeline measured', () => {
    for (const t of TRUTHS) {
      const month = monthFor(MANIFEST, t.utc);
      if (month === null) throw new Error(`no month for ${t.utc}`);
      const at = moonsAt(MANIFEST, month, samples(month.file), t.tdbSecondsPastJ2000);
      expect(distance(at.phobosJ2000Km, t.phobosJ2000Km)).toBeLessThanOrEqual(
        worst['phobosKm'] ?? 0,
      );
      expect(distance(at.deimosJ2000Km, t.deimosJ2000Km)).toBeLessThanOrEqual(
        worst['deimosKm'] ?? 0,
      );
      expect(distance(at.moonOffsetJ2000Km, t.moonOffsetJ2000Km)).toBeLessThanOrEqual(
        worst['moonOffsetKm'] ?? 0,
      );
      expect(Math.abs(at.moonDiscKm2 / t.moonDiscKm2 - 1)).toBeLessThanOrEqual(
        worst['moonDiscRelative'] ?? 0,
      );
    }
  });

  // The recipe's orientation test (docs/world-recipe.md, W8): a named place on each moon lands
  // where SPICE puts it, within the owner's 0.01°.
  it('puts Stickney, and Deimos’s prime meridian on its equator, where SPICE does', () => {
    const stickney = lonLat(MANIFEST.stickney.lonEastDeg, MANIFEST.stickney.latDeg);
    const deimosOrigin = lonLat(0, 0);
    for (const t of TRUTHS) {
      const month = monthFor(MANIFEST, t.utc);
      if (month === null) throw new Error(`no month for ${t.utc}`);
      const at = moonsAt(MANIFEST, month, samples(month.file), t.tdbSecondsPastJ2000);
      expect(
        angleDeg(toJ2000(at.j2000ToPhobos, stickney), toJ2000(t.j2000ToPhobos, stickney)),
      ).toBeLessThan(0.01);
      expect(
        angleDeg(toJ2000(at.j2000ToDeimos, deimosOrigin), toJ2000(t.j2000ToDeimos, deimosOrigin)),
      ).toBeLessThan(0.01);
    }
  });

  it('has Stickney where the shape is: a depression at the Gazetteer’s place, not its mirror', () => {
    const { positions } = shape('phobos');
    // Mean radius of the vertices within `deg` of a direction.
    const meanRadius = (dir: Vec3, deg: number): number => {
      const cos = Math.cos((deg * Math.PI) / 180);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < positions.length; i += 3) {
        const v: Vec3 = [positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0];
        const r = Math.hypot(...v);
        if ((v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / r < cos) continue;
        sum += r;
        n++;
      }
      return sum / n;
    };
    const s = MANIFEST.stickney;
    const depth = (lonDeg: number): number =>
      meanRadius(lonLat(lonDeg, s.latDeg + 20), 3) +
      meanRadius(lonLat(lonDeg, s.latDeg - 20), 3) -
      2 * meanRadius(lonLat(lonDeg, s.latDeg), 3);
    // Stickney is about 9 km across on an 11 km body: its floor lies well below its north and
    // south rims. At the mirrored longitude there is no such bowl.
    expect(depth(s.lonEastDeg)).toBeGreaterThan(1);
    expect(depth(-s.lonEastDeg)).toBeLessThan(0.5);
  });
});

describe("Mars's moons: how bright", () => {
  it('leaves Hapke unchanged at K = 1', () => {
    expect(hapke(0.7, 0.9, 0.8, PHOBOS_LAW.parameters, 24, 1)).toBe(
      hapke(0.7, 0.9, 0.8, PHOBOS_LAW.parameters, 24),
    );
  });

  it('reproduces the papers’ porosity factor', () => {
    // Fornasier et al. (2024), Table 3: K = 1.19 at porosity 0.87.
    expect(Math.abs(porosityFactor(0.87) - 1.19)).toBeLessThan(0.01);
  });

  it.each([
    ['Phobos', PHOBOS_LAW],
    ['Deimos', DEIMOS_LAW],
  ] as const)('gives %s its measured geometric albedo', (_, law) => {
    const p = sphereGeometricAlbedo(law);
    expect(Math.abs(p / law.geometricAlbedo.value - 1)).toBeLessThan(law.geometricAlbedo.tolerance);
  });

  it('gives Earth its V(1,0) and a sphere its zero-phase magnitude', () => {
    expect(earthMagnitudeV(1, 1, 0)).toBeCloseTo(-3.99, 12);
    const p = 0.12;
    const r = 1737.4;
    expect(magnitudeFromSum(p * Math.PI * r * r, 384_400, 1)).toBeCloseTo(
      zeroPhaseMagnitude(p, r, 384_400),
      10,
    );
  });

  it('bins the shape without losing area, and looks a disc sum up as it was computed', () => {
    const s = shape('deimos');
    const bins = facetBins(s);
    const total = bins.areas.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(400);
    const sun: Vec3 = [1, 0, 0];
    const table = discTable(bins, DEIMOS_LAW, sun, 10);
    const view = lonLat(30, -20);
    expect(lookupDisc(table, ...view)).toBeCloseTo(discSum(bins, DEIMOS_LAW, sun, view), 9);
  });
});

describe("Mars's shadow on its moons", () => {
  it('hides nothing apart, everything behind a larger disc, and half behind a straight edge', () => {
    expect(hiddenFraction(0.01, 0.1, 0.2)).toBe(0);
    expect(hiddenFraction(0.01, 0.1, 0.05)).toBe(1);
    // A far larger disc's edge through the Sun's centre is nearly straight: it hides half.
    expect(hiddenFraction(0.01, 10, 10)).toBeCloseTo(0.5, 3);
  });

  it('puts a point straight behind Mars in full shadow, and one beside it in sunlight', () => {
    const pole: Vec3 = [0, 0, 1];
    const toSun: Vec3 = [1, 0, 0];
    const au = 2.28e8;
    expect(sunlitFraction([-9400, 0, 0], pole, 0.994, 3396.19, toSun, au)).toBe(0);
    expect(sunlitFraction([0, 9400, 0], pole, 0.994, 3396.19, toSun, au)).toBe(1);
  });
});
