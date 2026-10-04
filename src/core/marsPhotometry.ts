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

/**
 * Mallama & Hilton's corrections to Eq. 6, magnitudes, from their published code
 * (sourceforge.net/projects/planetary-magnitudes, Ap_Mag_Current_Version/Ap_Mag_V3.f90, SHA-256
 * 79aeb6fb…1b5b, read 2026-10-03), which takes them from Mallama (2007) Tables 6 and 8: every 10°
 * from -20° to 370°, entry k + 2 at 10 k degrees.
 * - L1, rotation: by the effective central meridian, the mean of the sub-Earth and sub-solar
 *   longitudes, in Horizons' convention for Mars, west-positive (its input file's Ob-lon,
 *   Sl-lon). Brightest (-0.060) near 120°W, Amazonis and Tharsis; faintest (+0.050) near 280°W.
 * - L2, season: by the solar longitude Ls.
 */
export const MALLAMA_L1 = [
  0.024, 0.034, 0.036, 0.045, 0.038, 0.023, 0.015, 0.011, 0.0, -0.012, -0.018, -0.036, -0.044,
  -0.059, -0.06, -0.055, -0.043, -0.041, -0.041, -0.036, -0.036, -0.018, -0.038, -0.011, 0.002,
  0.004, 0.018, 0.019, 0.035, 0.05, 0.035, 0.027, 0.037, 0.048, 0.025, 0.022, 0.024, 0.034, 0.036,
  0.045,
] as const;
export const MALLAMA_L2 = [
  -0.03, -0.017, -0.029, -0.017, -0.014, -0.006, -0.018, -0.02, -0.014, -0.03, -0.008, -0.04,
  -0.024, -0.037, -0.036, -0.032, 0.01, 0.01, -0.001, 0.044, 0.025, -0.004, -0.016, -0.008, 0.029,
  -0.054, -0.033, 0.055, 0.017, 0.052, 0.006, 0.087, 0.006, 0.064, 0.03, 0.019, -0.03, -0.017,
  -0.029, -0.017,
] as const;

/**
 * Their Stirling interpolation to fourth differences (Ap_Mag_V3.f90, Mars_Stirling), at an angle
 * in degrees from 0 to 360. The Fortran fills only three first differences but reads a fourth;
 * the Python it says it follows ("for i in range(4)") fills four, as here.
 */
export function mallamaCorrection(table: readonly number[], angleDeg: number): number {
  const a = ((angleDeg % 360) + 360) % 360;
  const zero = Math.floor(a / 10);
  const p = a / 10 - zero;
  const at = (k: number): number => table[k] ?? 0;
  const d1 = [0, 1, 2, 3].map((i) => at(i + 1 + zero) - at(i + zero));
  const d2 = [0, 1, 2].map((i) => (d1[i + 1] ?? 0) - (d1[i] ?? 0));
  const d3 = [0, 1].map((i) => (d2[i + 1] ?? 0) - (d2[i] ?? 0));
  const d4 = (d3[1] ?? 0) - (d3[0] ?? 0);
  const a4 = d4 / 24;
  const a3 = ((d3[0] ?? 0) + (d3[1] ?? 0)) / 12;
  const a2 = (d2[1] ?? 0) / 2 - a4;
  const a1 = ((d1[1] ?? 0) + (d1[2] ?? 0)) / 2 - a3;
  return at(2 + zero) + a1 * p + a2 * p * p + a3 * p ** 3 + a4 * p ** 4;
}

/** Eq. 6 with both corrections: east-positive longitudes in, as everywhere in this app. */
export function mallamaHiltonFullV(
  alphaDeg: number,
  subObserverLonEastDeg: number,
  subSolarLonEastDeg: number,
  lsDeg: number,
): number {
  const west = (east: number): number => ((-east % 360) + 360) % 360;
  const e = west(subObserverLonEastDeg);
  const s = west(subSolarLonEastDeg);
  // The effective central meridian, as their code takes it: the mean, across the short way.
  let cm = (e + s) / 2;
  if (Math.abs(e - s) > 180) cm += 180;
  if (cm >= 360) cm -= 360;
  return (
    mallamaHiltonV(alphaDeg) +
    mallamaCorrection(MALLAMA_L1, cm) +
    mallamaCorrection(MALLAMA_L2, lsDeg)
  );
}

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
  /** The drawn light curve against Mallama's L1 (SS-14 W3 part 3). */
  readonly lightCurve: {
    readonly what: string;
    readonly rmsMag: number;
    readonly rangeMag: number;
    readonly l1RangeMag: number;
    readonly points: readonly {
      readonly westDeg: number;
      readonly drawn: number;
      readonly l1: number;
    }[];
  };
  /** The drawn luminance brought to V: each band's target scaled by one common factor. */
  readonly luminance: {
    readonly weights: readonly number[];
    readonly withEachBandAtItsTarget: number;
    readonly v: number;
    readonly commonFactor: number;
    readonly why: string;
  };
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
