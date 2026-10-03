// The Moon's colour on screen, from LRO WAC's measured bands (docs/stories/SS-5b.md).
//
// The map holds, per point, I/F in four bands relative to 566 nm: 415, 566 (1 by definition),
// 643 and 689 nm. The reflectance spectrum between them is taken as linear in wavelength, and
// flat beyond the outer bands. Lit by sunlight, it is converted to linear sRGB with the CIE 1931
// colour-matching functions and the IEC 61966-2-1 matrix (core/starColour.ts), and then
// white-balanced to sunlight: a surface reflecting every wavelength equally shows as grey, as a
// camera set for daylight shows it. Brightness stays I/F at 566 nm; this is only the tint.
//
// Everything is linear in the band ratios, so each display channel is a fixed weighted sum of
// them: tint_c = Σ_k W[c][k] · ratio_k, with each row of W summing to 1. The shader uses W.

import { cie1931, xyzToLinearSrgb } from './starColour.ts';

/** WAC bands in the colour map, nm, in the order of the weights' columns. */
export const COLOUR_BANDS_NM = [415, 566, 643, 689] as const;

/** IAU 2015 Resolution B3: the nominal solar effective temperature, K. */
export const SUN_EFFECTIVE_TEMPERATURE_K = 5772;

const H = 6.62607015e-34;
const C = 299792458;
const K = 1.380649e-23;

/** Sunlight's spectrum, as a blackbody at the Sun's effective temperature, up to a constant. */
export function sunlight(lambdaNm: number): number {
  const l = lambdaNm * 1e-9;
  return 1 / (l ** 5 * (Math.exp((H * C) / (l * K * SUN_EFFECTIVE_TEMPERATURE_K)) - 1));
}

/**
 * The tent functions that interpolate linearly between the bands, flat beyond them. The Moon's
 * WAC bands unless given (Mars's map: 440, 530, 750, 970 nm).
 */
export function bandBasis(lambdaNm: number, b: readonly number[] = COLOUR_BANDS_NM): number[] {
  const out = b.map(() => 0);
  if (lambdaNm <= (b[0] ?? 0)) {
    out[0] = 1;
    return out;
  }
  const last = b.length - 1;
  if (lambdaNm >= (b[last] ?? 0)) {
    out[last] = 1;
    return out;
  }
  for (let k = 0; k < last; k++) {
    const lo = b[k] ?? 0;
    const hi = b[k + 1] ?? 0;
    if (lambdaNm >= lo && lambdaNm <= hi) {
      const t = (lambdaNm - lo) / (hi - lo);
      out[k] = 1 - t;
      out[k + 1] = t;
      break;
    }
  }
  return out;
}

/**
 * W[c][k]: display channel c (linear sRGB red, green, blue) per unit ratio in band k.
 * Integrated 360 to 830 nm in 1 nm steps.
 */
export function colourWeights(bandsNm: readonly number[] = COLOUR_BANDS_NM): number[][] {
  const bands = bandsNm.length;
  const numerator = [0, 1, 2].map(() => new Array<number>(bands).fill(0));
  const denominator = [0, 0, 0];
  for (let lambda = 360; lambda <= 830; lambda++) {
    const s = sunlight(lambda);
    const rgb = xyzToLinearSrgb(...cie1931(lambda));
    const basis = bandBasis(lambda, bandsNm);
    for (let c = 0; c < 3; c++) {
      const w = s * (rgb[c] ?? 0);
      denominator[c] = (denominator[c] ?? 0) + w;
      const row = numerator[c] ?? [];
      for (let k = 0; k < bands; k++) row[k] = (row[k] ?? 0) + w * (basis[k] ?? 0);
    }
  }
  return numerator.map((row, c) => row.map((v) => v / (denominator[c] ?? 1)));
}

/** The display tint of a point with these band ratios (415, 566 = 1, 643, 689 nm). */
export function tint(
  ratios: readonly number[],
  weights = colourWeights(),
): [number, number, number] {
  return weights.map((row) => row.reduce((sum, w, k) => sum + w * (ratios[k] ?? 0), 0)) as [
    number,
    number,
    number,
  ];
}
