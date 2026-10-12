// Mercury's neighbours in its sky (docs/stories/SS-16.md, W8): Venus, Earth and the Moon as points
// of light at true brightness, where SPICE puts them. Earth is in Mercury's timeline
// (core/mercury.ts); Venus and the Moon are in public/data/mercury/neighbours.bin, written by
// pipeline/neighbours_mercury.py. Pure TypeScript: no three.js (CLAUDE.md).
import { earthMagnitudeV, magnitudeFromSum } from './marsMoons';
import type { MercuryEpoch } from './mercury';
import type { Vec3 } from './moon';
import { AU_KM } from './photometry';

/**
 * Venus's V magnitude: Mallama & Hilton (2018), arXiv:1808.01973, read 2026-10-12. Eq. 3 "valid in
 * the intervals of 0o < α <= 163.7o": V = 5 log10(r d) − 4.384 − 1.044E-03 α + 3.687E-04 α² −
 * 2.814E-06 α³ + 8.938E-09 α⁴. Eq. 4 for "163.7o < α < 179o": V = 5 log10(r d) + 236.05828 −
 * 2.81914E+00 α + 8.39034E-03 α². The jump between them is real: forward scattering by sulphuric
 * acid droplets high in Venus's clouds. Nothing was observed beyond 179°: there Eq. 4's value at
 * 179° is used (the spec, owner 2026-10-12).
 */
export const VENUS_ALPHA_MAX_DEG = 179;
export function venusMagnitudeV(rAu: number, dAu: number, alphaDeg: number): number {
  const a = Math.min(Math.abs(alphaDeg), VENUS_ALPHA_MAX_DEG);
  const distance = 5 * Math.log10(rAu * dAu);
  if (a <= 163.7) {
    return (
      distance - 4.384 - 1.044e-3 * a + 3.687e-4 * a ** 2 - 2.814e-6 * a ** 3 + 8.938e-9 * a ** 4
    );
  }
  return distance + 236.05828 - 2.81914 * a + 8.39034e-3 * a ** 2;
}

/** public/data/mercury/neighbours.json. */
export interface MercuryNeighboursManifest {
  readonly fields: readonly string[];
  readonly firstSampleUtc: string;
  readonly spanUtc: readonly [string, string];
  readonly stepHours: number;
  readonly samples: number;
}

/** Venus and the Moon at one instant, from Mercury's centre. */
export interface MercuryNeighboursAt {
  readonly venusDirectionJ2000: Vec3;
  readonly venusDistanceKm: number;
  readonly moonDirectionJ2000: Vec3;
  readonly moonDistanceKm: number;
  readonly moonDiscKm2: number;
}

const RECORD = 9;

const norm3 = (a: number, b: number, c: number): Vec3 => {
  const l = Math.hypot(a, b, c);
  return [a / l, b / l, c / l];
};

/** Venus and the Moon at `utcMs`, or null outside the span. Runs once, not in the frame loop. */
export function mercuryNeighboursAt(
  manifest: MercuryNeighboursManifest,
  data: Float32Array,
  utcMs: number,
): MercuryNeighboursAt | null {
  const [from, to] = manifest.spanUtc.map((t) => Date.parse(t));
  if (from === undefined || to === undefined || !(utcMs >= from && utcMs <= to)) return null;
  if (data.length !== manifest.samples * RECORD || manifest.fields.length !== RECORD) {
    throw new Error('neighbours.bin does not match its neighbours.json');
  }
  const position = (utcMs - Date.parse(manifest.firstSampleUtc)) / (manifest.stepHours * 3600_000);
  const k = Math.floor(position);
  const x = position - k;
  // 4-point Lagrange through the samples either side, as core/mercury.ts.
  const w = [
    (-x * (x - 1) * (x - 2)) / 6,
    ((x + 1) * (x - 1) * (x - 2)) / 2,
    (-(x + 1) * x * (x - 2)) / 2,
    ((x + 1) * x * (x - 1)) / 6,
  ];
  const at = (i: number): number => {
    let sum = 0;
    for (let j = 0; j < 4; j++) sum += (w[j] ?? 0) * (data[(k - 1 + j) * RECORD + i] ?? 0);
    return sum;
  };
  return {
    venusDirectionJ2000: norm3(at(0), at(1), at(2)),
    venusDistanceKm: at(3),
    moonDirectionJ2000: norm3(at(4), at(5), at(6)),
    moonDistanceKm: at(7),
    moonDiscKm2: at(8),
  };
}

/** One neighbour as a point: its J2000 direction from Mercury and its V magnitude. */
export interface NeighbourPoint {
  readonly name: 'Venus' | 'Earth' | 'Moon';
  readonly directionJ2000: Vec3;
  readonly v: number;
}

const scale = (u: Vec3, s: number): Vec3 => [u[0] * s, u[1] * s, u[2] * s];
const minus = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const length = (u: Vec3): number => Math.hypot(u[0], u[1], u[2]);
const angleDeg = (u: Vec3, v: Vec3): number =>
  (Math.acos(
    Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (length(u) * length(v)))),
  ) *
    180) /
  Math.PI;

/** Venus, Earth and the Moon as Mercury sees them at `epoch`, with their V magnitudes. */
export function neighbourPoints(epoch: MercuryEpoch, at: MercuryNeighboursAt): NeighbourPoint[] {
  const sunKm = scale(epoch.sunDirectionJ2000, epoch.sunDistanceKm);
  const body = (dir: Vec3, km: number) => {
    const position = scale(dir, km);
    const toSun = minus(sunKm, position);
    // The phase angle at the body: between the Sun and Mercury, seen from it.
    return { position, rAu: length(toSun) / AU_KM, alphaDeg: angleDeg(toSun, scale(position, -1)) };
  };
  const venus = body(at.venusDirectionJ2000, at.venusDistanceKm);
  const earth = body(epoch.earthDirectionJ2000, epoch.earthDistanceKm);
  const moon = body(at.moonDirectionJ2000, at.moonDistanceKm);
  return [
    {
      name: 'Venus',
      directionJ2000: at.venusDirectionJ2000,
      v: venusMagnitudeV(venus.rAu, at.venusDistanceKm / AU_KM, venus.alphaDeg),
    },
    {
      name: 'Earth',
      directionJ2000: epoch.earthDirectionJ2000,
      v: earthMagnitudeV(earth.rAu, epoch.earthDistanceKm / AU_KM, earth.alphaDeg),
    },
    {
      name: 'Moon',
      directionJ2000: at.moonDirectionJ2000,
      v: magnitudeFromSum(at.moonDiscKm2, at.moonDistanceKm, moon.rAu),
    },
  ];
}
