// npm run pipeline:roughness
//
// The statistics behind the approximated detail (docs/stories/SS-10b.md), measured, never
// assumed, and written to public/data/moon/roughness.json:
//
// 1. How roughness falls off towards small scales: the RMS height difference against distance,
//    2 to 64 m, from LROC NAC stereo terrain models at 2 m spacing (a mare site, Apollo 11, and a
//    highland site, Apollo 16), as a ratio to its value at 64 m. The two sites agree within 15%
//    at every lag, so their mean is used everywhere; below 2 m it is extended with the power law
//    fitted to 2-8 m.
// 2. How rough a given place is: at run time, Kaguya's own RMS height difference over 8 samples
//    (67 m) near that place (tools/local/approximate.ts). So smooth mare stays smooth and rough
//    highland stays rough.
// 3. How much of each octave of detail that takes: calibrated here by sampling the detail
//    field, after allowing for the variation bilinear interpolation of Kaguya already gives.
//
// The result is then checked on real ground: Kaguya's Albategnius file plus the detail, against
// the target at 1.3, 2.6 and 5.2 m (the vertex spacings of the approximated levels).

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fetchPinned } from './download.ts';
import { bandLimitedOctave, detailM, MEASURED_PPD, OCTAVES } from '../../src/core/approximation.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'public', 'data', 'moon', 'roughness.json');
const R_M = 1_737_400;
const NAC =
  'https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/SDP/NAC_DTM/';

/**
 * LROC NAC DTMs (PDS4, LRO-L-LROC-5-RDR), from their labels: IEEE754 LSB float elevations, 2 m
 * per pixel, planetocentric, east-positive, equirectangular on the 1737.4 km sphere, missing
 * value 0xFF7FFFFB, tied to LOLA with RMS 1-4 m. The MD5 is the label's; the SHA-256 is pinned.
 */
const SITES = [
  {
    site: 'APOLLO11',
    terrain: 'mare',
    file: 'APOLLO11/NAC_DTM_APOLLO11_E008N0234.IMG',
    lines: 13978,
    samples: 2111,
    offset: 8444,
    md5: '0c04fb36927462d1e18f1a6c888f183a',
    sha256: 'cfdd25a32cabc3ef6306269a59b7d466c09fbd7b83f6b9dfdb7ee24df78eee44',
  },
  {
    site: 'APOLLO16_1',
    terrain: 'highland',
    file: 'APOLLO16_1/NAC_DTM_APOLLO16_1_E092S0153.IMG',
    lines: 14225,
    samples: 2454,
    offset: 9816,
    md5: '18cba66509e07a751705d211d3500da9',
    sha256: '286e5f133f0020ef01c91b32cd359a3308a9ed456cf574f75359c014fed6aa2e',
  },
] as const;
const NAC_SPACING_M = 2;
const NAC_MISSING = 0xff7ffffb;

const KAGUYA_URL =
  'https://data.darts.isas.jaxa.jp/pub/pds3/sln-l-tc-5-dtm-map-seamless-v2.0/lon003/data/DTM_MAPs02_S09E003S12E006SC.img';
const KAGUYA_SHA256 = '267c14fc6b87fee85d1e5df91a12ea1d60412ddbf0e872987a4c6893356c84c1';
const KAGUYA_SPACING_M = ((Math.PI / 180) * R_M) / MEASURED_PPD;

/** Kaguya lag the local roughness is anchored at: 8 samples, 67 m. */
export const ANCHOR_SAMPLES = 8;
/** Vertex spacings of the approximated levels 14, 15 and 16, m. */
const TARGET_M = [5.2, 2.6, 1.3];

/** RMS height difference at each lag (in samples), along rows and columns, skipping gaps. */
export function structureFunction(
  at: (row: number, col: number) => number,
  rows: number,
  cols: number,
  lags: readonly number[],
  stride = 3,
): number[] {
  return lags.map((lag) => {
    let sum = 0;
    let n = 0;
    for (let r = 0; r < rows; r += stride) {
      for (let c = 0; c + lag < cols; c += stride) {
        const d = at(r, c) - at(r, c + lag);
        if (Number.isFinite(d)) {
          sum += d * d;
          n++;
        }
      }
    }
    for (let c = 0; c < cols; c += stride) {
      for (let r = 0; r + lag < rows; r += stride) {
        const d = at(r, c) - at(r + lag, c);
        if (Number.isFinite(d)) {
          sum += d * d;
          n++;
        }
      }
    }
    return Math.sqrt(sum / n);
  });
}

async function md5(path: string): Promise<string> {
  return createHash('md5').update(readFileSync(path)).digest('hex');
}

/** Structure function of the unit band-limited octave k at a lag in metres, by sampling. */
function octaveStructure(k: number, lagM: number, samples = 40000): number {
  const lagDeg = (lagM / R_M) * (180 / Math.PI);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const lat = -11 + (i % 200) * 0.0007;
    const lon = 4 + Math.floor(i / 200) * 0.0007 + (i % 7) * 1e-5;
    const east = i % 2 === 0;
    const d =
      bandLimitedOctave(lat, lon, k) -
      bandLimitedOctave(east ? lat : lat + lagDeg, east ? lon + lagDeg : lon, k);
    sum += d * d;
  }
  return Math.sqrt(sum / samples);
}

/** Non-negative least squares for a tiny system, by repeatedly dropping negative unknowns. */
function nnls(a: number[][], b: number[]): number[] {
  const n = a[0]?.length ?? 0;
  const active = new Set(Array.from({ length: n }, (_, i) => i));
  for (;;) {
    const idx = [...active];
    // Normal equations on the active set.
    const m = idx.map((i) =>
      idx.map((j) => a.reduce((s, row) => s + (row[i] ?? 0) * (row[j] ?? 0), 0)),
    );
    const v = idx.map((i) => a.reduce((s, row, r) => s + (row[i] ?? 0) * (b[r] ?? 0), 0));
    // Gaussian elimination.
    for (let p = 0; p < idx.length; p++) {
      const pivot = m[p]?.[p] ?? 1;
      for (let q = p + 1; q < idx.length; q++) {
        const f = (m[q]?.[p] ?? 0) / pivot;
        for (let c = p; c < idx.length; c++)
          (m[q] as number[])[c] = (m[q]?.[c] ?? 0) - f * (m[p]?.[c] ?? 0);
        v[q] = (v[q] ?? 0) - f * (v[p] ?? 0);
      }
    }
    const x = new Array<number>(idx.length).fill(0);
    for (let p = idx.length - 1; p >= 0; p--) {
      let s = v[p] ?? 0;
      for (let c = p + 1; c < idx.length; c++) s -= (m[p]?.[c] ?? 0) * (x[c] ?? 0);
      x[p] = s / (m[p]?.[p] ?? 1);
    }
    const negative = idx.filter((_, p) => (x[p] ?? 0) < 0);
    if (negative.length === 0) {
      const out = new Array<number>(n).fill(0);
      idx.forEach((i, p) => (out[i] = x[p] ?? 0));
      return out;
    }
    for (const i of negative) active.delete(i);
  }
}

if (import.meta.main) {
  // 1. The fall-off, from NASA's 2 m stereo models.
  const lags = [1, 2, 4, 8, 16, 32];
  const sites: ((typeof SITES)[number] & { sigmaM: number[]; ratio: number[] })[] = [];
  for (const s of SITES) {
    const path = await fetchPinned(`${NAC}${s.file}`, s.sha256, `nac_${s.site}.IMG`);
    if ((await md5(path)) !== s.md5) throw new Error(`${s.site}: MD5 differs from the PDS label`);
    const bytes = readFileSync(path);
    const view = new DataView(bytes.buffer, bytes.byteOffset + s.offset, s.lines * s.samples * 4);
    const at = (r: number, c: number): number => {
      const i = (r * s.samples + c) * 4;
      return view.getUint32(i, true) === NAC_MISSING || view.getUint32(i, true) >= 0xff7ffffb
        ? Number.NaN
        : view.getFloat32(i, true);
    };
    const sigma = structureFunction(at, s.lines, s.samples, lags);
    const at64 = sigma[sigma.length - 1] ?? 1;
    sites.push({
      ...s,
      sigmaM: sigma.map((v) => Number(v.toFixed(3))),
      ratio: sigma.map((v) => v / at64),
    });
    console.log(`${s.site} (${s.terrain}): RMS dh ${sigma.map((v) => v.toFixed(2)).join(', ')} m`);
  }
  const lagsM = lags.map((l) => l * NAC_SPACING_M);
  const ratio = lagsM.map(
    (_, i) => sites.reduce((sum, s) => sum + (s.ratio[i] ?? 0), 0) / sites.length,
  );
  const spread = lagsM.map((_, i) => {
    const values = sites.map((s) => s.ratio[i] ?? 0);
    return (Math.max(...values) - Math.min(...values)) / (ratio[i] ?? 1);
  });
  if (Math.max(...spread) > 0.25)
    throw new Error(`NAC sites disagree by ${spread} of the mean ratio`);
  // Power law through 2-8 m, for scales below the models' 2 m spacing.
  const xs = lagsM.slice(0, 3).map(Math.log);
  const ys = ratio.slice(0, 3).map(Math.log);
  const mx = xs.reduce((a, b) => a + b, 0) / 3;
  const my = ys.reduce((a, b) => a + b, 0) / 3;
  const hurst =
    xs.reduce((s, x, i) => s + (x - mx) * ((ys[i] ?? 0) - my), 0) /
    xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const ratioAt = (m: number): number => {
    if (m <= (lagsM[0] ?? 2)) return Math.exp(my + hurst * (Math.log(m) - mx));
    for (let i = 1; i < lagsM.length; i++) {
      const a = lagsM[i - 1] ?? 1;
      const b = lagsM[i] ?? 1;
      if (m <= b) {
        const t = (Math.log(m) - Math.log(a)) / (Math.log(b) - Math.log(a));
        return Math.exp(Math.log(ratio[i - 1] ?? 1) * (1 - t) + Math.log(ratio[i] ?? 1) * t);
      }
    }
    return 1;
  };

  // 2. Kaguya around Albategnius (a 12 km patch of the pinned file): its local 67 m roughness,
  // and how much the bilinear interpolation of its measurements already varies at each target
  // distance, measured rather than predicted.
  const kaguyaPath = await fetchPinned(
    KAGUYA_URL,
    KAGUYA_SHA256,
    'kaguya_tc_dtm_S09E003S12E006SC.img',
  );
  const kb = readFileSync(kaguyaPath);
  const kv = new DataView(kb.buffer, kb.byteOffset, kb.byteLength);
  const side = 3 * MEASURED_PPD;
  const kat = (r: number, c: number): number => {
    const v = kv.getInt16((r * side + c) * 2, false);
    return v === -9999 ? Number.NaN : v;
  };
  const r0 = Math.round((11.2 - 9) * MEASURED_PPD);
  const c0 = Math.round((4.2 - 3) * MEASURED_PPD);
  const patch = 1440;
  const [local67] = structureFunction(
    (r, c) => kat(r0 + r, c0 + c),
    patch,
    patch,
    [ANCHOR_SAMPLES],
    3,
  );
  const sigma67 = local67 ?? 0;
  /** RMS height difference at `lagM` on the patch: measurements interpolated, plus detail. */
  const rmsAt = (lagM: number, amplitudes: readonly number[]): number => {
    const lagDeg = (lagM / R_M) * (180 / Math.PI);
    const scaled = amplitudes.map((a) => a * sigma67);
    const surface = (lat: number, lon: number): number => {
      const row = (-9 - lat) * MEASURED_PPD;
      const col = (lon - 3) * MEASURED_PPD;
      const ri = Math.floor(row);
      const ci = Math.floor(col);
      const fr = row - ri;
      const fc = col - ci;
      const h =
        kat(ri, ci) * (1 - fr) * (1 - fc) +
        kat(ri, ci + 1) * (1 - fr) * fc +
        kat(ri + 1, ci) * fr * (1 - fc) +
        kat(ri + 1, ci + 1) * fr * fc;
      return h + detailM(lat, lon, scaled);
    };
    let sum = 0;
    let n = 0;
    for (let s = 0; s < 40000; s++) {
      const lat = -9 - (r0 + ((s * 7919) % (patch - 20)) + 5 + ((s * 0.618) % 1)) / MEASURED_PPD;
      const lon = 3 + (c0 + ((s * 104729) % (patch - 20)) + 5 + ((s * 0.414) % 1)) / MEASURED_PPD;
      const d =
        s % 2 === 0
          ? surface(lat, lon) - surface(lat, lon + lagDeg)
          : surface(lat, lon) - surface(lat + lagDeg, lon);
      if (Number.isFinite(d)) {
        sum += d * d;
        n++;
      }
    }
    return Math.sqrt(sum / n);
  };

  // 3. Octave amplitudes, per metre of local 67 m roughness: target squared minus what the
  // interpolated measurements already give, split over the octaves.
  const anchorM = ANCHOR_SAMPLES * KAGUYA_SPACING_M;
  const target = TARGET_M.map((m) => ratioAt(m) / ratioAt(anchorM));
  const interpolated = TARGET_M.map((m) => rmsAt(m, [0, 0, 0]) / sigma67);
  const needed = target.map((t, i) => Math.max(t * t - (interpolated[i] ?? 0) ** 2, 0));
  const g = TARGET_M.map((m) =>
    Array.from({ length: OCTAVES }, (_, k) => octaveStructure(k + 1, m) ** 2),
  );
  const amplitudes = nnls(g, needed).map((x) => Math.sqrt(Math.max(x, 0)));

  // Check on the same ground, with the detail added.
  const check = TARGET_M.map((m, i) => {
    const got = rmsAt(m, amplitudes);
    const want = (target[i] ?? 0) * sigma67;
    return {
      lagM: m,
      measuredOnlyM: Number(((interpolated[i] ?? 0) * sigma67).toFixed(3)),
      rmsM: Number(got.toFixed(3)),
      targetM: Number(want.toFixed(3)),
      ratio: Number((got / want).toFixed(3)),
    };
  });
  for (const c of check)
    console.log(`check at ${c.lagM} m: ${c.rmsM} m, target ${c.targetM} m (${c.ratio})`);
  if (check.some((c) => Math.abs(c.ratio - 1) > 0.25))
    throw new Error('approximated roughness misses its target by more than 25%');

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        note: 'Statistics for the labelled approximation below the measurements (docs/stories/SS-10b.md). Re-derive with npm run pipeline:roughness.',
        falloff: {
          source:
            'LROC NAC DTMs (PDS4 LRO-L-LROC-5-RDR), 2 m spacing; RMS height difference against distance, as a ratio to its value at 64 m',
          sites: sites.map((s) => ({
            site: s.site,
            terrain: s.terrain,
            url: `${NAC}${s.file}`,
            md5: s.md5,
            sha256: s.sha256,
            sigmaM: s.sigmaM,
          })),
          lagsM,
          ratio: ratio.map((v) => Number(v.toFixed(4))),
          siteSpread: spread.map((v) => Number(v.toFixed(3))),
          exponentBelow8m: Number(hurst.toFixed(3)),
          knownArtefact:
            'NAC DTM seams can step 0.5-1.0 m (the products’ README), which slightly raises small-scale roughness',
        },
        anchor: {
          source:
            'SELENE TC DTM_MAP_02, RMS height difference over 8 samples (67 m) near each place, at run time',
          samples: ANCHOR_SAMPLES,
        },
        octaves: {
          latticesPerDegree: Array.from({ length: OCTAVES }, (_, k) => MEASURED_PPD * 2 ** (k + 1)),
          amplitudePerAnchorMetre: amplitudes.map((v) => Number(v.toFixed(5))),
        },
        check: {
          site: 'Albategnius (Kaguya DTMs02_S09E003S12E006), 12 km patch',
          anchorM: Number(sigma67.toFixed(3)),
          lags: check,
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${OUT}`);
}
