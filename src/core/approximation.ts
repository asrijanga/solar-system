// Approximated detail below the finest measurement (docs/stories/SS-10b.md). An owner-approved
// exception to "Never invent data": off by default, labelled on screen while on, never in a
// check. Pure maths, no three.js, so it can be tested alone.
//
// The detail is value noise on lattices finer than Kaguya's sample lattice (1/3600 degree),
// minus its own bilinear interpolation from that lattice: it is exactly zero at every Kaguya
// sample, so the approximated surface passes through every measurement, and it only adds
// variation shorter than the measured spacing. It is a function of position alone, so the same
// place always looks the same and neighbouring tiles agree.

/** Samples per degree of the measured lattice the detail is pinned to (Kaguya TC, 8.4 m). */
export const MEASURED_PPD = 3600;
/** Octaves of detail: lattices 2, 4 and 8 times finer than the measured one (4.2 to 1.05 m). */
export const OCTAVES = 3;

/** A well-mixed 32-bit hash of three integers, as a value in [-1, 1]. */
export function hashUnit(i: number, j: number, k: number): number {
  let h =
    Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x7fffffff - 1;
}

/** Quintic fade: value noise with continuous first and second derivatives. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Value noise of octave `k` (lattice MEASURED_PPD · 2^k per degree) at a lattice position
 * (u east, v north, in lattice units; u wraps at 360 degrees).
 */
function valueNoise(u: number, v: number, k: number, wrap: number): number {
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const fu = u - i0;
  const fv = v - j0;
  const i = ((i0 % wrap) + wrap) % wrap;
  const i1 = (i + 1) % wrap;
  const a = hashUnit(i, j0, k);
  const b = hashUnit(i1, j0, k);
  const c = hashUnit(i, j0 + 1, k);
  const d = hashUnit(i1, j0 + 1, k);
  const su = fade(fu);
  const sv = fade(fv);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** Octave `k`'s noise minus its bilinear interpolation from the measured lattice. */
export function bandLimitedOctave(latDeg: number, lonDeg: number, k: number): number {
  const scale = 2 ** k;
  const lon = ((lonDeg % 360) + 360) % 360;
  const u = lon * MEASURED_PPD * scale;
  const v = (latDeg + 90) * MEASURED_PPD * scale;
  const wrap = 360 * MEASURED_PPD * scale;
  const noise = valueNoise(u, v, k, wrap);
  // The measured lattice point below and to the west, in this octave's lattice units: every
  // measured point is also a lattice point of each finer octave, where the noise is its hash.
  const uc = Math.floor(u / scale) * scale;
  const vc = Math.floor(v / scale) * scale;
  const fu = (u - uc) / scale;
  const fv = (v - vc) / scale;
  const at = (du: number, dv: number): number =>
    hashUnit((((uc + du * scale) % wrap) + wrap) % wrap, vc + dv * scale, k);
  const a = at(0, 0);
  const b = at(1, 0);
  const c = at(0, 1);
  const d = at(1, 1);
  const bilinear = a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
  return noise - bilinear;
}

/**
 * Approximated detail in metres at a place: the octaves weighted by `amplitudes` (metres per
 * unit of octave noise, octaves 1 to OCTAVES). Zero at every measured sample.
 */
export function detailM(latDeg: number, lonDeg: number, amplitudes: readonly number[]): number {
  let sum = 0;
  for (let k = 1; k <= OCTAVES; k++) {
    const a = amplitudes[k - 1] ?? 0;
    if (a !== 0) sum += a * bandLimitedOctave(latDeg, lonDeg, k);
  }
  return sum;
}
