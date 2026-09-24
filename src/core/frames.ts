// Reference frames. Every scene is aligned to ICRF/J2000 (README, "Decisions to lock"):
// stars, the sun and context bodies all come from J2000 data, and the world rotates within
// the frame. This file holds the one mapping from ICRF to three.js's Y-up scene axes.
//
// ICRF: x towards RA 0h Dec 0 (the vernal equinox), z towards the north celestial pole,
// y completing a right-handed set (towards RA 6h Dec 0).
// Scene: three.js Y-up. North goes to +Y, the equinox to +X, RA 6h to -Z.
//
// The mapping is a rotation (determinant +1). A permutation with determinant -1 is a mirror,
// and a mirrored sky looks entirely plausible to anyone who has not memorised Orion.

/** Row-major 3x3: scene = M · icrf. */
export const ICRF_TO_SCENE = [1, 0, 0, 0, 0, 1, 0, -1, 0] as const;

export function icrfToScene(
  x: number,
  y: number,
  z: number,
  out: Float32Array | number[],
  offset = 0,
): void {
  const m = ICRF_TO_SCENE;
  out[offset] = m[0] * x + m[1] * y + m[2] * z;
  out[offset + 1] = m[3] * x + m[4] * y + m[5] * z;
  out[offset + 2] = m[6] * x + m[7] * y + m[8] * z;
}

/** ICRF unit vector for a right ascension and declination in degrees. */
export function raDecToIcrf(raDeg: number, decDeg: number): [number, number, number] {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

/** Scene-frame unit vector for a right ascension and declination in degrees. */
export function raDecToScene(raDeg: number, decDeg: number): [number, number, number] {
  const [x, y, z] = raDecToIcrf(raDeg, decDeg);
  const out = [0, 0, 0];
  icrfToScene(x, y, z, out);
  return out as [number, number, number];
}

/** Angle between two unit vectors, in degrees. Stable for small angles. */
export function angularSeparationDeg(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (Math.atan2(Math.hypot(cx, cy, cz), dot) * 180) / Math.PI;
}
