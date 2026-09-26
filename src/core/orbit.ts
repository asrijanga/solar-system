// Orbit mode (docs/stories/SS-11b.md): a real circular orbit around the Moon, at the lowest height
// the shipped data stays sharp from, looking ahead along the track with the horizon in view.
// Pure maths, no three.js.

export type Vec3 = readonly [number, number, number];

/** Circular orbital speed, km/s, for GM in km³/s² and orbit radius in km. */
export function circularSpeedKmS(gmKm3PerS2: number, radiusKm: number): number {
  return Math.sqrt(gmKm3PerS2 / radiusKm);
}

/** How far below the local horizontal the horizon lies from height `heightKm`, radians. */
export function horizonDip(radiusKm: number, heightKm: number): number {
  return Math.acos(radiusKm / (radiusKm + heightKm));
}

/** The horizon's place on screen: this fraction of the half-height above the centre. */
export const HORIZON_ABOVE_CENTRE = 0.35;

/** How far the view's centre looks below the local horizontal, radians, for that framing. */
export function viewDepression(radiusKm: number, heightKm: number, fovRad: number): number {
  return horizonDip(radiusKm, heightKm) + Math.atan(HORIZON_ABOVE_CENTRE * Math.tan(fovRad / 2));
}

/**
 * Distance, km, from a camera at `heightKm` to the sphere along a ray `depression` radians below
 * the local horizontal; Infinity if the ray misses.
 */
export function groundDistance(radiusKm: number, heightKm: number, depression: number): number {
  const r = radiusKm + heightKm;
  const c = Math.cos(depression);
  const disc = radiusKm * radiusKm - r * r * c * c;
  if (disc < 0) return Infinity;
  return r * Math.sin(depression) - Math.sqrt(disc);
}

/**
 * The lowest height, km, at which the nearest ground in view (the bottom edge of the frame) is
 * at least `sampleKm / (maxPxPerSample · pixelAngle)` away: every measured sample there spans at
 * most `maxPxPerSample` pixels, so nothing shown is magnified past its data.
 */
export function sharpHeightKm(
  radiusKm: number,
  sampleKm: number,
  pixelAngleRad: number,
  fovRad: number,
  maxPxPerSample: number,
): number {
  const needed = sampleKm / (maxPxPerSample * pixelAngleRad);
  const nearest = (h: number): number =>
    groundDistance(radiusKm, h, viewDepression(radiusKm, h, fovRad) + fovRad / 2);
  let lo = 1;
  let hi = 20 * radiusKm;
  if (nearest(lo) >= needed) return lo;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (nearest(mid) >= needed) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** A small seeded generator (mulberry32), so a given `?orbit=<seed>` is the same orbit. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Orbit {
  /** Orbit radius from the Moon's centre, km. */
  readonly radiusKm: number;
  /** Unit vectors spanning the orbit plane: position = r (cos θ · u + sin θ · v). */
  readonly u: Vec3;
  readonly v: Vec3;
  /** Starting angle, radians, and angular speed, radians per second of simulated time. */
  readonly theta0: number;
  readonly omega: number;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * A random circular orbit: a random plane (its normal uniform on the sphere), a random height
 * between `minHeightKm` and 1.5 times it, and a start over ground where the Sun is between
 * `sunElevationDeg` above the horizon, so the relief shows. `sun` is the unit direction to the
 * Sun in the same frame.
 */
export function randomOrbit(
  random: () => number,
  moonRadiusKm: number,
  gmKm3PerS2: number,
  minHeightKm: number,
  sun: Vec3,
  sunElevationDeg: readonly [number, number] = [8, 35],
): Orbit {
  const height = minHeightKm * (1 + 0.5 * random());
  const radiusKm = moonRadiusKm + height;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const z = 2 * random() - 1;
    const phi = 2 * Math.PI * random();
    const s = Math.sqrt(1 - z * z);
    const normal: Vec3 = [s * Math.cos(phi), s * Math.sin(phi), z];
    // Any unit vector in the plane, then the one 90° ahead of it.
    const helper: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = unit(cross(normal, helper));
    const v = cross(normal, u);
    // Where along the orbit the Sun stands in the wanted range, sampled finely.
    const good: number[] = [];
    for (let k = 0; k < 360; k++) {
      const t = (k * Math.PI) / 180;
      const up: Vec3 = [
        Math.cos(t) * u[0] + Math.sin(t) * v[0],
        Math.cos(t) * u[1] + Math.sin(t) * v[1],
        Math.cos(t) * u[2] + Math.sin(t) * v[2],
      ];
      const elevation = (Math.asin(Math.max(-1, Math.min(1, dot(up, sun)))) * 180) / Math.PI;
      if (elevation >= sunElevationDeg[0] && elevation <= sunElevationDeg[1]) good.push(t);
    }
    if (good.length === 0) continue;
    const theta0 = good[Math.floor(random() * good.length)] ?? 0;
    const direction = random() < 0.5 ? 1 : -1;
    const omega = (direction * circularSpeedKmS(gmKm3PerS2, radiusKm)) / radiusKm;
    return { radiusKm, u, v, theta0, omega };
  }
  throw new Error('no orbit passes over ground with the Sun in range');
}
