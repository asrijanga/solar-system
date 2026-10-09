// npm run pipeline:mercury:photometry
//
// Mercury's scattering law, fitted to Mercury's own measured brightness, and each map band
// calibrated to its measured geometric albedo (docs/stories/SS-16.md, W7; owner, 2026-10-09,
// "Approve (A)"). Writes public/data/mercury/photometry.json. Mars's method
// (tools/data/marsPhotometry.ts), with Mercury's data:
//
// - The curve: Mallama & Hilton (2018) Eq. 2 (core/mercuryPhotometry.ts), observed from 2.1 to
//   169.5 deg. The law's shape is fitted to Eq. 2's shape at PHASES_DEG, 5 to 125 deg (below), each
//   curve taken about its own mean, so no point relies on Eq. 2 outside its observed range.
// - The surface: I/F = A · R(i, e, g) / R(30, 0, 30), with A the albedo map (W3) and R one Hapke law
//   (core/hapke.ts) for the planet. MDIS's maps are "reflectance corrected to i = 30º, e = 0º,
//   g = 30º" (MDIS_CDR_RDRSIS.PDF §2.4): I/F itself at that geometry, so unlike Mars's OMEGA map
//   there is no 1/cos(i) and no normalisation to choose.
// - Fitted: b and c of the double Henyey-Greenstein (Mars's needed only the back lobe; Mercury's
//   curve runs to 169.5 deg), the mean slope θ̄, and the opposition surge B_S0, h_S. w is the
//   single-scattering albedo whose own I/F at the normalisation geometry is the map's mean.
// - The level: the bands keep Mallama et al.'s (2017) Table 7 ratios to their V albedo, and one
//   common factor makes the drawn colour's luminance follow Eq. 2 on average over the fitted
//   phases (below: not at 0 deg, as Mars's was).
// - Gaps: where W3 measured nothing (the map's byte 0, 0.2% of the surface, at the poles) the
//   block means leave it out; a block with nothing measured is left out of the disc's sum, and the
//   share of the projected disc that is recorded.
//
// Python is used only to read the lossless WebP map (pillow).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hapke, type HapkeParameters } from '../../src/core/hapke.ts';
import { colourWeights } from '../../src/core/moonColour.ts';
import { AU_KM, SUN_V_MAGNITUDE } from '../../src/core/photometry.ts';
import {
  MERCURY_GEOMETRIC_ALBEDO,
  MERCURY_MALLAMA_HILTON_2018,
  MERCURY_V_ALBEDO_2017,
  mercuryV,
  type MercuryPhotometry,
} from '../../src/core/mercuryPhotometry.ts';

const root = join(import.meta.dirname, '..', '..');
const data = join(root, 'public', 'data', 'mercury');
const cache = join(root, 'pipeline', '.cache');
const out = join(data, 'photometry.json');

/** The map in blocks of BLOCK x BLOCK pixels of the 8192-wide albedo: 128 x 64 cells. */
const BLOCK = 64;
const LONGITUDE_STEP_DEG = 30;
/** Phase angles fitted, degrees: inside Eq. 2's observed 2.1 to 169.5. */
// Fitted to 125 deg (owner, 2026-10-09, "Fit 5-125°"). No single law follows Eq. 2 over its whole
// observed range: fitted to 165 deg, the best of every start misses it by 0.108 mag RMS (porosity
// K free, FIT_K=1, does no better: 0.107); fitted to 125 deg, by 0.004, and it is then 0.06 mag
// too faint at 150 deg, 0.4 at 160 and 1.6 at 169.5: the thinnest crescents, close to the Sun.
// MAX_FIT_DEG=165 reproduces the other fit.
const MAX_FIT_DEG = Number(process.env['MAX_FIT_DEG'] ?? 125);
const PHASES_DEG = Array.from({ length: 17 }, (_, k) => 5 + 10 * k).filter((a) => a <= MAX_FIT_DEG);
const NORMALISATION_DEG = 30;
const BANDS_NM = [430, 750, 1000] as const;
const RAD = Math.PI / 180;

/** Block means of each band's reflectance, row 0 at the north, NaN where nothing was measured. */
function albedoGrid(): { bands: Float64Array[]; cols: number; rows: number } {
  const manifest = JSON.parse(readFileSync(join(data, 'albedo.json'), 'utf8')) as {
    texture: { sha256: string; encoding: { maxReflectance: number } };
    colour: { ranges: Record<string, readonly [number, number]> };
  };
  const file = join(
    cache,
    `mercury-albedo-bands-block${BLOCK}-${manifest.texture.sha256.slice(0, 16)}.f64`,
  );
  const width = 8192 / BLOCK;
  const height = 4096 / BLOCK;
  if (!existsSync(file)) {
    mkdirSync(cache, { recursive: true });
    const range = (key: string): string => JSON.stringify(manifest.colour.ranges[key]);
    const code = [
      'import sys, numpy as np',
      'from PIL import Image',
      `b = np.asarray(Image.open(sys.argv[1]).convert('L'), dtype=np.float64)`,
      `r = ${manifest.texture.encoding.maxReflectance} * (b / 255.0) ** 2`,
      'r[b == 0] = np.nan',
      'with np.errstate(invalid="ignore"): r750 = np.nanmean(r.reshape(1024, 4, 2048, 4), axis=(1, 3))',
      `c = np.asarray(Image.open(sys.argv[2]).convert('RGB'), dtype=np.float64) / 255.0`,
      'lin = lambda v, lo_hi: lo_hi[0] + (lo_hi[1] - lo_hi[0]) * v',
      `bands = [r750 * lin(c[..., 1], ${range('430/750')}), r750, r750 * lin(c[..., 0], ${range('1000/750')})]`,
      `k = ${BLOCK / 4}`,
      'with np.errstate(invalid="ignore"):',
      `    out = np.stack([np.nanmean(x.reshape(${height}, k, ${width}, k), axis=(1, 3)) for x in bands])`,
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
        join(data, 'albedo.webp'),
        join(data, 'albedo-colour.png'),
        file,
      ],
      { stdio: 'inherit' },
    );
  }
  const bytes = readFileSync(file);
  const all = new Float64Array(bytes.buffer, bytes.byteOffset, BANDS_NM.length * width * height);
  const bands = BANDS_NM.map((_, k) => all.subarray(k * width * height, (k + 1) * width * height));
  return { bands, cols: width, rows: height };
}

const grid = albedoGrid();
const r750 = grid.bands[1] ?? new Float64Array(0);
const ephemeris = JSON.parse(readFileSync(join(data, 'ephemeris.json'), 'utf8')) as {
  body: { radiiKm: readonly [number, number, number] };
  epochs: readonly {
    id: string;
    sunDirectionJ2000: readonly [number, number, number];
    earthDirectionJ2000: readonly [number, number, number];
    j2000ToBodyFixed: readonly (readonly [number, number, number])[];
  }[];
};
const [aKm, , cKm] = ephemeris.body.radiiKm;

const cells = grid.cols * grid.rows;
const nx = new Float64Array(cells);
const ny = new Float64Array(cells);
const nz = new Float64Array(cells);
const area = new Float64Array(cells);
let measuredArea = 0;
let albedoAreaMean = 0;
for (let r = 0; r < grid.rows; r++) {
  const lat0 = 90 - (180 * r) / grid.rows;
  const lat1 = 90 - (180 * (r + 1)) / grid.rows;
  const lat = ((lat0 + lat1) / 2) * RAD;
  const band = (Math.sin(lat0 * RAD) - Math.sin(lat1 * RAD)) / 2 / grid.cols;
  for (let c = 0; c < grid.cols; c++) {
    const k = r * grid.cols + c;
    const lon = ((360 * (c + 0.5)) / grid.cols - 180) * RAD;
    nx[k] = Math.cos(lat) * Math.cos(lon);
    ny[k] = Math.cos(lat) * Math.sin(lon);
    nz[k] = Math.sin(lat);
    area[k] = band;
    const v = r750[k] ?? Number.NaN;
    if (Number.isFinite(v)) {
      albedoAreaMean += band * v;
      measuredArea += band;
    }
  }
}
albedoAreaMean /= measuredArea;

interface Shape {
  readonly b: number;
  readonly c: number;
  readonly thetaBarDeg: number;
  readonly bs0: number;
  readonly hs: number;
  /** Hapke's porosity factor K (core/hapke.ts), 1 for none. */
  readonly k: number;
}
type Law = HapkeParameters & { t: number; k: number };

const mu0s = Math.cos(NORMALISATION_DEG * RAD);

function lawFor(shape: Shape): Law {
  const base = { b: shape.b, c: shape.c, bs0: shape.bs0, hs: shape.hs };
  let lo = 0.001;
  let hi = 0.999;
  for (let k = 0; k < 60; k++) {
    const w = (lo + hi) / 2;
    if (hapke(mu0s, 1, mu0s, { w, ...base }, shape.thetaBarDeg, shape.k) < albedoAreaMean) lo = w;
    else hi = w;
  }
  return { w: (lo + hi) / 2, ...base, t: shape.thetaBarDeg, k: shape.k };
}

/** p Φ for one geometry (body-fixed unit vectors), summed over measured cells; and the share of
 * the projected disc left out because nothing was measured there. */
function discAt(
  law: Law,
  viewer: readonly number[],
  sun: readonly number[],
  values: Float64Array,
): { pPhi: number; unmeasured: number } {
  const standard = hapke(mu0s, 1, mu0s, law, law.t, law.k);
  const cosG =
    (viewer[0] ?? 0) * (sun[0] ?? 0) +
    (viewer[1] ?? 0) * (sun[1] ?? 0) +
    (viewer[2] ?? 0) * (sun[2] ?? 0);
  let sum = 0;
  let projected = 0;
  let missing = 0;
  for (let k = 0; k < cells; k++) {
    const x = nx[k] ?? 0;
    const y = ny[k] ?? 0;
    const z = nz[k] ?? 0;
    const mu = x * (viewer[0] ?? 0) + y * (viewer[1] ?? 0) + z * (viewer[2] ?? 0);
    if (mu <= 0) continue;
    const a = mu * 4 * (area[k] ?? 0);
    projected += a;
    const value = values[k] ?? Number.NaN;
    if (!Number.isFinite(value)) {
      missing += a;
      continue;
    }
    const mu0 = x * (sun[0] ?? 0) + y * (sun[1] ?? 0) + z * (sun[2] ?? 0);
    if (mu0 <= 0) continue;
    sum += value * (hapke(mu0, mu, cosG, law, law.t, law.k) / standard) * a;
  }
  // Over the disc's π: projected sums to 1 for a full sphere seen whole.
  return { pPhi: sum / projected, unmeasured: missing / projected };
}

/** p Φ(α) averaged over sub-observer longitudes, viewer on the equator, Sun α further east. */
function discAlbedo(law: Law, alphaDeg: number, values: Float64Array = r750): number {
  let total = 0;
  let views = 0;
  for (let lonDeg = 0; lonDeg < 360; lonDeg += LONGITUDE_STEP_DEG) {
    const v = [Math.cos(lonDeg * RAD), Math.sin(lonDeg * RAD), 0];
    const s = [Math.cos(lonDeg * RAD + alphaDeg * RAD), Math.sin(lonDeg * RAD + alphaDeg * RAD), 0];
    total += discAt(law, v, s, values).pPhi;
    views++;
  }
  return total / views;
}

function magnitude(pPhi: number): number {
  return SUN_V_MAGNITUDE - 2.5 * Math.log10((pPhi * aKm * cKm) / (AU_KM * AU_KM));
}

/** RMS of the law's curve against Eq. 2, each about its own mean over PHASES_DEG. */
function shapeMisfit(shape: Shape): number {
  const law = lawFor(shape);
  const d = PHASES_DEG.map((a) => magnitude(discAlbedo(law, a)) - mercuryV(a));
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  return Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / d.length);
}

const BOUNDS: Record<keyof Shape, readonly [number, number]> = {
  b: [0.01, 0.99],
  c: [-1, 1],
  thetaBarDeg: [0, 60],
  bs0: [0, 4],
  hs: [0.001, 1],
  k: [1, 4],
};
const FREE: readonly (keyof Shape)[] =
  process.env['FIT_K'] === '1'
    ? ['b', 'c', 'thetaBarDeg', 'bs0', 'hs', 'k']
    : ['b', 'c', 'thetaBarDeg', 'bs0', 'hs'];
const START: Shape = { b: 0.3, c: 0.5, thetaBarDeg: 20, bs0: 1, hs: 0.05, k: 1 };

function shapeOf(x: readonly number[]): Shape {
  const s: Record<string, number> = { ...START };
  FREE.forEach((key, k) => {
    const [lo, hi] = BOUNDS[key];
    s[key] = Math.min(hi, Math.max(lo, x[k] ?? 0));
  });
  return s as unknown as Shape;
}

/** Nelder-Mead over the free terms, as tools/data/marsPhotometry.ts. */
function fit(from: Shape): Shape & { rms: number } {
  const f = (x: readonly number[]): number => shapeMisfit(shapeOf(x));
  const n = FREE.length;
  const start = FREE.map((key) => from[key]);
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
  return { ...shape, rms: shapeMisfit(shape) };
}

// Nelder-Mead finds a local minimum: it is started from STARTS, spanning back- to forward-scattering
// and smooth to rough, and the best is kept; every start's result is recorded.
const STARTS: readonly Shape[] = [
  START,
  { b: 0.2, c: 0.2, thetaBarDeg: 15, bs0: 2, hs: 0.06, k: 1 },
  { b: 0.3, c: -0.3, thetaBarDeg: 20, bs0: 1, hs: 0.1, k: 1 },
  { b: 0.5, c: 0, thetaBarDeg: 10, bs0: 1, hs: 0.05, k: 1 },
  { b: 0.6, c: 0.6, thetaBarDeg: 30, bs0: 0.5, hs: 0.2, k: 1 },
  { b: 0.2, c: -0.8, thetaBarDeg: 25, bs0: 2, hs: 0.03, k: 1 },
  { b: 0.4, c: 0.3, thetaBarDeg: 40, bs0: 1.5, hs: 0.08, k: 1 },
  { b: 0.15, c: 0.9, thetaBarDeg: 5, bs0: 3, hs: 0.02, k: 1 },
];
const tried = STARTS.map((from) => {
  const f = fit(from);
  console.log(
    `  from ${JSON.stringify(from)}: RMS ${f.rms.toFixed(4)} (b ${f.b.toFixed(3)}, c ${f.c.toFixed(3)}, θ̄ ${f.thetaBarDeg.toFixed(1)}, B_S0 ${f.bs0.toFixed(2)}, h_S ${f.hs.toFixed(3)})`,
  );
  return f;
});
const chosen = tried.reduce((a, b) => (b.rms < a.rms ? b : a));
const law = lawFor(chosen);
console.log(
  `b ${law.b.toFixed(4)}, c ${law.c.toFixed(4)}, θ̄ ${law.t.toFixed(2)}°, B_S0 ${law.bs0.toFixed(3)}, h_S ${law.hs.toFixed(4)}, w ${law.w.toFixed(4)}; shape RMS ${chosen.rms.toFixed(4)} mag`,
);

// The level. Eq. 2 is a polynomial fitted to observations from 2.1 deg: extrapolated to 0 it
// rises 0.5 mag in the first 10 deg, a surge no observation constrains. So the level is not set
// at 0 deg, as Mars's was (its Eq. 6 holds from 0): the bands keep Table 7's ratios to its V
// albedo, and one common factor makes the drawn luminance's magnitudes equal Eq. 2's on average
// over the fitted phases, where Eq. 2 was observed.
const weights = colourWeights(BANDS_NM);
const luminance = BANDS_NM.map(
  (_, k) =>
    0.2126 * (weights[0]?.[k] ?? 0) +
    0.7152 * (weights[1]?.[k] ?? 0) +
    0.0722 * (weights[2]?.[k] ?? 0),
);
const perBand = BANDS_NM.map((nm, k) => {
  const published = MERCURY_GEOMETRIC_ALBEDO[nm];
  const ratio = published.p / MERCURY_V_ALBEDO_2017;
  const built = discAlbedo(law, 0, grid.bands[k]);
  return {
    nm,
    band: published.band,
    ratio,
    built,
    curve: PHASES_DEG.map((a) => discAlbedo(law, a, grid.bands[k])),
  };
});
const unscaled = PHASES_DEG.map((_, j) =>
  perBand.reduce(
    (sum, c, k) => sum + (luminance[k] ?? 0) * (c.ratio / c.built) * (c.curve[j] ?? 0),
    0,
  ),
);
const offsetMag =
  PHASES_DEG.reduce((s, a, j) => s + magnitude(unscaled[j] ?? 0) - mercuryV(a), 0) /
  PHASES_DEG.length;
const scale = 10 ** (offsetMag / 2.5);
const calibration = perBand.map((c) => ({
  nm: c.nm,
  band: c.band,
  target: Number((c.ratio * scale).toFixed(5)),
  built: Number(c.built.toFixed(5)),
  factor: Number(((c.ratio * scale) / c.built).toFixed(5)),
}));
for (const c of calibration) {
  console.log(
    `${c.nm} nm (${c.band}): built p ${c.built.toFixed(4)}, target ${c.target}, factor ${c.factor.toFixed(4)}`,
  );
}
const drawn = (alphaDeg: number): number =>
  calibration.reduce(
    (sum, c, k) => sum + (luminance[k] ?? 0) * c.factor * discAlbedo(law, alphaDeg, grid.bands[k]),
    0,
  );
const pY = drawn(0);
const pVEq2 = (AU_KM * AU_KM * 10 ** (-0.4 * (mercuryV(0) - SUN_V_MAGNITUDE))) / (aKm * cKm);
console.log(
  `drawn geometric albedo (luminance, 0 deg) ${pY.toFixed(4)}; Table 7 V ${MERCURY_V_ALBEDO_2017}; Eq. 2 extrapolated to 0 deg ${pVEq2.toFixed(4)}`,
);
const curve = [2.1, ...Array.from({ length: 17 }, (_, k) => 10 * (k + 1)), 169.5].map((a) => ({
  alphaDeg: a,
  built: Number(magnitude(drawn(a)).toFixed(4)),
  mallamaHilton: Number(mercuryV(a).toFixed(4)),
}));

// The captures' geometry: each canonical epoch, seen from Earth, longitude effect included.
const epochs = ephemeris.epochs.map((e) => {
  const toBody = (v: readonly number[]): number[] =>
    e.j2000ToBodyFixed.map(
      (row) => row[0] * (v[0] ?? 0) + row[1] * (v[1] ?? 0) + row[2] * (v[2] ?? 0),
    );
  const viewer = toBody(e.earthDirectionJ2000);
  const sun = toBody(e.sunDirectionJ2000);
  const alpha = Math.acos(viewer.reduce((s, x, k) => s + x * (sun[k] ?? 0), 0)) / RAD;
  let pPhi = 0;
  let unmeasured = 0;
  calibration.forEach((c, k) => {
    const d = discAt(law, viewer, sun, grid.bands[k] ?? r750);
    pPhi += (luminance[k] ?? 0) * c.factor * d.pPhi;
    unmeasured = d.unmeasured;
  });
  return {
    id: e.id,
    alphaDeg: Number(alpha.toFixed(3)),
    predictedV: Number(magnitude(pPhi).toFixed(4)),
    mallamaHilton: Number(mercuryV(alpha).toFixed(4)),
    unmeasuredShareOfDisc: Number(unmeasured.toFixed(5)),
  };
});
for (const e of epochs)
  console.log(
    `${e.id}: alpha ${e.alphaDeg}, predicted V(1,α) ${e.predictedV}, Eq. 2 ${e.mallamaHilton}`,
  );

const result: MercuryPhotometry = {
  story: 'docs/stories/SS-16.md (W7)',
  law: {
    form: 'Hapke (core/hapke.ts): double Henyey-Greenstein with a shadow-hiding opposition surge',
    w: Number(law.w.toFixed(5)),
    b: Number(law.b.toFixed(5)),
    c: Number(law.c.toFixed(5)),
    bs0: Number(law.bs0.toFixed(5)),
    hs: Number(law.hs.toFixed(5)),
    thetaBarDeg: Number(law.t.toFixed(3)),
  },
  normalisation: {
    incidenceDeg: NORMALISATION_DEG,
    emissionDeg: 0,
    phaseDeg: NORMALISATION_DEG,
    why: 'MDIS maps are "reflectance corrected to i = 30º, e = 0º, g = 30º" (MDIS_CDR_RDRSIS.PDF §2.4): I/F at that geometry',
  },
  fittedTo: MERCURY_MALLAMA_HILTON_2018,
  albedoAreaMean: Number(albedoAreaMean.toFixed(5)),
  measuredShareOfSurface: Number(measuredArea.toFixed(5)),
  shapeRmsMag: Number(chosen.rms.toFixed(4)),
  calibration,
  calibrationSource:
    'Mallama, Krobusek & Pavlov (2017), Icarus 282, 19, arXiv:1609.05048, Table 7: ratios to their V albedo 0.142; level from Eq. 2',
  luminance: {
    weights: luminance.map((w) => Number(w.toFixed(5))),
    drawnGeometricAlbedo: Number(pY.toFixed(5)),
    table7V: MERCURY_V_ALBEDO_2017,
    eq2ExtrapolatedTo0Deg: Number(pVEq2.toFixed(5)),
    why: "CIE Y of the drawn colour (Rec. 709 luminance of linear sRGB) matched to Eq. 2's V on average over the fitted phases, where Eq. 2 was observed; Eq. 2 is not used below 2.1 deg",
  },
  curve,
  epochs,
  fitStarts: tried.map((f) => ({
    b: Number(f.b.toFixed(4)),
    c: Number(f.c.toFixed(4)),
    thetaBarDeg: Number(f.thetaBarDeg.toFixed(2)),
    bs0: Number(f.bs0.toFixed(3)),
    hs: Number(f.hs.toFixed(4)),
    shapeRmsMag: Number(f.rms.toFixed(4)),
  })),
  method: {
    grid: `albedo.webp in ${BLOCK} x ${BLOCK} pixel block means of measured pixels (${grid.cols} x ${grid.rows})`,
    phasesFittedDeg: PHASES_DEG,
    longitudesAveraged: 360 / LONGITUDE_STEP_DEG,
    viewer: 'on the equator; the Sun in the equatorial plane',
    radiiKm: [aKm, cKm],
    sunVMagnitude: SUN_V_MAGNITUDE,
  },
};
writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
console.log(`wrote ${out}`);
