// The Moon's geometry at any moment in the timeline's span (docs/stories/SS-13f.md), from the
// SPICE samples pipeline/timeline.py writes to public/data/moon/timeline.bin.
//
// Each field is interpolated with a 4-point Lagrange polynomial through the samples either side,
// as the pipeline measured it (timeline.json, measuredWorstError). Directions are renormalised and
// the Moon's rotation re-orthonormalised afterwards. Earth turns half a turn between samples, too
// fast to interpolate, so its IAU rotation is evaluated from pck00011's constants, as SPICE does
// for IAU_EARTH. Pure TypeScript: no three.js (CLAUDE.md).
import type { Mat3Rows, MoonEpoch, Vec3 } from './moon';

export interface TimelineManifest {
  readonly fields: readonly string[];
  readonly firstSampleUtc: string;
  readonly spanUtc: readonly [string, string];
  readonly firstSampleTdbSecondsPastJ2000: number;
  readonly stepHours: number;
  readonly samples: number;
  readonly earthRotation: {
    readonly poleRaDeg: readonly [number, number, number];
    readonly poleDecDeg: readonly [number, number, number];
    readonly primeMeridianDeg: readonly [number, number, number];
  };
}

/** Speed of light, km/s (SPICE clight). */
const C_KM_S = 299792.458;
const RECORD = 18;
const DEG = Math.PI / 180;

const norm3 = (a: number, b: number, c: number): Vec3 => {
  const l = Math.hypot(a, b, c);
  return [a / l, b / l, c / l];
};

/**
 * The epoch at `utcMs` (milliseconds since 1970, UTC, as Date.now gives), or null outside the
 * timeline's span. Runs once when the page opens, not in the frame loop.
 */
export function epochAt(
  manifest: TimelineManifest,
  data: Float32Array,
  utcMs: number,
): MoonEpoch | null {
  const [from, to] = manifest.spanUtc.map((t) => Date.parse(t));
  if (from === undefined || to === undefined || !(utcMs >= from && utcMs <= to)) return null;
  if (data.length !== manifest.samples * RECORD || manifest.fields.length !== RECORD) {
    throw new Error('timeline.bin does not match timeline.json');
  }
  const stepMs = manifest.stepHours * 3600_000;
  const firstMs = Date.parse(manifest.firstSampleUtc);
  const position = (utcMs - firstMs) / stepMs;
  const k = Math.floor(position);
  const x = position - k;
  const w = [
    (-x * (x - 1) * (x - 2)) / 6,
    ((x + 1) * (x - 1) * (x - 2)) / 2,
    (-(x + 1) * x * (x - 2)) / 2,
    ((x + 1) * x * (x - 1)) / 6,
  ];
  const field = (i: number): number => {
    let sum = 0;
    for (let j = 0; j < 4; j++) sum += (w[j] ?? 0) * (data[(k - 1 + j) * RECORD + i] ?? 0);
    return sum;
  };
  const v = Array.from({ length: RECORD }, (_, i) => field(i));
  const at = (i: number): number => v[i] ?? 0;

  const sun = norm3(at(0), at(1), at(2));
  const earth = norm3(at(4), at(5), at(6));
  const earthDistanceKm = at(7);
  // Gram-Schmidt on the interpolated rows, so the rotation stays a rotation.
  const r0 = norm3(at(8), at(9), at(10));
  const d = r0[0] * at(11) + r0[1] * at(12) + r0[2] * at(13);
  const r1 = norm3(at(11) - d * r0[0], at(12) - d * r0[1], at(13) - d * r0[2]);
  const r2: Vec3 = [
    r0[1] * r1[2] - r0[2] * r1[1],
    r0[2] * r1[0] - r0[0] * r1[2],
    r0[0] * r1[1] - r0[1] * r1[0],
  ];

  const tdb = manifest.firstSampleTdbSecondsPastJ2000 + (utcMs - firstMs) / 1000;
  const cosPhase = sun[0] * earth[0] + sun[1] * earth[1] + sun[2] * earth[2];
  return {
    id: 'now',
    utc: new Date(utcMs).toISOString().slice(0, 19),
    phaseAngleDeg: Math.acos(Math.max(-1, Math.min(1, cosPhase))) / DEG,
    sunDirectionJ2000: sun,
    sunDistanceKm: at(3),
    earthDirectionJ2000: earth,
    earthDistanceKm,
    j2000ToBodyFixed: [r0, r1, r2],
    j2000ToEarthFixed: iauRotation(manifest.earthRotation, tdb - earthDistanceKm / C_KM_S),
    earthSunDistanceKm: at(17),
  };
}

/**
 * SPICE's IAU body-fixed rotation, J2000 to body, row-major: [W]₃ [90° − δ]₁ [90° + α]₃, with
 * α and δ the pole's right ascension and declination (T, Julian centuries of TDB since J2000)
 * and W the prime meridian (d, days of TDB since J2000), as polynomials of degree 2.
 */
export function iauRotation(
  constants: TimelineManifest['earthRotation'],
  tdbSecondsPastJ2000: number,
): Mat3Rows {
  const days = tdbSecondsPastJ2000 / 86400;
  const centuries = days / 36525;
  const poly = (c: readonly [number, number, number], t: number): number =>
    c[0] + c[1] * t + c[2] * t * t;
  return poleAndMeridian(
    poly(constants.poleRaDeg, centuries),
    poly(constants.poleDecDeg, centuries),
    poly(constants.primeMeridianDeg, days),
  );
}

/** [W]₃ [90° − δ]₁ [90° + α]₃: J2000 to body, row-major, from the pole and prime meridian, degrees. */
export function poleAndMeridian(raDeg: number, decDeg: number, wDeg: number): Mat3Rows {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const w = wDeg * DEG;
  return multiply(rot3(w), multiply(rot1(Math.PI / 2 - dec), rot3(Math.PI / 2 + ra)));
}

/** Frame rotations about z and x, as SPICE's rotate(): they turn the frame, not the vector. */
function rot3(a: number): Mat3Rows {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [c, s, 0],
    [-s, c, 0],
    [0, 0, 1],
  ];
}

function rot1(a: number): Mat3Rows {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [1, 0, 0],
    [0, c, s],
    [0, -s, c],
  ];
}

function multiply(a: Mat3Rows, b: Mat3Rows): Mat3Rows {
  const row = (r: Vec3): Vec3 => [
    r[0] * b[0][0] + r[1] * b[1][0] + r[2] * b[2][0],
    r[0] * b[0][1] + r[1] * b[1][1] + r[2] * b[2][1],
    r[0] * b[0][2] + r[1] * b[1][2] + r[2] * b[2][2],
  ];
  return [row(a[0]), row(a[1]), row(a[2])];
}
