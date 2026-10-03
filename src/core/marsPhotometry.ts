// Mars's brightness: its measured disc-integrated magnitude, and the scattering law fitted to it
// (docs/stories/SS-14.md, W7; tools/data/marsPhotometry.ts writes public/data/mars/photometry.json).

/**
 * Mars's V magnitude at 1 AU from the Sun and from the viewer, against phase angle α in degrees:
 * Mallama & Hilton (2018), Astronomy and Computing 25, arXiv:1808.01973, Eq. 6, after Mallama
 * (2007), Icarus 192, 404. Read from the arXiv copy, 2026-10-03.
 */
export const MALLAMA_HILTON_2018 = {
  source:
    'Mallama & Hilton (2018), "Computing apparent planetary magnitudes for The Astronomical Almanac", Astronomy and Computing 25, doi:10.1016/j.ascom.2018.08.002, arXiv:1808.01973, Eq. 6',
  formula:
    'V = 5 log10(r d) - 1.601 + 0.02267 a - 0.0001302 a^2 + L(lambda_e) + L(Ls), a <= 50 deg',
  v10: -1.601,
  linear: 0.02267,
  quadratic: -0.0001302,
  validToDeg: 50,
  leftOut:
    'L(lambda_e), "RMS variation over longitude ... about 0.035 magnitude with excursions as large as 0.060", and L(Ls): their tables are in Mallama (2007), not read',
} as const;

/**
 * Mars's geometric albedos by band: Mallama, Krobusek and Pavlov (2017), "Comprehensive wide-band
 * magnitudes and albedos for the planets", Icarus 282, 19, arXiv:1609.05048, Table 7, read from
 * the arXiv copy 2026-10-03. Johnson-Cousins: U 0.060, B 0.088, V 0.170, R 0.288, I 0.330,
 * RC 0.250, IC 0.285; Sloan: u' 0.061, g' 0.111, r' 0.245, i' 0.298, z' 0.325.
 */
export const MALLAMA_2017 = {
  source:
    'Mallama, Krobusek & Pavlov (2017), "Comprehensive wide-band magnitudes and albedos for the planets", Icarus 282, 19-33, doi:10.1016/j.icarus.2016.09.023, arXiv:1609.05048, Table 7',
} as const;

/**
 * The band each of the map's wavelengths is calibrated to: the one whose centre is nearest
 * (Johnson B about 440 nm, V about 550 nm; Sloan i' about 760 nm, z' about 910 nm).
 */
export const MARS_GEOMETRIC_ALBEDO = {
  440: { band: 'Johnson B', p: 0.088 },
  530: { band: 'Johnson V', p: 0.17 },
  750: { band: "Sloan i'", p: 0.298 },
  970: { band: "Sloan z'", p: 0.325 },
} as const;

/** The phase angles Eq. 6 holds for, degrees. */
export const ALPHA_MAX_DEG = MALLAMA_HILTON_2018.validToDeg;

/** Eq. 6 without its longitude and season terms, at 1 AU from the Sun and the viewer. */
export function mallamaHiltonV(alphaDeg: number): number {
  const a = Math.abs(alphaDeg);
  const m = MALLAMA_HILTON_2018;
  return m.v10 + m.linear * a + m.quadratic * a * a;
}

/** public/data/mars/photometry.json. */
export interface MarsPhotometry {
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
  /** The geometry the albedo map's values are I/F / μ0 at. */
  readonly normalisation: {
    readonly incidenceDeg: number;
    readonly emissionDeg: number;
    readonly phaseDeg: number;
    readonly why: string;
  };
  readonly fittedTo: typeof MALLAMA_HILTON_2018;
  readonly albedoAreaMean: number;
  readonly shapeRmsMag: number;
  readonly zeroPhaseMagnitudeUncalibrated: {
    readonly built: number;
    readonly mallamaHilton: number;
  };
  /** Per band: the factor that brings the map's built geometric albedo to Mars's. */
  readonly calibration: readonly {
    readonly nm: number;
    readonly band: string;
    readonly target: number;
    readonly built: number;
    readonly factor: number;
  }[];
  readonly calibrationSource: string;
  readonly curve: readonly {
    readonly alphaDeg: number;
    readonly built: number;
    readonly mallamaHilton: number;
  }[];
  readonly normalisationTried: readonly {
    readonly incidenceDeg: number;
    readonly b: number;
    readonly thetaBarDeg: number;
    readonly shapeRmsMag: number;
    readonly zeroPhaseMagnitudeUncalibrated: number;
  }[];
  readonly method: Readonly<Record<string, unknown>>;
}
