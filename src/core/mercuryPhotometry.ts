// Mercury's brightness: its measured disc-integrated magnitude, and the scattering law fitted to
// it (docs/stories/SS-16.md, W7; tools/data/mercuryPhotometry.ts writes
// public/data/mercury/photometry.json). Pure TypeScript: no three.js (CLAUDE.md).

/**
 * Mercury's V magnitude at 1 AU from the Sun and from the viewer, against phase angle α in degrees:
 * Mallama & Hilton (2018), Astronomy and Computing 25, arXiv:1808.01973, Eq. 2, read from the
 * arXiv copy 2026-10-05 (docs/data/mercury.md): "V = 5 log10 ( r d ) -0.613 + 6.3280E-02 α -
 * 1.6336E-03 α2 + 3.3644E-05 α3 – 3.4265E-07 α4 + 1.6893E-09 α5 – 3.0334E-12 α6", observed over
 * "2.1o < α < 169.5o".
 */
export const MERCURY_MALLAMA_HILTON_2018 = {
  source:
    'Mallama & Hilton (2018), "Computing apparent planetary magnitudes for The Astronomical Almanac", Astronomy and Computing 25, doi:10.1016/j.ascom.2018.08.002, arXiv:1808.01973, Eq. 2',
  formula:
    'V = 5 log10(r d) - 0.613 + 6.3280E-02 a - 1.6336E-03 a^2 + 3.3644E-05 a^3 - 3.4265E-07 a^4 + 1.6893E-09 a^5 - 3.0334E-12 a^6, 2.1 < a < 169.5 deg',
  coefficients: [-0.613, 6.328e-2, -1.6336e-3, 3.3644e-5, -3.4265e-7, 1.6893e-9, -3.0334e-12],
  validFromDeg: 2.1,
  validToDeg: 169.5,
} as const;

/** Eq. 2 at 1 AU from the Sun and the viewer. */
export function mercuryV(alphaDeg: number): number {
  const a = Math.abs(alphaDeg);
  return MERCURY_MALLAMA_HILTON_2018.coefficients.reduce((sum, c, k) => sum + c * a ** k, 0);
}

/**
 * Mercury's geometric albedos by band: Mallama, Krobusek and Pavlov (2017), Icarus 282, 19,
 * arXiv:1609.05048, Table 7, read 2026-10-05 (docs/data/mercury.md): Johnson U 0.087, B 0.105,
 * V 0.142, R 0.172, I 0.208; Sloan u' 0.095, g' 0.130, r' 0.169, i' 0.200, z' 0.237. Each map band
 * is calibrated to the one nearest it (Johnson B about 445 nm; Sloan i' about 763 nm, z' about
 * 913 nm; nothing nearer 1000 nm was measured).
 */
export const MERCURY_GEOMETRIC_ALBEDO = {
  430: { band: 'Johnson B', p: 0.105 },
  750: { band: "Sloan i'", p: 0.2 },
  1000: { band: "Sloan z'", p: 0.237 },
} as const;
export const MERCURY_V_ALBEDO_2017 = 0.142;

/** public/data/mercury/photometry.json. */
export interface MercuryPhotometry {
  readonly story: string;
  readonly law: {
    readonly form: string;
    readonly w: number;
    readonly b: number;
    readonly c: number;
    readonly bs0: number;
    readonly hs: number;
    readonly thetaBarDeg: number;
  };
  /** The geometry the albedo map's values are I/F at (MDIS: i = 30, e = 0, g = 30 degrees). */
  readonly normalisation: {
    readonly incidenceDeg: number;
    readonly emissionDeg: number;
    readonly phaseDeg: number;
    readonly why: string;
  };
  /** Per band: the factor that brings the map's built geometric albedo to Mercury's. */
  readonly calibration: readonly {
    readonly nm: number;
    readonly band: string;
    readonly target: number;
    readonly built: number;
    readonly factor: number;
  }[];
  readonly shapeRmsMag: number;
  readonly curve: readonly {
    readonly alphaDeg: number;
    readonly built: number;
    readonly mallamaHilton: number;
  }[];
  readonly [key: string]: unknown;
}
