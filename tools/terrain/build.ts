// npm run pipeline:tiles
//
// The Moon's terrain as streamed polygons for the website: quantized-mesh tiles in
// public/terrain/, built at deploy time from pinned sources and never committed (SS-10).
// The whole Moon at full measured detail is `npm run local` (SS-10c); this is the part that
// fits GitHub Pages:
//
// - Everywhere, levels 0-7 (vertices 0.67 km apart at level 7). Within 58 degrees of the
//   equator from SLDEM2015 (LOLA with Kaguya TC stereo, Barker et al. 2016), area-averaged
//   from 128 to 64 px/deg; poleward of 60 degrees from LOLA LDEM_64 (474 m); smoothstep between
//   (docs/stories/SS-10d.md). LOLA's grid is interpolated between laser tracks several km apart
//   near the equator; SLDEM2015 fills between them with Kaguya's stereo, so the relief there is
//   measured, not interpolated.
// - Around Albategnius, levels 6-11 from LOLA LDEM_512 (59 m), a pinned byte range of the PDS
//   file covering 45 S - 0, 0 - 90 E: vertices 83 m apart over the crater, 41 m at its peak.
// - Over the crater's floor and central peak, levels 12-13 from SELENE (Kaguya) TC DTM_MAP_02
//   seamless (8.4 m): vertices 21 m, and 10 m within about 9 km of the peak. Registered to
//   LDEM_512 on every build (the fit goes to sources.json; the build refuses past one sample
//   or 5 m), blended into LOLA across 0.02 degrees (600 m) at the box's edge, and replaced by
//   LOLA wherever Kaguya has no measurement.
//
// Every vertex height is a measurement (bilinear between measured samples); nothing is added
// between them. Formerly pipeline/terrain_tiles.py.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fetchPinned } from '../data/download.ts';
import { encodeTile, tileBounds, type HeightSource } from './quantizedMesh.ts';
import { openSync, readSync, closeSync } from 'node:fs';
import { Blend, Grid, LatitudeBlend, boxMean, type HeightField } from './sources.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'public', 'terrain');
const PDS =
  'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/float_img/';

// LOLA LDEM_64_FLOAT (PDS LRO-L-LOLA-4-GDR-V1.0): 23040 x 11520 little-endian float km from
// the 1737.4 km sphere, pixel-registered from 90 N and 0 E (pipeline/terrain.py pins it too).
const LDEM64_SHA256 = '4dd151f230984316602f13df36214563ff575683cb5612f1a7bc4699188ec25b';

// SLDEM2015_128_60S_60N_000_360_FLOAT (PDS LRO-L-LOLA-4-GDR-V1.0, product version V2.0), from
// its label: SIMPLE CYLINDRICAL, 128 px/deg, 15360 lines from 60 N by 46080 samples from 0 E,
// pixel-registered (LINE_PROJECTION_OFFSET 7679.5, SAMPLE_PROJECTION_OFFSET 23039.5), PC_REAL
// 32-bit little-endian km above the 1737.4 km sphere (OFFSET), POSITIVE_LONGITUDE_DIRECTION
// EAST, frame MEAN EARTH/POLAR AXIS OF DE421: the same frame, sphere and units as LDEM_64. LOLA
// publishes no checksum; the SHA-256 is pinned from the first download, whose size matched the
// label (15360 records of 184320 bytes).
const SLDEM_URL =
  'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/global/float_img/sldem2015_128_60s_60n_000_360_float.img';
const SLDEM_SHA256 = 'd937ff8f2f09dae2c56512f49649000b49ee79c50aa18ee7b5fb5d26a0d00e06';
const SLDEM_LINES = 15360;
const SLDEM_SAMPLES = 46080;
/** |latitude| where the blend from SLDEM2015 into LDEM_64 starts and ends, degrees. */
const SLDEM_BLEND = [58, 60] as const;

// LDEM_512 tile 45 S - 0, 0 - 90 E: 46080 samples per row. Rows 2560-8704 are latitude 5 S to
// 17 S; the first 10 degrees of longitude are kept.
const LDEM512_URL = `${PDS}ldem_512_45s_00s_000_090_float.img`;
const LDEM512_ROW_BYTES = 46080 * 4;
const LDEM512_ROWS = [2560, 8704] as const;
const LDEM512_SHA256 = 'aefcd8a8199df488d1f4f7a017e21a09443f8678d09c67c796003289473ab7e1';

// SELENE TC DTM_MAP_02 seamless (JAXA DARTS, SLN-L-TC-5-DTM-MAP-SEAMLESS-V2.0), from its label:
// simple cylindrical, planetocentric, east-positive, 3600 px/deg, 16-bit big-endian metres,
// DUMMY -9999; samples on whole multiples of 1/3600 degree, the first at 9.000000 S, 3.000000 E.
// JAXA publishes no checksum; the SHA-256 is pinned from the first download.
const KAGUYA_URL =
  'https://data.darts.isas.jaxa.jp/pub/pds3/sln-l-tc-5-dtm-map-seamless-v2.0/lon003/data/DTM_MAPs02_S09E003S12E006SC.img';
const KAGUYA_SHA256 = '267c14fc6b87fee85d1e5df91a12ea1d60412ddbf0e872987a4c6893356c84c1';
const KAGUYA_PPD = 3600;
const KAGUYA_DUMMY = -9999;

type Box = readonly [number, number, number, number];

// Albategnius's central peak: the highest Kaguya sample within 0.5 degrees of the crater's
// Gazetteer centre, 3.7717 E, 11.3044 S.
const PEAK = [3.77, -11.3] as const;
const KAGUYA_LEVEL = 12;
const KAGUYA_BOX: Box = [3.4, -11.8, 4.6, -10.6];
const BLEND_DEG = 0.02;
// Every level to 7 (0.67 km vertex spacing) covers the whole Moon, so orbit mode can fly low
// everywhere (docs/stories/SS-11b.md). Tiles are stored gzip-compressed: GitHub Pages counts a
// site's files uncompressed against its 1 GB limit, and the browser inflates them
// (src/scenes/moon.ts).
const GLOBAL_LEVELS = 7;
const BOXES: readonly (readonly [number, Box])[] = [
  [10, [1.5, -14.0, 6.5, -8.5]],
  [11, KAGUYA_BOX],
  [KAGUYA_LEVEL, KAGUYA_BOX],
  [13, [PEAK[0] - 0.3, PEAK[1] - 0.3, PEAK[0] + 0.3, PEAK[1] + 0.3]],
];

function floats(path: string, bigEndianInt16 = false): Float32Array {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bigEndianInt16) {
    const out = new Float32Array(bytes.byteLength / 2);
    for (let i = 0; i < out.length; i++) {
      const v = view.getInt16(i * 2, false);
      out[i] = v === KAGUYA_DUMMY ? Number.NaN : v / 1000;
    }
    return out;
  }
  const out = new Float32Array(bytes.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

async function ldem64(): Promise<Grid> {
  const path = await fetchPinned(`${PDS}ldem_64_float.img`, LDEM64_SHA256, 'ldem_64_float.img');
  return new Grid(floats(path), 11520, 23040, 90, 0, 64, true);
}

/**
 * SLDEM2015 area-averaged 2 x 2 to 64 px/deg (474 m, LDEM_64's grid): finer than the website's
 * finest global vertex spacing, and a quarter of the memory. Read two lines at a time.
 */
async function sldem64(): Promise<Grid> {
  const path = await fetchPinned(
    SLDEM_URL,
    SLDEM_SHA256,
    'sldem2015_128_60s_60n_000_360_float.img',
  );
  const rows = SLDEM_LINES / 2;
  const cols = SLDEM_SAMPLES / 2;
  const out = new Float32Array(rows * cols);
  const lineBytes = SLDEM_SAMPLES * 4;
  const buffer = Buffer.alloc(lineBytes * 2);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const fd = openSync(path, 'r');
  try {
    for (let r = 0; r < rows; r++) {
      if (readSync(fd, buffer, 0, buffer.length, r * buffer.length) !== buffer.length) {
        throw new Error('SLDEM2015 is shorter than its label says');
      }
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let n = 0;
        for (const offset of [0, lineBytes]) {
          for (const dc of [0, 1]) {
            const v = view.getFloat32(offset + (2 * c + dc) * 4, true);
            if (Number.isFinite(v)) {
              sum += v;
              n++;
            }
          }
        }
        out[r * cols + c] = n === 0 ? Number.NaN : sum / n;
      }
    }
  } finally {
    closeSync(fd);
  }
  return new Grid(out, rows, cols, 60, 0, 64, true);
}

/**
 * How SLDEM2015 (averaged to 64 px/deg) sits against LDEM_64 on the same grid, equatorward of
 * the blend: mean and RMS difference, and correlation. Barker et al. co-registered it to LOLA,
 * so a mean beyond a few metres would mean a misread file.
 */
function agreement(band: Grid, lola: Grid) {
  const rowOffset = (lola.latTop - band.latTop) * band.ppd;
  let n = 0;
  let sd = 0;
  let sdd = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let r = 0; r < band.rows; r++) {
    const lat = band.latTop - (r + 0.5) / band.ppd;
    if (Math.abs(lat) >= SLDEM_BLEND[0]) continue;
    for (let c = 0; c < band.cols; c++) {
      const x = (band.km[r * band.cols + c] ?? Number.NaN) * 1000;
      const y = (lola.km[(r + rowOffset) * lola.cols + c] ?? Number.NaN) * 1000;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const d = x - y;
      n++;
      sd += d;
      sdd += d * d;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
  }
  const mean = sd / n;
  const round = (v: number, digits: number): number => Number(v.toFixed(digits));
  return {
    samples: n,
    meanDifferenceM: round(mean, 2),
    rmsDifferenceM: round(Math.sqrt(sdd / n), 2),
    correlation: round(
      (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy)),
      6,
    ),
  };
}

async function albategnius(): Promise<Grid> {
  const path = await fetchPinned(
    LDEM512_URL,
    LDEM512_SHA256,
    `ldem512_rows_${LDEM512_ROWS[0]}_${LDEM512_ROWS[1]}.img`,
    {
      byteRange: [LDEM512_ROWS[0] * LDEM512_ROW_BYTES, LDEM512_ROWS[1] * LDEM512_ROW_BYTES],
    },
  );
  const all = floats(path);
  const rows = LDEM512_ROWS[1] - LDEM512_ROWS[0];
  const cols = 10 * 512;
  const kept = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) kept.set(all.subarray(r * 46080, r * 46080 + cols), r * cols);
  return new Grid(kept, rows, cols, -5, 0, 512);
}

async function kaguya(): Promise<Grid> {
  const path = await fetchPinned(KAGUYA_URL, KAGUYA_SHA256, 'kaguya_tc_dtm_S09E003S12E006SC.img');
  const side = 3 * KAGUYA_PPD;
  // Samples sit on the grid lines, so the pixel-registered edges are half a sample outside.
  const half = 0.5 / KAGUYA_PPD;
  return new Grid(floats(path, true), side, side, -9 + half, 3 - half, KAGUYA_PPD);
}

/**
 * How Kaguya sits against LOLA LDEM_512 over `box`, at LOLA's pixel centres. Kaguya is
 * averaged over each LOLA pixel's footprint (7 x 7 samples), and pixels touching a Kaguya
 * no-data sample are left out. The horizontal offset is the shift, searched in 0.0001 degree
 * steps to +-0.0012 degrees (35 m), that minimises the RMS difference after removing the mean;
 * the vertical offset is the mean difference at that shift.
 */
export function registration(fine: Grid, lola: Grid, box: Box) {
  const [w, s, e, n] = box;
  const rows: number[] = [];
  const cols: number[] = [];
  for (
    let r = Math.ceil((lola.latTop - n) * lola.ppd);
    r < Math.floor((lola.latTop - s) * lola.ppd);
    r++
  )
    rows.push(r);
  for (
    let c = Math.ceil((w - lola.lonWest) * lola.ppd);
    c < Math.floor((e - lola.lonWest) * lola.ppd);
    c++
  )
    cols.push(c);
  const k = Math.floor(fine.ppd / lola.ppd) | 1;
  const holes = fine.km.map((v) => (Number.isNaN(v) ? 1 : 0));
  const smooth = new Grid(
    boxMean(
      fine.km.map((v) => (Number.isNaN(v) ? 0 : v)),
      fine.rows,
      fine.cols,
      k,
    ),
    fine.rows,
    fine.cols,
    fine.latTop,
    fine.lonWest,
    fine.ppd,
  );
  const nearHole = new Grid(
    boxMean(holes, fine.rows, fine.cols, k),
    fine.rows,
    fine.cols,
    fine.latTop,
    fine.lonWest,
    fine.ppd,
  );
  const lat: number[] = [];
  const lon: number[] = [];
  const ref: number[] = [];
  for (const r of rows) {
    for (const c of cols) {
      const la = lola.latTop - (r + 0.5) / lola.ppd;
      const lo = lola.lonWest + (c + 0.5) / lola.ppd;
      if (nearHole.heightM(la, lo) !== 0) continue;
      lat.push(la);
      lon.push(lo);
      ref.push((lola.km[r * lola.cols + c] ?? Number.NaN) * 1000);
    }
  }
  const stats = (dLat: number, dLon: number) => {
    let sum = 0;
    let sumSq = 0;
    const d = new Float64Array(lat.length);
    for (let i = 0; i < lat.length; i++) {
      const v = smooth.heightM((lat[i] ?? 0) + dLat, (lon[i] ?? 0) + dLon) - (ref[i] ?? 0);
      d[i] = v;
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / lat.length;
    return { mean, rms: Math.sqrt(Math.max(sumSq / lat.length - mean * mean, 0)), d };
  };
  let best = { rms: Infinity, dLat: 0, dLon: 0, mean: 0 };
  for (let i = -12; i <= 12; i++) {
    for (let j = -12; j <= 12; j++) {
      const dLat = Math.round(i * 1e-4 * 1e6) / 1e6;
      const dLon = Math.round(j * 1e-4 * 1e6) / 1e6;
      const { mean, rms } = stats(dLat, dLon);
      if (rms < best.rms) best = { rms, dLat, dLon, mean };
    }
  }
  const zero = stats(0, 0);
  const sorted = Float64Array.from(zero.d).sort();
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const mad =
    Float64Array.from(zero.d, (v) => Math.abs(v - median)).sort()[Math.floor(sorted.length / 2)] ??
    0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < lat.length; i++) {
    const x = (zero.d[i] ?? 0) + (ref[i] ?? 0);
    const y = ref[i] ?? 0;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const m = lat.length;
  const correlation = (m * sxy - sx * sy) / Math.sqrt((m * sxx - sx * sx) * (m * syy - sy * sy));
  const round = (v: number, digits: number): number => Number(v.toFixed(digits));
  return {
    box: [...box],
    lolaPixels: m,
    correlation: round(correlation, 6),
    unshifted: { meanM: round(zero.mean, 2), rmsM: round(zero.rms, 2), madM: round(mad, 2) },
    bestShift: {
      dlatDeg: best.dLat,
      dlonDeg: best.dLon,
      meanM: round(best.mean, 2),
      rmsM: round(best.rms, 2),
    },
    kaguyaNoDataSamples: holes.reduce((a, v) => a + v, 0),
  };
}

/**
 * GitHub Pages publishes at most 1 GB, counted uncompressed on disk. The terrain may use 900 MB
 * of it, leaving the rest for the app and its data.
 */
const TERRAIN_BUDGET_BYTES = 900e6;

function sizeOf(dir: string): number {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((sum, entry) => sum + statSync(join(entry.parentPath, entry.name)).size, 0);
}

function source(field: HeightField): HeightSource {
  return async (lat, lon) => lat.map((la, i) => field.heightM(la, lon[i] ?? 0));
}

async function build(
  global: HeightField,
  regions: readonly (readonly [number, HeightField])[],
): Promise<number> {
  rmSync(OUT, { recursive: true, force: true });
  const maxLevel = Math.max(GLOBAL_LEVELS, ...BOXES.map(([level]) => level));
  const available: { startX: number; startY: number; endX: number; endY: number }[][] = [];
  let count = 0;
  for (let z = 0; z <= maxLevel; z++) {
    const nx = 2 ** (z + 1);
    const ny = 2 ** z;
    const size = 180 / ny;
    const ranges: [[number, number], [number, number]][] = [];
    if (z <= GLOBAL_LEVELS) {
      ranges.push([
        [0, nx - 1],
        [0, ny - 1],
      ]);
    } else {
      for (const [level, [w, s, e, n]] of BOXES) {
        if (z <= level) {
          ranges.push([
            [Math.floor((w + 180) / size), Math.floor((e + 180) / size)],
            [Math.floor((s + 90) / size), Math.floor((n + 90) / size)],
          ]);
        }
      }
    }
    available.push(
      ranges.map(([xs, ys]) => ({ startX: xs[0], startY: ys[0], endX: xs[1], endY: ys[1] })),
    );
    const done = new Set<string>();
    for (const [xs, ys] of ranges) {
      for (let x = xs[0]; x <= xs[1]; x++) {
        for (let y = ys[0]; y <= ys[1]; y++) {
          if (done.has(`${x}/${y}`)) continue;
          done.add(`${x}/${y}`);
          const [west, south, east, north] = tileBounds(z, x, y);
          const field =
            regions.find(([level, f]) => z >= level && f.contains(west, south, east, north))?.[1] ??
            global;
          const path = join(OUT, String(z), String(x), `${y}.terrain`);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, gzipSync(await encodeTile(z, x, y, source(field)), { level: 9 }));
          count++;
        }
      }
    }
  }
  const layer = {
    tilejson: '2.1.0',
    name: 'moon-lola',
    format: 'quantized-mesh-1.0',
    version: '1.0.0',
    scheme: 'tms',
    projection: 'EPSG:4326',
    bounds: [-180, -90, 180, 90],
    tiles: ['{z}/{x}/{y}.terrain'],
    available,
    extensions: ['octvertexnormals'],
    attribution:
      'SLDEM2015 (LOLA and SELENE TC), LOLA LDEM_64 and LDEM_512 (PDS LRO-L-LOLA-4-GDR-V1.0); SELENE TC DTM_MAP_02 (JAXA)',
  };
  writeFileSync(join(OUT, 'layer.json'), JSON.stringify(layer, null, 1));
  return count;
}

if (import.meta.main) {
  const [ldem, band, lola, fine] = await Promise.all([
    ldem64(),
    sldem64(),
    albategnius(),
    kaguya(),
  ]);
  const bandFit = agreement(band, ldem);
  console.log(`SLDEM2015 against LDEM_64: ${JSON.stringify(bandFit)}`);
  if (Math.abs(bandFit.meanDifferenceM) > 5) {
    throw new Error('SLDEM2015 no longer agrees with LDEM_64 within 5 m on average: review');
  }
  const global = new LatitudeBlend(band, ldem, SLDEM_BLEND[0], SLDEM_BLEND[1]);
  const fit = registration(fine, lola, [3.1, -11.9, 5.9, -9.1]);
  console.log(`Kaguya against LOLA: ${JSON.stringify(fit)}`);
  // Registration within one Kaguya sample and a sub-metre vertical offset are below what either
  // product resolves, so Kaguya is used as published: no shift, no offset.
  if (
    Math.max(Math.abs(fit.bestShift.dlatDeg), Math.abs(fit.bestShift.dlonDeg)) > 1 / KAGUYA_PPD ||
    Math.abs(fit.unshifted.meanM) > 5
  ) {
    throw new Error(
      'Kaguya no longer registers to LOLA within one sample and 5 m: review before building',
    );
  }
  const count = await build(global, [
    [KAGUYA_LEVEL, new Blend(fine, lola, KAGUYA_BOX, BLEND_DEG)],
    [0, lola],
  ]);
  writeFileSync(
    join(OUT, 'sources.json'),
    `${JSON.stringify(
      {
        global: {
          levels: `0-${GLOBAL_LEVELS}`,
          band: {
            source:
              'SLDEM2015_128_60S_60N_000_360_FLOAT (PDS LRO-L-LOLA-4-GDR-V1.0, V2.0): LOLA with Kaguya TC stereo, Barker et al. (2016)',
            sha256: SLDEM_SHA256,
            averaged: '2 x 2 to 64 px/deg',
            agreementWithLdem64: bandFit,
          },
          poles: 'LOLA LDEM_64_FLOAT (PDS LRO-L-LOLA-4-GDR-V1.0)',
          blend: `smoothstep from SLDEM2015 at |latitude| ${SLDEM_BLEND[0]} to LDEM_64 at ${SLDEM_BLEND[1]} deg`,
        },
        compression: 'gzip, level 9',
        albategnius: {
          source: 'LOLA LDEM_512_45S_00S_000_090_FLOAT, rows 2560-8704 (byte range)',
          sha256: LDEM512_SHA256,
          boxes: BOXES,
        },
        kaguya: {
          source: 'SELENE TC DTM_MAPs02_S09E003S12E006SC (SLN-L-TC-5-DTM-MAP-SEAMLESS-V2.0)',
          sha256: KAGUYA_SHA256,
          levels: `${KAGUYA_LEVEL}+`,
          box: KAGUYA_BOX,
          blendDeg: BLEND_DEG,
          registration: fit,
        },
        frame: 'MOON_ME (MEAN EARTH/POLAR AXIS OF DE421), metres, 1737.4 km sphere',
      },
      null,
      2,
    )}\n`,
  );
  const bytes = sizeOf(OUT);
  console.log(`${count} tiles in ${OUT}: ${(bytes / 1e6).toFixed(0)} MB`);
  if (bytes > TERRAIN_BUDGET_BYTES) {
    throw new Error(
      `terrain is ${(bytes / 1e6).toFixed(0)} MB, over its ${TERRAIN_BUDGET_BYTES / 1e6} MB budget`,
    );
  }
}
