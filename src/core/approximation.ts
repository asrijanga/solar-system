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

// Small craters, below what Kaguya resolves: NASA's Design Specification for Natural
// Environments, SLS-SPEC-159 Revision I (2021), section 3.4.1 (NTRS 20210024522), read for this.
//
// Density (section 3.4.1.1): N(≥D) = 0.079433 D^-2 per km², D in km, the Trask equilibrium
// function. "For sub-100m craters, this Trask equilibrium function is a valuable upper limit for
// the number of craters on a surface of any age", reached "on every part of the Moon" except
// very young surfaces, and "appropriate for design to extrapolate … to sizes smaller than 10m".
// Its table: 794 craters ≥ 10 m per km².
//
// Shape (Table 3.4.1.2-2, sub-km craters on a typical surface, after Basilevsky 1976): five
// classes from freshest to degraded, their fraction of the population and depth/diameter ratio.

/** N(≥D) per km² with D in km (DSNE 3.4.1.1). */
export const TRASK_COEFFICIENT = 0.079433;
/** Craters added: 2 m up to twice Kaguya's sample spacing (16.8 m); larger ones it measures. */
export const CRATER_MIN_M = 2;
export const CRATER_MAX_M = (2 * ((Math.PI / 180) * 1_737_400)) / MEASURED_PPD;

/**
 * DSNE Table 3.4.1.2-2: fraction of the population and depth/diameter range, freshest first.
 * The open-ended entries ("0.12-0.2+" and "<0.07") are taken as 0.12-0.20 and 0.02-0.07.
 */
export const CRATER_CLASSES: readonly {
  fraction: number;
  depthRatio: readonly [number, number];
}[] = [
  { fraction: 0.005, depthRatio: [0.12, 0.2] },
  { fraction: 0.025, depthRatio: [0.12, 0.2] },
  { fraction: 0.17, depthRatio: [0.1, 0.15] },
  { fraction: 0.3, depthRatio: [0.07, 0.1] },
  { fraction: 0.5, depthRatio: [0.02, 0.07] },
];

const R_M = 1_737_400;
const CELL_DEG = 1 / MEASURED_PPD;

/** Craters (km⁻²) with diameters between CRATER_MIN_M and CRATER_MAX_M, from the Trask law. */
export function craterDensityPerKm2(): number {
  const dMin = CRATER_MIN_M / 1000;
  const dMax = CRATER_MAX_M / 1000;
  return TRASK_COEFFICIENT * (dMin ** -2 - dMax ** -2);
}

/** Poisson count for mean `lambda` from a uniform in [0, 1). */
function poisson(lambda: number, u: number): number {
  let k = 0;
  let p = Math.exp(-lambda);
  let cumulative = p;
  while (u > cumulative && k < 50) {
    k++;
    p *= lambda / k;
    cumulative += p;
  }
  return k;
}

const unit = (i: number, j: number, k: number): number => (hashUnit(i, j, k) + 1) / 2;

interface Crater {
  readonly lat: number;
  readonly lon: number;
  readonly radiusM: number;
  readonly depthM: number;
}

/** Recently used cells' craters: generating them is the costly part, and neighbours share. */
const cellCraters = new Map<number, readonly Crater[]>();
const CELL_CACHE = 1 << 16;

/**
 * The craters of one Kaguya lattice cell: a Poisson count for the Trask density over the cell's
 * area, positions, diameters from the truncated power law, and each one's class and depth, all
 * from a hash of the cell.
 */
function cratersIn(i: number, j: number): readonly Crater[] {
  const key = j * 360 * MEASURED_PPD + i;
  const hit = cellCraters.get(key);
  if (hit !== undefined) return hit;
  const metresPerDeg = (Math.PI / 180) * R_M;
  const cellLat = (j + 0.5) * CELL_DEG - 90;
  const sideKm = (CELL_DEG * metresPerDeg) / 1000;
  const areaKm2 = sideKm * sideKm * Math.cos((cellLat * Math.PI) / 180);
  const count = poisson(craterDensityPerKm2() * areaKm2, unit(i, j, 101));
  const dMin2 = CRATER_MIN_M ** -2;
  const dMax2 = CRATER_MAX_M ** -2;
  const craters: Crater[] = [];
  for (let n = 0; n < count; n++) {
    const seed = 1000 + n * 8;
    const d = (dMin2 - unit(i, j, seed + 2) * (dMin2 - dMax2)) ** -0.5;
    let pick = unit(i, j, seed + 3);
    let depthRange = CRATER_CLASSES[CRATER_CLASSES.length - 1]?.depthRatio ?? [0.02, 0.07];
    for (const c of CRATER_CLASSES) {
      if (pick < c.fraction) {
        depthRange = c.depthRatio;
        break;
      }
      pick -= c.fraction;
    }
    const ratio = depthRange[0] + unit(i, j, seed + 4) * (depthRange[1] - depthRange[0]);
    craters.push({
      lon: (i + unit(i, j, seed)) * CELL_DEG,
      lat: (j + unit(i, j, seed + 1)) * CELL_DEG - 90,
      radiusM: d / 2,
      depthM: ratio * d,
    });
  }
  if (cellCraters.size >= CELL_CACHE) {
    const oldest = cellCraters.keys().next().value;
    if (oldest !== undefined) cellCraters.delete(oldest);
  }
  cellCraters.set(key, craters);
  return craters;
}

/**
 * Height change of the crater field (m, ≤ 0) at a place: every crater from the cells around it,
 * each a parabolic bowl of its class's depth. Craters are placed per Kaguya lattice cell by a
 * hash of the cell, so the field is fixed in place.
 */
export function craterField(latDeg: number, lonDeg: number): number {
  const lon = ((lonDeg % 360) + 360) % 360;
  const wrap = 360 * MEASURED_PPD;
  const ci = Math.floor(lon / CELL_DEG);
  const cj = Math.floor((latDeg + 90) / CELL_DEG);
  const metresPerDegLat = (Math.PI / 180) * R_M;
  const metresPerDegLon = metresPerDegLat * Math.cos((latDeg * Math.PI) / 180);
  // Cells narrow in longitude towards the poles; search far enough east and west to reach
  // every crater whose rim could cover this place.
  const spanI = Math.ceil(1 / Math.max(Math.cos((latDeg * Math.PI) / 180), 0.05)) + 1;
  let h = 0;
  for (let di = -spanI; di <= spanI; di++) {
    const i = (((ci + di) % wrap) + wrap) % wrap;
    for (let dj = -2; dj <= 2; dj++) {
      for (const crater of cratersIn(i, cj + dj)) {
        let dLon = lon - crater.lon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        const x = dLon * metresPerDegLon;
        const y = (latDeg - crater.lat) * metresPerDegLat;
        const r2 = (x * x + y * y) / (crater.radiusM * crater.radiusM);
        if (r2 < 1) h -= crater.depthM * (1 - r2);
      }
    }
  }
  return h;
}

/** The crater field minus its bilinear interpolation from the measured lattice. */
export function bandLimitedCraters(latDeg: number, lonDeg: number): number {
  const lon = ((lonDeg % 360) + 360) % 360;
  const u = lon * MEASURED_PPD;
  const v = (latDeg + 90) * MEASURED_PPD;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const at = (di: number, dj: number): number =>
    craterField((j + dj) / MEASURED_PPD - 90, (i + di) / MEASURED_PPD);
  const a = at(0, 0);
  const b = at(1, 0);
  const c = at(0, 1);
  const d = at(1, 1);
  const bilinear = a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
  return craterField(latDeg, lonDeg) - bilinear;
}
