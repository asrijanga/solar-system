// Mercury's geometry at an epoch (docs/stories/SS-16.md): the fixed epochs of
// public/data/mercury/ephemeris.json (W2), and any moment from 2026 to 2030 from
// public/data/mercury/timeline.bin (W7). As core/mars.ts, without a season: Mercury's axis is
// almost upright, and what changes its light is its distance from the Sun.
//
// Frames: IAU_MERCURY, +x towards longitude 0 on the equator, +z towards the north pole,
// planetocentric and east-positive (pck00011.tpc). Its rotation is evaluated from pck00011's model
// with core/mars.ts's marsRotation, which src/core/mercury.test.ts shows reproduces SPICE.
// Pure TypeScript: no three.js (CLAUDE.md).
import { marsRotation, type MarsRotation } from './mars';
import type { Mat3Rows, Vec3 } from './moon';

/** One epoch. Directions are unit vectors in J2000, from Mercury's centre, light-time corrected. */
export interface MercuryEpoch {
  readonly id: string;
  readonly utc: string;
  readonly tdbSecondsPastJ2000: number;
  /** Sun-Mercury-Earth, degrees: the phase angle Earth sees Mercury at. */
  readonly phaseAngleDeg: number;
  readonly sunDirectionJ2000: Vec3;
  readonly sunDistanceKm: number;
  readonly earthDirectionJ2000: Vec3;
  readonly earthDistanceKm: number;
  readonly j2000ToBodyFixed: Mat3Rows;
}

export interface MercuryEphemeris {
  readonly body: {
    /** pck00011.tpc BODY199_RADII, km: equatorial, equatorial, polar. */
    readonly radiiKm: Vec3;
    readonly gmKm3PerS2: number;
    readonly bodyFixedFrame: string;
  };
  readonly epochs: readonly Omit<MercuryEpoch, 'phaseAngleDeg'>[];
}

export interface MercuryTimelineManifest {
  readonly fields: readonly string[];
  readonly firstSampleUtc: string;
  readonly spanUtc: readonly [string, string];
  readonly firstSampleTdbSecondsPastJ2000: number;
  readonly stepHours: number;
  readonly samples: number;
  readonly rotation: MarsRotation;
}

const DEG = Math.PI / 180;
const RECORD = 8;

const norm3 = (a: number, b: number, c: number): Vec3 => {
  const l = Math.hypot(a, b, c);
  return [a / l, b / l, c / l];
};

const phaseOf = (sun: Vec3, earth: Vec3): number =>
  Math.acos(Math.max(-1, Math.min(1, sun[0] * earth[0] + sun[1] * earth[1] + sun[2] * earth[2]))) /
  DEG;

/** Mercury at `utcMs`, or null outside the timeline's span. Runs once, not in the frame loop. */
export function mercuryEpochAt(
  manifest: MercuryTimelineManifest,
  data: Float32Array,
  utcMs: number,
): MercuryEpoch | null {
  const [from, to] = manifest.spanUtc.map((t) => Date.parse(t));
  if (from === undefined || to === undefined || !(utcMs >= from && utcMs <= to)) return null;
  if (data.length !== manifest.samples * RECORD || manifest.fields.length !== RECORD) {
    throw new Error('the Mercury timeline.bin does not match its timeline.json');
  }
  const firstMs = Date.parse(manifest.firstSampleUtc);
  const position = (utcMs - firstMs) / (manifest.stepHours * 3600_000);
  const k = Math.floor(position);
  const x = position - k;
  // 4-point Lagrange through the samples either side, as core/mars.ts.
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
  return {
    id: 'now',
    utc: new Date(utcMs).toISOString().slice(0, 19),
    tdbSecondsPastJ2000: tdb,
    phaseAngleDeg: phaseOf(sun, earth),
    sunDirectionJ2000: sun,
    sunDistanceKm: at(3),
    earthDirectionJ2000: earth,
    earthDistanceKm: at(7),
    j2000ToBodyFixed: marsRotation(manifest.rotation, tdb),
  };
}

/** A fixed epoch of ephemeris.json, with its phase angle as Earth sees Mercury. */
export function mercuryEpoch(ephemeris: MercuryEphemeris, id: string): MercuryEpoch {
  const e = ephemeris.epochs.find((x) => x.id === id);
  if (e === undefined) throw new Error(`no Mercury epoch ${id}`);
  return { ...e, phaseAngleDeg: phaseOf(e.sunDirectionJ2000, e.earthDirectionJ2000) };
}
