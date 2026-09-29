// Hapke's model of light scattered by a particulate surface (docs/stories/SS-8b.md): the Moon's
// photometric function, with the parameters LRO's Wide Angle Camera measured for every 1° tile
// of the surface (Sato et al. 2014, JGR Planets 119, 1775-1805, doi:10.1002/2013JE004580).
//
// The form is the one those parameters were fitted with (Hapke 2012, "Theory of Reflectance and
// Emittance Spectroscopy", 2nd ed., as cited by the product's README):
//
//   I/F = K (w/4) μ0e / (μ0e + μe) · [p(g) B_SH(g) + H(μ0e/K) H(μe/K) − 1] · B_CB(g) · S(i, e, ψ)
//
// - p(g): the double Henyey-Greenstein single-particle phase function, parameters b and c.
// - B_SH(g) = 1 + B_S0 / (1 + tan(g/2) / h_S): the shadow-hiding opposition surge.
// - H: Chandrasekhar's function for isotropic scatterers, in Hapke's (2002) approximation.
// - S, μ0e, μe: macroscopic roughness, mean slope θ̄ (Hapke 1984).
// - K, B_CB: porosity and coherent backscatter. The product fixes B_C0 = 0, so B_CB = 1. Its
//   README says the filling factor is fixed at 1.0 while the archived band holds 0.0; K is 1
//   under either reading (K → 1 as the filling factor → 0, and Sato et al. fitted without it).
//
// Angles: i incidence, e emission, g phase, ψ the azimuth between the planes of incidence and
// emission. Everything here is plain arithmetic on numbers, mirrored in TSL by
// scenes/hapkeNode.ts and checked against this file by the photometry captures.

/** The parameters Sato et al. fitted per tile, at one wavelength. */
export interface HapkeParameters {
  /** Single-scattering albedo. */
  readonly w: number;
  /** Double Henyey-Greenstein width, 0 to 1. */
  readonly b: number;
  /** Double Henyey-Greenstein backscatter fraction: positive favours backscatter. */
  readonly c: number;
  /** Shadow-hiding opposition surge amplitude. */
  readonly bs0: number;
  /** Shadow-hiding opposition surge angular width. */
  readonly hs: number;
}

/**
 * Mean slope angle θ̄, degrees: fixed by Sato et al. for every tile and band. The archived band
 * holds 23.6566 (WAC_HAPKEPARAMMAP_566NM, band 8); the README rounds it to 23.657.
 */
export const HAPKE_ROUGHNESS_DEG = 23.6566;

/**
 * Standard geometry of the Moon's map, degrees: LRO WAC's Hapke-normalised mosaic is "Normalized
 * to the angles of phase (g) = incidence (i) = 60°, emission (e) = 0° by Hapke bidirectional
 * reflectance function" (WAC_HAPKE product description; docs/stories/SS-5b.md). The map's values
 * are I/F at this geometry.
 */
export const MAP_STANDARD_DEG = { incidence: 60, emission: 0, phase: 60 } as const;

/** Floor for tangents and cosines that would otherwise divide by zero at grazing angles. */
const TINY = 1e-6;

/** Hapke's (2002) approximation to Chandrasekhar's H function for isotropic scatterers. */
export function hapkeH(x: number, w: number): number {
  const xs = Math.max(x, TINY);
  const gamma = Math.sqrt(1 - w);
  const r0 = (1 - gamma) / (1 + gamma);
  return 1 / (1 - w * xs * (r0 + ((1 - 2 * r0 * xs) / 2) * Math.log((1 + xs) / xs)));
}

/** Double Henyey-Greenstein single-particle phase function at phase angle g (cos g given). */
export function doubleHenyeyGreenstein(cosG: number, b: number, c: number): number {
  const b2 = b * b;
  const back = (1 - b2) / (1 - 2 * b * cosG + b2) ** 1.5;
  const forward = (1 - b2) / (1 + 2 * b * cosG + b2) ** 1.5;
  return ((1 + c) / 2) * back + ((1 - c) / 2) * forward;
}

/** Shadow-hiding opposition surge at phase angle g (cos g given). */
export function shadowHiding(cosG: number, bs0: number, hs: number): number {
  // tan(g/2) = sin g / (1 + cos g), with sin g >= 0 for a phase angle.
  const sinG = Math.sqrt(Math.max(0, 1 - cosG * cosG));
  const tanHalf = sinG / Math.max(1 + cosG, TINY);
  return 1 + bs0 / (1 + tanHalf / Math.max(hs, TINY));
}

/**
 * Hapke's (1984) macroscopic roughness: the effective cosines μ0e and μe and the shadowing
 * function S, for mean slope θ̄. Both of Hapke's cases (i ≤ e and e ≤ i) are evaluated and the
 * right one taken, as the shader must do without branching.
 */
export function roughness(
  mu0: number,
  mu: number,
  cosPsi: number,
  thetaBarDeg = HAPKE_ROUGHNESS_DEG,
): { readonly mu0e: number; readonly mue: number; readonly s: number } {
  const tanT = Math.tan((thetaBarDeg * Math.PI) / 180);
  const chi = 1 / Math.sqrt(1 + Math.PI * tanT * tanT);
  const sinI = Math.sqrt(Math.max(0, 1 - mu0 * mu0));
  const sinE = Math.sqrt(Math.max(0, 1 - mu * mu));
  const tanI = Math.max(sinI / Math.max(mu0, TINY), TINY);
  const tanE = Math.max(sinE / Math.max(mu, TINY), TINY);
  const e1i = Math.exp(-2 / (Math.PI * tanT * tanI));
  const e1e = Math.exp(-2 / (Math.PI * tanT * tanE));
  const e2i = Math.exp(-1 / (Math.PI * tanT * tanT * tanI * tanI));
  const e2e = Math.exp(-1 / (Math.PI * tanT * tanT * tanE * tanE));
  const etaI = chi * (mu0 + sinI * tanT * (e2i / (2 - e1i)));
  const etaE = chi * (mu + sinE * tanT * (e2e / (2 - e1e)));
  const psi = Math.acos(Math.min(1, Math.max(-1, cosPsi)));
  const sinHalfPsi2 = Math.sin(psi / 2) ** 2;
  // tan(ψ/2) grows without bound as ψ → π, where f → 0.
  const f = Math.exp(-2 * Math.tan(Math.min(psi, Math.PI - TINY) / 2));

  // i <= e
  const dA = 2 - e1e - (psi / Math.PI) * e1i;
  const mu0eA = chi * (mu0 + sinI * tanT * ((cosPsi * e2e + sinHalfPsi2 * e2i) / dA));
  const mueA = chi * (mu + sinE * tanT * ((e2e - sinHalfPsi2 * e2i) / dA));
  const sA = (mueA / etaE) * (mu0 / etaI) * (chi / (1 - f + f * chi * (mu0 / etaI)));
  // e <= i
  const dB = 2 - e1i - (psi / Math.PI) * e1e;
  const mu0eB = chi * (mu0 + sinI * tanT * ((e2i - sinHalfPsi2 * e2e) / dB));
  const mueB = chi * (mu + sinE * tanT * ((cosPsi * e2i + sinHalfPsi2 * e2e) / dB));
  const sB = (mueB / etaE) * (mu0 / etaI) * (chi / (1 - f + f * chi * (mu / etaE)));

  // i <= e exactly when μ0 >= μ.
  return mu0 >= mu ? { mu0e: mu0eA, mue: mueA, s: sA } : { mu0e: mu0eB, mue: mueB, s: sB };
}

/**
 * cos ψ, the azimuth between the planes of incidence and emission, from the three cosines:
 * cos g = μ0 μ + sin i sin e cos ψ. 1 where either plane is undefined (the Sun or the viewer
 * straight overhead), where ψ has no effect.
 */
export function cosAzimuth(mu0: number, mu: number, cosG: number): number {
  const s = Math.sqrt(Math.max(0, 1 - mu0 * mu0) * Math.max(0, 1 - mu * mu));
  if (s < TINY) return 1;
  return Math.min(1, Math.max(-1, (cosG - mu0 * mu) / s));
}

/**
 * Hapke radiance factor I/F for a surface with these parameters, lit from a direction at cosine
 * μ0 to the normal and seen at cosine μ, with phase angle g between the two directions. Zero
 * where the Sun is below the local horizon or the surface faces away.
 */
export function hapke(mu0: number, mu: number, cosG: number, p: HapkeParameters): number {
  if (mu0 <= 0 || mu <= 0) return 0;
  const { mu0e, mue, s } = roughness(mu0, mu, cosAzimuth(mu0, mu, cosG));
  const single = doubleHenyeyGreenstein(cosG, p.b, p.c) * shadowHiding(cosG, p.bs0, p.hs);
  const multiple = hapkeH(mu0e, p.w) * hapkeH(mue, p.w) - 1;
  return (p.w / 4) * (mu0e / (mu0e + mue)) * (single + multiple) * s;
}

/** I/F at the map's standard geometry: the denominator that turns its values into I/F anywhere. */
export function hapkeAtStandard(p: HapkeParameters): number {
  const { incidence, emission, phase } = MAP_STANDARD_DEG;
  const rad = Math.PI / 180;
  return hapke(Math.cos(incidence * rad), Math.cos(emission * rad), Math.cos(phase * rad), p);
}

/**
 * The Moon's disc-integrated V magnitude against phase angle, relative to zero phase:
 * m(α) = −12.73 + 0.026|α| + 4 × 10⁻⁹ α⁴, α in degrees. From Allen's Astrophysical Quantities,
 * 4th ed., ed. A. N. Cox (AIP Press / Springer, 2000; reprint 2002), as quoted with that citation
 * by arXiv:2609.07057 ("The First Observations of Moonlit Satellites"), which notes it departs
 * from the data at small phase angles because of the opposition effect.
 */
export function moonPhaseMagnitude(alphaDeg: number): number {
  const a = Math.abs(alphaDeg);
  return 0.026 * a + 4.0e-9 * a ** 4;
}
