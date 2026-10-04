// Mars's geometry at an epoch (docs/stories/SS-14.md): the fixed epochs of
// public/data/mars/ephemeris.json (W2), and any moment from 2026 to 2030 from
// public/data/mars/timeline.bin (W7).
//
// Frames. The body-fixed frame is IAU_MARS: +x towards longitude 0 on the equator, +z towards the
// north pole, longitudes planetocentric and east-positive (pck00011.tpc). `j2000ToBodyFixed` is
// SPICE's pxform("J2000", "IAU_MARS"), row-major. Mars turns 176° in the timeline's 12 h step, so
// its rotation is evaluated from pck00011's model, periodic terms included, as SPICE does.
// Pure TypeScript: no three.js (CLAUDE.md).
import type { Mat3Rows, Vec3 } from './moon';
import { poleAndMeridian } from './timeline';

/** One epoch. Directions are unit vectors in J2000, from Mars's centre, light-time corrected. */
export interface MarsEpoch {
  readonly id: string;
  readonly utc: string;
  readonly tdbSecondsPastJ2000: number;
  /** Sun-Mars-Earth, degrees: the phase angle Earth sees Mars at. */
  readonly phaseAngleDeg: number;
  readonly solarLongitudeLsDeg: number;
  readonly sunDirectionJ2000: Vec3;
  readonly sunDistanceKm: number;
  readonly earthDirectionJ2000: Vec3;
  readonly earthDistanceKm: number;
  readonly j2000ToBodyFixed: Mat3Rows;
}

export interface MarsEphemeris {
  readonly body: {
    /** pck00011.tpc BODY499_RADII, km: equatorial, equatorial, polar. */
    readonly radiiKm: Vec3;
    readonly gmKm3PerS2: number;
    readonly bodyFixedFrame: string;
  };
  readonly epochs: readonly Omit<MarsEpoch, 'phaseAngleDeg'>[];
}

/** pck00011's IAU_MARS model as public/data/mars/timeline.json holds it. */
export interface MarsRotation {
  readonly poleRaDeg: readonly number[];
  readonly poleDecDeg: readonly number[];
  readonly primeMeridianDeg: readonly number[];
  readonly nutPrecRaDeg: readonly number[];
  readonly nutPrecDecDeg: readonly number[];
  readonly nutPrecPmDeg: readonly number[];
  /** [A, B, C] per angle: θ = A + B T + C T², degrees, T Julian centuries of TDB. */
  readonly nutPrecAnglesDeg: readonly (readonly number[])[];
}

export interface MarsTimelineManifest {
  readonly fields: readonly string[];
  readonly firstSampleUtc: string;
  readonly spanUtc: readonly [string, string];
  readonly firstSampleTdbSecondsPastJ2000: number;
  readonly stepHours: number;
  readonly samples: number;
  readonly rotation: MarsRotation;
}

const DEG = Math.PI / 180;
const RECORD = 10;

const poly = (c: readonly number[], t: number): number =>
  (c[0] ?? 0) + (c[1] ?? 0) * t + (c[2] ?? 0) * t * t;

/**
 * SPICE's IAU_MARS rotation at a TDB instant: α = poly(T) + Σ ra_k sin θ_k,
 * δ = poly(T) + Σ dec_k cos θ_k, W = poly(d) + Σ pm_k sin θ_k (pck00011.tpc).
 */
export function marsRotation(r: MarsRotation, tdbSecondsPastJ2000: number): Mat3Rows {
  const days = tdbSecondsPastJ2000 / 86400;
  const centuries = days / 36525;
  let ra = poly(r.poleRaDeg, centuries);
  let dec = poly(r.poleDecDeg, centuries);
  let w = poly(r.primeMeridianDeg, days);
  r.nutPrecAnglesDeg.forEach((angle, k) => {
    const theta = poly(angle, centuries) * DEG;
    ra += (r.nutPrecRaDeg[k] ?? 0) * Math.sin(theta);
    dec += (r.nutPrecDecDeg[k] ?? 0) * Math.cos(theta);
    w += (r.nutPrecPmDeg[k] ?? 0) * Math.sin(theta);
  });
  return poleAndMeridian(ra, dec, w);
}

const norm3 = (a: number, b: number, c: number): Vec3 => {
  const l = Math.hypot(a, b, c);
  return [a / l, b / l, c / l];
};

/**
 * Mars at `utcMs` (milliseconds since 1970, UTC), or null outside the timeline's span. Runs once
 * when the page opens, not in the frame loop.
 */
export function marsEpochAt(
  manifest: MarsTimelineManifest,
  data: Float32Array,
  utcMs: number,
): MarsEpoch | null {
  const [from, to] = manifest.spanUtc.map((t) => Date.parse(t));
  if (from === undefined || to === undefined || !(utcMs >= from && utcMs <= to)) return null;
  if (data.length !== manifest.samples * RECORD || manifest.fields.length !== RECORD) {
    throw new Error('the Mars timeline.bin does not match its timeline.json');
  }
  const firstMs = Date.parse(manifest.firstSampleUtc);
  const position = (utcMs - firstMs) / (manifest.stepHours * 3600_000);
  const k = Math.floor(position);
  const x = position - k;
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
  const sun = norm3(at(0), at(1), at(2));
  const earth = norm3(at(4), at(5), at(6));
  const tdb = manifest.firstSampleTdbSecondsPastJ2000 + (utcMs - firstMs) / 1000;
  const cosPhase = sun[0] * earth[0] + sun[1] * earth[1] + sun[2] * earth[2];
  const ls = Math.atan2(at(9), at(8)) / DEG;
  return {
    id: 'now',
    utc: new Date(utcMs).toISOString().slice(0, 19),
    tdbSecondsPastJ2000: tdb,
    phaseAngleDeg: Math.acos(Math.max(-1, Math.min(1, cosPhase))) / DEG,
    solarLongitudeLsDeg: ls < 0 ? ls + 360 : ls,
    sunDirectionJ2000: sun,
    sunDistanceKm: at(3),
    earthDirectionJ2000: earth,
    earthDistanceKm: at(7),
    j2000ToBodyFixed: marsRotation(manifest.rotation, tdb),
  };
}

/** A fixed epoch of ephemeris.json, with its phase angle as Earth sees Mars. */
export function marsEpoch(ephemeris: MarsEphemeris, id: string): MarsEpoch {
  const e = ephemeris.epochs.find((x) => x.id === id);
  if (e === undefined) throw new Error(`no Mars epoch ${id}`);
  const s = e.sunDirectionJ2000;
  const d = e.earthDirectionJ2000;
  const cosPhase = s[0] * d[0] + s[1] * d[1] + s[2] * d[2];
  return { ...e, phaseAngleDeg: Math.acos(Math.max(-1, Math.min(1, cosPhase))) / DEG };
}
