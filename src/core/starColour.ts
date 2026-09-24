// Star colour from the B−V colour index.
//
// 1. B−V to effective temperature: Ballesteros (2012), "New insights into black bodies",
//    EPL 97 34008, eq. 14: T = 4600 K · (1/(0.92·(B−V) + 1.7) + 1/(0.92·(B−V) + 0.62)).
// 2. Temperature to CIE 1931 XYZ: Planck's law integrated against the CIE 1931 2° colour-
//    matching functions, using the multi-lobe analytic fit of Wyman, Sloan & Shirley (2013),
//    "Simple Analytic Approximations to the CIE XYZ Color Matching Functions", JCGT 2(2).
// 3. XYZ to linear sRGB with the IEC 61966-2-1 matrix (D65 white).
//
// The result is chromaticity only, scaled to unit luminance: brightness comes from the
// magnitude, colour from here. Display white is D65, so a star near 6500 K renders close to
// neutral and the Sun slightly warm. That is an authored choice about adaptation, and it is
// the same one every sRGB display makes.

/** Wyman et al. (2013) piecewise Gaussian: σ1 left of the peak, σ2 right of it. */
function lobe(lambda: number, mu: number, sigma1: number, sigma2: number): number {
  const t = (lambda - mu) / (lambda < mu ? sigma1 : sigma2);
  return Math.exp(-0.5 * t * t);
}

/** CIE 1931 2° colour-matching functions, multi-lobe fit. λ in nanometres. */
export function cie1931(lambda: number): [number, number, number] {
  const x =
    1.056 * lobe(lambda, 599.8, 37.9, 31.0) +
    0.362 * lobe(lambda, 442.0, 16.0, 26.7) -
    0.065 * lobe(lambda, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(lambda, 568.8, 46.9, 40.5) + 0.286 * lobe(lambda, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(lambda, 437.0, 11.8, 36.0) + 0.681 * lobe(lambda, 459.0, 26.0, 13.8);
  return [x, y, z];
}

const H = 6.62607015e-34; // Planck constant, J·s (exact, SI 2019)
const C = 299792458; // speed of light, m/s (exact)
const K = 1.380649e-23; // Boltzmann constant, J/K (exact, SI 2019)

/** Planck spectral radiance, up to a constant factor. λ in nanometres. */
function planck(lambdaNm: number, kelvin: number): number {
  const l = lambdaNm * 1e-9;
  return 1 / (l ** 5 * (Math.exp((H * C) / (l * K * kelvin)) - 1));
}

/** Blackbody chromaticity as CIE XYZ scaled to Y = 1. Integrated 360 to 830 nm in 1 nm steps. */
export function blackbodyXyz(kelvin: number): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let lambda = 360; lambda <= 830; lambda++) {
    const p = planck(lambda, kelvin);
    const [cx, cy, cz] = cie1931(lambda);
    x += p * cx;
    y += p * cy;
    z += p * cz;
  }
  return [x / y, 1, z / y];
}

/** CIE xy chromaticity of a blackbody. */
export function blackbodyChromaticity(kelvin: number): [number, number] {
  const [x, y, z] = blackbodyXyz(kelvin);
  const sum = x + y + z;
  return [x / sum, y / sum];
}

/** Ballesteros (2012), eq. 14. */
export function bvToKelvin(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/** IEC 61966-2-1: CIE XYZ (D65) to linear sRGB. */
export function xyzToLinearSrgb(x: number, y: number, z: number): [number, number, number] {
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

/** Rec. 709 / sRGB relative luminance of linear RGB. */
export const luminance = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Linear sRGB colour of unit luminance for a B−V index. Out-of-gamut channels clip to 0
 * before renormalising. With no B−V (the catalogue is blank for some stars) the colour is
 * neutral: nothing is invented.
 */
export function bvToLinearSrgb(bv: number | null): [number, number, number] {
  if (bv === null || Number.isNaN(bv)) return [1, 1, 1];
  const [x, y, z] = blackbodyXyz(bvToKelvin(bv));
  const rgb = xyzToLinearSrgb(x, y, z).map((c) => Math.max(0, c)) as [number, number, number];
  const l = luminance(...rgb);
  return [rgb[0] / l, rgb[1] / l, rgb[2] / l];
}
