// npm run pipeline:mars:photometry
//
// Mars's scattering law, fitted to Mars's own measured brightness (docs/stories/SS-14.md, W7;
// owner, 2026-10-03: "A. Fit to Mars's curve"). Writes public/data/mars/photometry.json.
//
// What it is fitted to: Mars's disc-integrated V magnitude against phase angle, Mallama & Hilton
// (2018), Astronomy and Computing 25, arXiv:1808.01973, Eq. 6, after Mallama (2007), Icarus 192,
// 404: V(1, α) = −1.601 + 0.02267 α − 0.0001302 α², "valid for α ≤ 50°". Its longitude and season
// terms, L(λe) and L(Ls), are left out: the fit averages the map over every longitude seen from
// the equator, where the longitude term averages to nothing.
//
// The surface: I/F = A · μ0s · R(i, e, g) / R(i_s, 0, i_s), with A the albedo map (W3) and R one
// Hapke law (core/hapke.ts) for the whole planet. A is OMEGA's "I/F/cos(i) … assuming a
// lambertian surface", from "near-nadir pointing mode (emergence angle <15°)" and "an incidence
// <75°" (Ody et al. 2012, JGR 117, E00J14, §2.2 and §3.1). So the law is normalised at e = 0 and
// g = i = i_s, and its i_s is a choice: the map averages incidences between 0° and 75° that the
// paper does not tabulate. The choice's effect is measured here and recorded (NORMALISATION_DEG).
//
// What is fitted and what is not:
// - The shape is fitted with the map's albedo scale as W3 left it. That built Mars 0.30 mag
//   brighter than Eq. 6 at zero phase, so each band is then calibrated, by one factor, to Mars's
//   measured geometric albedo (owner, 2026-10-03, "Calibrate to Mallama"; docs/world-recipe.md W3:
//   "calibrated to the published geometric albedo"). The map's pattern is unchanged.
// - Fitted: the shape of the law against the shape of Eq. 6 between 0° and 50°: a single-lobed
//   Henyey-Greenstein asymmetry b (c = 1), the mean slope θ̄, and the opposition surge B_S0, h_S.
//   Without the surge the best shape misses Eq. 6 by 0.086 mag RMS; with it, 0.018 (2026-10-03).
//   Eq. 6 is a slope and a curvature, so the four terms are not separately determined: the fit
//   is a law that reproduces Mars's measured curve, not a measurement of its grains.
// - w is not free: it is the single-scattering albedo whose own I/F/μ0 at the normalisation
//   geometry equals the map's mean, so the H functions have the planet's mean brightness.
//
// The magnitude: V(1, α) = V_sun − 2.5 log10(p Φ(α) · a c / AU²), with p Φ(α) the disc's I/F
// summed over its projected area and divided by the area of the ellipse it projects to, π a c
// seen from the equator (pck00011.tpc radii, public/data/mars/ephemeris.json).
//
// Python is used only to read the lossless WebP map (pillow); everything else is here, with the
// unit-tested Hapke functions the shader mirrors.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hapke, type HapkeParameters } from '../../src/core/hapke.ts';
import { colourWeights } from '../../src/core/moonColour.ts';
import { AU_KM, SUN_V_MAGNITUDE } from '../../src/core/photometry.ts';
import {
  ALPHA_MAX_DEG,
  MALLAMA_L1,
  mallamaCorrection,
  MALLAMA_2017,
  MARS_GEOMETRIC_ALBEDO,
  MALLAMA_HILTON_2018,
  mallamaHiltonV,
  type MarsPhotometry,
} from '../../src/core/marsPhotometry.ts';

const root = join(import.meta.dirname, '..', '..');
const cache = join(root, 'pipeline', '.cache');
const albedoPath = join(root, 'public', 'data', 'mars', 'albedo.webp');
const out = join(root, 'public', 'data', 'mars', 'photometry.json');

/** The map read in blocks of BLOCK x BLOCK pixels: 128 x 64 cells of 2.8125°: ample for a whole-disc integral. */
const BLOCK = 64;
/** Sub-observer longitudes averaged over, degrees apart. */
const LONGITUDE_STEP_DEG = 30;
/** Phase angles fitted, degrees. */
const PHASES_DEG = Array.from({ length: 11 }, (_, k) => 5 * k);
/** The normalisation incidence used, and the others measured to show the choice's effect. */
const NORMALISATION_DEG = 30;
const NORMALISATION_TRIED_DEG = [15, 30, 45, 60];

/** The map's bands, nm, in the order the grid holds them (public/data/mars/albedo.json). */
const BANDS_NM = [440, 530, 750, 970] as const;

/**
 * Block means of the map's reflectance in each band, row 0 at the north: R(530) from albedo.webp
 * (byte = 255 sqrt(R / 1.2)), the others R(530) times HRSC's ratios from albedo-colour.png (each
 * byte linear over its range), multiplied at the colour file's 2048 x 1024 before averaging.
 */
function albedoGrid(): { bands: Float64Array[]; cols: number; rows: number } {
  const file = join(cache, `mars-albedo-bands-block${BLOCK}.f64`);
  const width = 8192 / BLOCK;
  const height = 4096 / BLOCK;
  if (!existsSync(file)) {
    mkdirSync(cache, { recursive: true });
    const manifest = JSON.parse(
      readFileSync(join(root, 'public', 'data', 'mars', 'albedo.json'), 'utf8'),
    ) as { colour: { ranges: Record<string, readonly [number, number]> } };
    const range = (key: string): string => JSON.stringify(manifest.colour.ranges[key]);
    const code = [
      'import sys, numpy as np',
      'from PIL import Image',
      `b = np.asarray(Image.open(sys.argv[1]).convert('L'), dtype=np.float64)`,
      `r530 = (1.2 * (b / 255.0) ** 2).reshape(1024, 4, 2048, 4).mean(axis=(1, 3))`,
      `c = np.asarray(Image.open(sys.argv[2]).convert('RGB'), dtype=np.float64) / 255.0`,
      `lin = lambda v, lo_hi: lo_hi[0] + (lo_hi[1] - lo_hi[0]) * v`,
      `bands = [r530 * lin(c[..., 1], ${range('440/530')}), r530, r530 * lin(c[..., 0], ${range('750/530')}), r530 * lin(c[..., 2], ${range('970/530')})]`,
      `k = ${BLOCK / 4}`,
      `out = np.stack([x.reshape(${height}, k, ${width}, k).mean(axis=(1, 3)) for x in bands])`,
      `open(sys.argv[3], 'wb').write(out.astype('<f8').tobytes())`,
    ].join('\n');
    execFileSync(
      'uv',
      [
        'run',
        '--project',
        join(root, 'pipeline'),
        'python',
        '-c',
        code,
        albedoPath,
        join(root, 'public', 'data', 'mars', 'albedo-colour.png'),
        file,
      ],
      { stdio: 'inherit' },
    );
  }
  const bytes = readFileSync(file);
  const all = new Float64Array(bytes.buffer, bytes.byteOffset, 4 * width * height);
  const bands = BANDS_NM.map((_, k) => all.subarray(k * width * height, (k + 1) * width * height));
  return { bands, cols: width, rows: height };
}

interface Ephemeris {
  readonly body: { readonly radiiKm: readonly [number, number, number] };
}

const grid = albedoGrid();
const green = grid.bands[1] ?? new Float64Array(0);
const ephemeris = JSON.parse(
  readFileSync(join(root, 'public', 'data', 'mars', 'ephemeris.json'), 'utf8'),
) as Ephemeris;
const [aKm, , cKm] = ephemeris.body.radiiKm;
const RAD = Math.PI / 180;

// Each cell's unit normal (a sphere: the disc integral's shape effect of the 0.6% flattening is
// below the fit's resolution) and its area as a fraction of the sphere's.
const cells = grid.cols * grid.rows;
const nx = new Float64Array(cells);
const ny = new Float64Array(cells);
const nz = new Float64Array(cells);
const area = new Float64Array(cells);
let albedoAreaMean = 0;
for (let r = 0; r < grid.rows; r++) {
  const lat0 = 90 - (180 * r) / grid.rows;
  const lat1 = 90 - (180 * (r + 1)) / grid.rows;
  const lat = ((lat0 + lat1) / 2) * RAD;
  const band = (Math.sin(lat0 * RAD) - Math.sin(lat1 * RAD)) / 2 / grid.cols;
  for (let c = 0; c < grid.cols; c++) {
    const k = r * grid.cols + c;
    // Column 0 starts at -180° (albedo.json conventions).
    const lon = ((360 * (c + 0.5)) / grid.cols - 180) * RAD;
    nx[k] = Math.cos(lat) * Math.cos(lon);
    ny[k] = Math.cos(lat) * Math.sin(lon);
    nz[k] = Math.sin(lat);
    area[k] = band;
    albedoAreaMean += band * (green[k] ?? 0);
  }
}

/** The law's free shape terms. */
interface Shape {
  readonly b: number;
  readonly thetaBarDeg: number;
  readonly bs0: number;
  readonly hs: number;
}

/** Single-lobed Hapke with this shape and w found from the map's mean. */
function lawFor(shape: Shape, normDeg: number): HapkeParameters & { t: number } {
  const mu0s = Math.cos(normDeg * RAD);
  const base = { b: shape.b, c: 1, bs0: shape.bs0, hs: shape.hs };
  // I/F/μ0 at the normalisation geometry rises with w: bisect for the map's mean.
  let lo = 0.001;
  let hi = 0.999;
  for (let k = 0; k < 60; k++) {
    const w = (lo + hi) / 2;
    const v = hapkeRough(mu0s, 1, mu0s, { w, ...base }, shape.thetaBarDeg) / mu0s;
    if (v < albedoAreaMean) lo = w;
    else hi = w;
  }
  return { w: (lo + hi) / 2, ...base, t: shape.thetaBarDeg };
}

function hapkeRough(
  mu0: number,
  mu: number,
  cosG: number,
  p: HapkeParameters,
  thetaBarDeg: number,
): number {
  return hapke(mu0, mu, cosG, p, thetaBarDeg);
}

/** p Φ(α) averaged over sub-observer longitudes, for a law normalised at `normDeg`. */
function discAlbedo(
  law: HapkeParameters & { t: number },
  alphaDeg: number,
  normDeg: number,
  values: Float64Array = green,
): number {
  const mu0s = Math.cos(normDeg * RAD);
  const standard = hapkeRough(mu0s, 1, mu0s, law, law.t);
  const alpha = alphaDeg * RAD;
  let total = 0;
  let views = 0;
  for (let lonDeg = 0; lonDeg < 360; lonDeg += LONGITUDE_STEP_DEG) {
    // Viewer on the equator at longitude lon, the Sun in the equatorial plane α further east.
    const vx = Math.cos(lonDeg * RAD);
    const vy = Math.sin(lonDeg * RAD);
    const sx = Math.cos(lonDeg * RAD + alpha);
    const sy = Math.sin(lonDeg * RAD + alpha);
    const cosG = Math.cos(alpha);
    let sum = 0;
    for (let k = 0; k < cells; k++) {
      const mu = (nx[k] ?? 0) * vx + (ny[k] ?? 0) * vy;
      if (mu <= 0) continue;
      const mu0 = (nx[k] ?? 0) * sx + (ny[k] ?? 0) * sy;
      if (mu0 <= 0) continue;
      const iOverF = (values[k] ?? 0) * mu0s * (hapkeRough(mu0, mu, cosG, law, law.t) / standard);
      // Projected area: 4π (the sphere) × fraction × μ, over the disc's π.
      sum += iOverF * mu * 4 * (area[k] ?? 0);
    }
    total += sum;
    views++;
  }
  return total / views;
}

/**
 * p Φ for one geometry: the viewer and the Sun as body-fixed unit vectors, the drawn luminance
 * (each band by its factor and luminance weight). For the captures' records.
 */
function drawnAt(
  law: HapkeParameters & { t: number },
  normDeg: number,
  viewer: readonly [number, number, number],
  sun: readonly [number, number, number],
  factors: readonly number[],
  weights: readonly number[],
): number {
  const mu0s = Math.cos(normDeg * RAD);
  const standard = hapkeRough(mu0s, 1, mu0s, law, law.t);
  const cosG = viewer[0] * sun[0] + viewer[1] * sun[1] + viewer[2] * sun[2];
  let sum = 0;
  let projected = 0;
  for (let k = 0; k < cells; k++) {
    const x = nx[k] ?? 0;
    const y = ny[k] ?? 0;
    const z = nz[k] ?? 0;
    const mu = x * viewer[0] + y * viewer[1] + z * viewer[2];
    if (mu <= 0) continue;
    projected += mu * 4 * (area[k] ?? 0);
    const mu0 = x * sun[0] + y * sun[1] + z * sun[2];
    if (mu0 <= 0) continue;
    let value = 0;
    grid.bands.forEach((band, b) => {
      value += (weights[b] ?? 0) * (factors[b] ?? 0) * (band[k] ?? 0);
    });
    sum +=
      value * mu0s * (hapkeRough(mu0, mu, cosG, law, law.t) / standard) * mu * 4 * (area[k] ?? 0);
  }
  return sum / projected;
}

function magnitude(pPhi: number): number {
  return SUN_V_MAGNITUDE - 2.5 * Math.log10((pPhi * aKm * cKm) / (AU_KM * AU_KM));
}

/** RMS of the law's curve against Eq. 6's shape, magnitudes, over PHASES_DEG. */
function shapeMisfit(shape: Shape, normDeg: number): { rms: number; v0: number } {
  const law = lawFor(shape, normDeg);
  const v = PHASES_DEG.map((a) => magnitude(discAlbedo(law, a, normDeg)));
  const v0 = v[0] ?? 0;
  let s = 0;
  PHASES_DEG.forEach((a, k) => {
    const d = (v[k] ?? 0) - v0 - (mallamaHiltonV(a) - mallamaHiltonV(0));
    s += d * d;
  });
  return { rms: Math.sqrt(s / PHASES_DEG.length), v0 };
}

/**
 * The shape terms' ranges. All four are fitted; FIT_SURGE=0 fixes B_S0 = 0 to show what the law
 * does without an opposition surge (shape RMS 0.086 mag, measured 2026-10-03).
 */
const BOUNDS: Record<keyof Shape, readonly [number, number]> = {
  b: [0.01, 0.99],
  thetaBarDeg: [0, 60],
  bs0: [0, 4],
  hs: [0.001, 1],
};
const FREE: readonly (keyof Shape)[] =
  process.env['FIT_SURGE'] !== '0' ? ['b', 'thetaBarDeg', 'bs0', 'hs'] : ['b', 'thetaBarDeg'];
const FIXED: Shape = { b: 0.3, thetaBarDeg: 20, bs0: 0, hs: 0.05 };

function shapeOf(x: readonly number[]): Shape {
  const s: Record<string, number> = { ...FIXED };
  FREE.forEach((key, k) => {
    const [lo, hi] = BOUNDS[key];
    s[key] = Math.min(hi, Math.max(lo, x[k] ?? 0));
  });
  return s as unknown as Shape;
}

/** Nelder-Mead over the free terms, from a start inside the bounds. */
function fit(normDeg: number): Shape & { rms: number; v0: number } {
  const f = (x: readonly number[]): number => shapeMisfit(shapeOf(x), normDeg).rms;
  const n = FREE.length;
  const start = FREE.map((key) => FIXED[key]);
  let simplex = [
    start,
    ...FREE.map((key, k) =>
      start.map((v, j) => (j === k ? v + 0.25 * (BOUNDS[key][1] - BOUNDS[key][0]) : v)),
    ),
  ];
  let values = simplex.map(f);
  for (let iteration = 0; iteration < 200 * n; iteration++) {
    const order = values
      .map((v, k) => [v, k] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, k]) => k);
    simplex = order.map((k) => simplex[k] ?? start);
    values = order.map((k) => values[k] ?? Infinity);
    const worst = simplex[n] ?? start;
    const centroid = start.map(
      (_, j) => simplex.slice(0, n).reduce((s, p) => s + (p[j] ?? 0), 0) / n,
    );
    const at = (t: number): number[] => centroid.map((c, j) => c + t * (c - (worst[j] ?? 0)));
    const reflected = at(1);
    const fr = f(reflected);
    if (fr < (values[0] ?? Infinity)) {
      const expanded = at(2);
      const fe = f(expanded);
      [simplex[n], values[n]] = fe < fr ? [expanded, fe] : [reflected, fr];
    } else if (fr < (values[n - 1] ?? Infinity)) {
      [simplex[n], values[n]] = [reflected, fr];
    } else {
      const contracted = at(-0.5);
      const fc = f(contracted);
      if (fc < (values[n] ?? Infinity)) {
        [simplex[n], values[n]] = [contracted, fc];
      } else {
        const best = simplex[0] ?? start;
        simplex = simplex.map((p, k) =>
          k === 0 ? p : p.map((v, j) => (best[j] ?? 0) + 0.5 * (v - (best[j] ?? 0))),
        );
        values = simplex.map(f);
      }
    }
    if (Math.max(...values) - Math.min(...values) < 1e-6) break;
  }
  const k = values.indexOf(Math.min(...values));
  const shape = shapeOf(simplex[k] ?? start);
  return { ...shape, ...shapeMisfit(shape, normDeg) };
}

const results = NORMALISATION_TRIED_DEG.map((normDeg) => {
  const f = fit(normDeg);
  console.log(
    `i_s = ${normDeg}°: b ${f.b.toFixed(4)}, θ̄ ${f.thetaBarDeg.toFixed(2)}°, B_S0 ${f.bs0.toFixed(3)}, h_S ${f.hs.toFixed(4)}, shape RMS ${f.rms.toFixed(4)} mag, V(1,0) ${f.v0.toFixed(3)} against ${mallamaHiltonV(0)}`,
  );
  return { normDeg, ...f };
});
const chosen = results.find((r) => r.normDeg === NORMALISATION_DEG);
if (chosen === undefined) throw new Error('normalisation not tried');
const law = lawFor(chosen, NORMALISATION_DEG);
// The absolute scale, per band (owner, 2026-10-03, "Calibrate to Mallama"; docs/world-recipe.md
// W3: "calibrated to the published geometric albedo"): the factor that makes the disc's
// geometric albedo, built with this law, Mars's measured one in the nearest band.
// The V band's level is Eq. 6's own zero-phase magnitude, the curve the law is fitted to; the other
// bands keep Mallama et al.'s (2017) ratios to their V albedo (0.170, against Eq. 6's 0.1717 with
// these radii: the two papers' zero points differ by 0.011 mag).
const pV = (AU_KM * AU_KM * 10 ** (-0.4 * (mallamaHiltonV(0) - SUN_V_MAGNITUDE))) / (aKm * cKm);
const perBand = BANDS_NM.map((nm, k) => {
  const published = MARS_GEOMETRIC_ALBEDO[nm];
  const target = {
    band: published.band,
    p: Number(((published.p / MARS_GEOMETRIC_ALBEDO[530].p) * pV).toFixed(5)),
  };
  const built = discAlbedo(law, 0, NORMALISATION_DEG, grid.bands[k]);
  return { nm, band: target.band, target: target.p, built, factor: target.p / built };
});
// The brightness a viewer sees is the drawn colour's luminance, CIE Y, which Johnson V was made
// to follow. The app's colour joins the bands with straight lines (core/moonColour.ts), and Mars's
// spectrum curves up past 550 nm, so with each band at its own target Y comes out brighter than
// V. One common factor brings Y to V; the bands keep Mallama et al.'s ratios to one another.
const weights = colourWeights(BANDS_NM);
const luminance = BANDS_NM.map(
  (_, k) =>
    0.2126 * (weights[0]?.[k] ?? 0) +
    0.7152 * (weights[1]?.[k] ?? 0) +
    0.0722 * (weights[2]?.[k] ?? 0),
);
const pY = perBand.reduce((s, c, k) => s + (luminance[k] ?? 0) * c.target, 0);
const toV = pV / pY;
console.log(
  `luminance Y with each band at its target: p ${pY.toFixed(4)}, V ${pV.toFixed(4)}: x${toV.toFixed(4)}`,
);
const calibration = perBand.map((c) => ({
  nm: c.nm,
  band: c.band,
  target: Number((c.target * toV).toFixed(5)),
  built: Number(c.built.toFixed(5)),
  factor: Number(((c.target * toV) / c.built).toFixed(5)),
}));
for (const c of calibration) {
  console.log(
    `${c.nm} nm (${c.band}): built p ${c.built.toFixed(4)}, Mars ${c.target}, factor ${c.factor.toFixed(4)}`,
  );
}
/** The drawn disc's luminance at phase α, as a geometric-albedo-like p Φ(α): what V measures. */
const drawn = (alphaDeg: number): number =>
  calibration.reduce(
    (sum, c, k) =>
      sum +
      (luminance[k] ?? 0) * c.factor * discAlbedo(law, alphaDeg, NORMALISATION_DEG, grid.bands[k]),
    0,
  );
const curve = Array.from({ length: ALPHA_MAX_DEG / 5 + 1 }, (_, k) => 5 * k).map((a) => ({
  alphaDeg: a,
  built: Number(magnitude(drawn(a)).toFixed(4)),
  mallamaHilton: Number(mallamaHiltonV(a).toFixed(4)),
}));

// The captures' geometries (src/capture/viewpoints.ts), body-fixed, from public/data/mars/
// ephemeris.json: what the fit predicts there, longitude effect included.
const unitAt = (lonDeg: number, latDeg: number): [number, number, number] => [
  Math.cos(latDeg * RAD) * Math.cos(lonDeg * RAD),
  Math.cos(latDeg * RAD) * Math.sin(lonDeg * RAD),
  Math.sin(latDeg * RAD),
];
const DIAGNOSTIC = [
  { id: 'mars-from-earth', viewer: [29.8, -8.6], sun: [31.1, -8.5] },
  { id: 'mars-phase-40', viewer: [-8.9, -8.5], sun: [31.1, -8.5] },
] as const;
for (const d of DIAGNOSTIC) {
  const viewer = unitAt(d.viewer[0], d.viewer[1]);
  const sun = unitAt(d.sun[0], d.sun[1]);
  const alpha = Math.acos(viewer[0] * sun[0] + viewer[1] * sun[1] + viewer[2] * sun[2]) / RAD;
  const p = drawnAt(
    law,
    NORMALISATION_DEG,
    viewer,
    sun,
    calibration.map((c) => c.factor),
    luminance,
  );
  console.log(
    `${d.id}: alpha ${alpha.toFixed(1)}, predicted V ${magnitude(p).toFixed(3)}, Eq. 6 ${mallamaHiltonV(alpha).toFixed(3)}`,
  );
}

// The map's brightness against central meridian, seen from the equator at full phase, against
// Mallama's L1 (core/marsPhotometry.ts): both about their own mean.
const lightCurve = Array.from({ length: 36 }, (_, k) => {
  const westDeg = 10 * k;
  const at = unitAt(-westDeg, 0);
  return {
    westDeg,
    drawn: magnitude(
      drawnAt(
        law,
        NORMALISATION_DEG,
        at,
        at,
        calibration.map((c) => c.factor),
        luminance,
      ),
    ),
    mallama: mallamaCorrection(MALLAMA_L1, westDeg),
  };
});
const meanOf = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const drawnMean = meanOf(lightCurve.map((p) => p.drawn));
const mallamaMean = meanOf(lightCurve.map((p) => p.mallama));
const curveRms = Math.sqrt(
  meanOf(lightCurve.map((p) => (p.drawn - drawnMean - (p.mallama - mallamaMean)) ** 2)),
);
const range = (v: readonly number[]): number => Math.max(...v) - Math.min(...v);
console.log(
  `light curve: map range ${range(lightCurve.map((p) => p.drawn)).toFixed(3)} mag, Mallama L1 ${range(lightCurve.map((p) => p.mallama)).toFixed(3)}, RMS difference ${curveRms.toFixed(3)}`,
);
for (const p of lightCurve) {
  console.log(
    `  ${p.westDeg} W: map ${(p.drawn - drawnMean).toFixed(3)}  L1 ${(p.mallama - mallamaMean).toFixed(3)}`,
  );
}

const result: MarsPhotometry = {
  story: 'docs/stories/SS-14.md (W7)',
  law: {
    form: 'Hapke (core/hapke.ts): single-lobed Henyey-Greenstein (c = 1) with a shadow-hiding opposition surge',
    w: Number(law.w.toFixed(5)),
    b: Number(law.b.toFixed(5)),
    c: 1,
    bs0: Number(law.bs0.toFixed(5)),
    hs: Number(law.hs.toFixed(5)),
    thetaBarDeg: Number(law.t.toFixed(3)),
  },
  normalisation: {
    incidenceDeg: NORMALISATION_DEG,
    emissionDeg: 0,
    phaseDeg: NORMALISATION_DEG,
    why: 'OMEGA albedo = I/F / cos(i), near nadir (e < 15 deg), i < 75 deg (Ody et al. 2012, §2.2, §3.1); the incidence within that range is a choice, its effect measured in `normalisationTried`',
  },
  fittedTo: MALLAMA_HILTON_2018,
  albedoAreaMean: Number(albedoAreaMean.toFixed(5)),
  shapeRmsMag: Number(chosen.rms.toFixed(4)),
  zeroPhaseMagnitudeUncalibrated: {
    built: Number(chosen.v0.toFixed(4)),
    mallamaHilton: mallamaHiltonV(0),
  },
  calibration,
  calibrationSource: MALLAMA_2017.source,
  luminance: {
    weights: luminance.map((w) => Number(w.toFixed(5))),
    withEachBandAtItsTarget: Number(pY.toFixed(5)),
    v: Number(pV.toFixed(5)),
    commonFactor: Number(toV.toFixed(5)),
    why: "CIE Y of the drawn colour (Rec. 709 luminance of linear sRGB) is brought to the V geometric albedo: the colour model joins the bands with straight lines, and Mars's spectrum curves up past 550 nm",
  },
  curve,
  normalisationTried: results.map((r) => ({
    incidenceDeg: r.normDeg,
    b: Number(r.b.toFixed(5)),
    thetaBarDeg: Number(r.thetaBarDeg.toFixed(3)),
    shapeRmsMag: Number(r.rms.toFixed(4)),
    zeroPhaseMagnitudeUncalibrated: Number(r.v0.toFixed(4)),
  })),
  method: {
    grid: `albedo.webp in ${BLOCK} x ${BLOCK} pixel block means (${grid.cols} x ${grid.rows})`,
    longitudesAveraged: 360 / LONGITUDE_STEP_DEG,
    viewer: 'on the equator; the Sun in the equatorial plane',
    radiiKm: [aKm, cKm],
    sunVMagnitude: SUN_V_MAGNITUDE,
    band: 'the map is reflectance at 530 nm; Eq. 6 is Johnson V (about 550 nm)',
  },
};
writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
console.log(`wrote ${out}`);
