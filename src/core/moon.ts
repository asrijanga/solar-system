// The Moon's geometry at an epoch, from the SS-5 manifest (public/data/moon/ephemeris.json).
//
// Frames. The body-fixed frame is MOON_ME (mean Earth/polar axis): +x towards longitude 0 on
// the equator, +z towards the north pole, longitudes planetocentric and east-positive. The
// manifest's `j2000ToBodyFixed` is SPICE's pxform("J2000", "MOON_ME") at the epoch, row-major,
// so body = M · j2000 and, M being a rotation, j2000 = Mᵀ · body. Scene axes come from
// core/frames.ts. The Moon's centre is the scene origin.
import { ICRF_TO_SCENE } from './frames';

export type Vec3 = readonly [number, number, number];
export type Mat3Rows = readonly [Vec3, Vec3, Vec3];

/** One epoch of the manifest. Directions are unit vectors in J2000, from the Moon's centre. */
export interface MoonEpoch {
  readonly id: string;
  readonly utc: string;
  readonly phaseAngleDeg: number;
  readonly sunDirectionJ2000: Vec3;
  readonly sunDistanceKm: number;
  readonly earthDirectionJ2000: Vec3;
  readonly earthDistanceKm: number;
  readonly j2000ToBodyFixed: Mat3Rows;
}

export interface MoonEphemeris {
  readonly body: { readonly radiiKm: Vec3; readonly bodyFixedFrame: string };
  readonly epochs: readonly MoonEpoch[];
}

/** Body-fixed unit vector for planetocentric, east-positive longitude and latitude. */
export function lonLatToBodyFixed(lonDeg: number, latDeg: number): [number, number, number] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** j2000 = Mᵀ · body. */
export function bodyFixedToJ2000(epoch: MoonEpoch, v: Vec3): [number, number, number] {
  const m = epoch.j2000ToBodyFixed;
  return [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
  ];
}

export function j2000ToScene(v: Vec3): [number, number, number] {
  const s = ICRF_TO_SCENE;
  return [
    s[0] * v[0] + s[1] * v[1] + s[2] * v[2],
    s[3] * v[0] + s[4] * v[1] + s[5] * v[2],
    s[6] * v[0] + s[7] * v[1] + s[8] * v[2],
  ];
}

/**
 * Row-major 3x3 rotation taking body-fixed vectors to scene vectors: S · Mᵀ. The Moon mesh's
 * object space is the body-fixed frame, so this is its model matrix.
 */
export function bodyFixedToSceneMatrix(epoch: MoonEpoch): number[] {
  const out: number[] = [];
  const columns = [
    j2000ToScene(bodyFixedToJ2000(epoch, [1, 0, 0])),
    j2000ToScene(bodyFixedToJ2000(epoch, [0, 1, 0])),
    j2000ToScene(bodyFixedToJ2000(epoch, [0, 0, 1])),
  ] as const;
  for (let row = 0; row < 3; row++) {
    for (const column of columns) out.push(column[row] ?? 0);
  }
  return out;
}

/** Where a camera looks at the Moon from: Earth's direction at the epoch, or over a point. */
export type MoonVantage =
  | { readonly kind: 'earth' }
  | { readonly kind: 'over'; readonly lonDeg: number; readonly latDeg: number };

export interface MoonViewPose {
  /** Scene km. The camera looks at the Moon's centre, the origin. */
  readonly position: [number, number, number];
  /** The Moon's north pole in scene axes, so lunar north is up on screen. */
  readonly up: [number, number, number];
}

export function moonViewPose(
  epoch: MoonEpoch,
  vantage: MoonVantage,
  distanceKm: number,
): MoonViewPose {
  const direction =
    vantage.kind === 'earth'
      ? epoch.earthDirectionJ2000
      : bodyFixedToJ2000(epoch, lonLatToBodyFixed(vantage.lonDeg, vantage.latDeg));
  const [x, y, z] = j2000ToScene(direction);
  return {
    position: [x * distanceKm, y * distanceKm, z * distanceKm],
    up: j2000ToScene(bodyFixedToJ2000(epoch, [0, 0, 1])),
  };
}

export function findEpoch(ephemeris: MoonEphemeris, id: string): MoonEpoch {
  const epoch = ephemeris.epochs.find((e) => e.id === id);
  if (epoch === undefined) throw new Error(`no Moon epoch "${id}" in the manifest`);
  return epoch;
}
