// npm run pipeline:mercury:tiles [-- <out dir>]
//
// Mercury's terrain for the website: quantized-mesh tiles, levels 0-7 everywhere (vertices about
// 940 m apart at level 7), for Mercury's own data repository and its own 1 GB of GitHub Pages
// (owner, 2026-10-08, "Own data repo, L7"; docs/stories/SS-16.md, W4).
//
// The composite (owner, 2026-10-08, "MLA north, DEM faded"):
// - north of 80 N, MLA's gridded radius (hdem_64), where its tracks cover 96-98% of 3.7 km cells;
// - south of 70 N, the USGS stereo DEM, lowered by its median offset to MLA, measured at the
//   pixels holding laser shots (hdec_64 > 0) over 70-80 N;
// - linear in latitude between. Where MLA has no value, the DEM, and the source map says so.
// Every vertex height is bilinear between composite samples; nothing is added between them.
//
// Both products' labels: DN x 0.5 m above the 2439.4 km sphere, LSB 16-bit, simple cylindrical,
// 64 px/deg, east-positive, CENTER_LONGITUDE 180, LINE_PROJECTION_OFFSET 5759.5 and
// SAMPLE_PROJECTION_OFFSET 11519.5 (so column 0 starts at 0 E), MISSING_CONSTANT -32768. MLA's
// grid holds rows from 90 N to 18 S only. Tiles are metres above that sphere. Writes
// public/data/mercury/terrain.json (the fit and every check) and terrain-source.png.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { endianness } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { fetchPinned } from '../data/download.ts';
import { encodeTile, type HeightSource } from './quantizedMesh.ts';
import { Grid } from './sources.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const DATA = join(ROOT, 'public', 'data', 'mercury');
const OUT = process.argv[2] ?? join(ROOT, 'dist-mercury', 'terrain');

/** The DEM's and MLA's sphere, metres. */
export const MERCURY_R_M = 2_439_400;
const PPD = 64;
const WIDTH = 360 * PPD;
const HEIGHT = 180 * PPD;
const MLA_ROWS = 108 * PPD;
const MISSING = -32768;
const LEVELS = 7;
/** MLA alone north of MLA_FROM_DEG, the DEM alone south of DEM_TO_DEG, linear between. */
export const MLA_FROM_DEG = 80;
export const DEM_TO_DEG = 70;

/** As Mars's: the data site holds only its terrain, so the tiles may use 950 MB of the 1 GB. */
const BUDGET_BYTES = 950e6;

const SOURCES = {
  dem: {
    url: 'https://planetarydata.jpl.nasa.gov/img/data/messenger/MESSDEM_1001/DEM/GLOBAL/IMG/MSGR_DEM_USG_SC_I_V02.IMG',
    sha256: 'b1bb587a9414ff542a74337866582eb7b1b16e325f90a6367116f9f4cc9cdf30',
    name: 'mercury-dem-usgs-v2.img',
    note: 'USGS global DEM v2 (PDS MESSDEM_1001); publisher MD5 5365bd7c870710214c6a18dac1a28b0f matched at first retrieval',
  },
  mla: {
    url: 'https://pds-geosciences.wustl.edu/messenger/mess-e_v_h-mla-3_4-cdr_rdr-data-v1/messmla_2001/gdr/img/hdem_64.img',
    sha256: '38c9b9471eb6413b1dcc694aed9337441a5a3e8eab0ddb90cfaa6be3d1ecf9e9',
    name: 'mercury-mla-hdem_64.img',
    note: 'MLA gridded radius, version 2.0 (PDS messmla_2001); no publisher checksum, pinned at first retrieval 2026-10-08',
  },
  counts: {
    url: 'https://pds-geosciences.wustl.edu/messenger/mess-e_v_h-mla-3_4-cdr_rdr-data-v1/messmla_2001/gdr/img/hdec_64.img',
    sha256: '936312db8cdd0a36ff35d1092aa2eee55753dd11e834540b1576b65308931672',
    name: 'mercury-mla-hdec_64.img',
    note: 'MLA shots per hdem_64 pixel; no publisher checksum, pinned at first retrieval 2026-10-08',
  },
} as const;

/** The source of each composite sample. */
export const SOURCE_CLASSES = ['USGS DEM, offset to MLA', 'blend', 'MLA', 'USGS DEM, MLA missing'];

export function latOfRow(row: number): number {
  return 90 - (row + 0.5) / PPD;
}

/** MLA's weight at a latitude: 1 north of MLA_FROM_DEG, 0 south of DEM_TO_DEG, linear between. */
export function mlaWeight(lat: number): number {
  return Math.min(Math.max((lat - DEM_TO_DEG) / (MLA_FROM_DEG - DEM_TO_DEG), 0), 1);
}

/** Slope (m per pixel, central difference) above which a shot pixel counts for registration. */
const STEEP_M = 60;

/** An int16 half-metre grid sampled bilinearly at fractional (row, col), metres; columns wrap.
 * NaN outside the rows or next to a missing value. */
export function bilinearM(field: Int16Array, rows: number, r: number, c: number): number {
  const r0 = Math.floor(r);
  if (r0 < 0 || r0 + 1 >= rows) return Number.NaN;
  const c0 = Math.floor(c);
  const fr = r - r0;
  const fc = c - c0;
  const ca = ((c0 % WIDTH) + WIDTH) % WIDTH;
  const cb = (ca + 1) % WIDTH;
  const a = field[r0 * WIDTH + ca] ?? MISSING;
  const b = field[r0 * WIDTH + cb] ?? MISSING;
  const d = field[(r0 + 1) * WIDTH + ca] ?? MISSING;
  const e = field[(r0 + 1) * WIDTH + cb] ?? MISSING;
  if (a === MISSING || b === MISSING || d === MISSING || e === MISSING) return Number.NaN;
  return 0.5 * ((1 - fr) * ((1 - fc) * a + fc * b) + fr * ((1 - fc) * d + fc * e));
}

export function median(values: Float32Array): number {
  const sorted = Float32Array.from(values).sort();
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const mid = n >> 1;
  return n % 2 ? (sorted[mid] ?? Number.NaN) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function int16(path: string, rows: number): Int16Array {
  const bytes = readFileSync(path);
  if (bytes.byteLength !== rows * WIDTH * 2) throw new Error(`${path}: unexpected size`);
  // Little-endian on disk (LSB_INTEGER), read as the host's own order; copy so it is aligned.
  if (endianness() !== 'LE') throw new Error('this reader assumes a little-endian host');
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const round = (x: number, digits = 1): number => Number(x.toFixed(digits));

interface Composite {
  km: Float32Array;
  source: Uint8Array;
  manifest: Record<string, unknown>;
}

async function composite(): Promise<Composite> {
  const paths = {
    dem: await fetchPinned(SOURCES.dem.url, SOURCES.dem.sha256, SOURCES.dem.name),
    mla: await fetchPinned(SOURCES.mla.url, SOURCES.mla.sha256, SOURCES.mla.name),
    counts: await fetchPinned(SOURCES.counts.url, SOURCES.counts.sha256, SOURCES.counts.name),
  };
  const dem = int16(paths.dem, HEIGHT);
  const mla = int16(paths.mla, MLA_ROWS);
  const counts = int16(paths.counts, MLA_ROWS);
  const shot = (i: number): boolean =>
    (counts[i] ?? 0) > 0 && dem[i] !== MISSING && mla[i] !== MISSING;

  // Registration (owner, 2026-10-08, "Shift MLA to DEM frame"): the shift (rows, cols) for which
  // DEM(r - s.row, c - s.col) best matches MLA(r, c), by the spread of their difference at shot
  // pixels on slopes steeper than STEEP_M per pixel, 60-80 N, searched in quarter pixels. MLA is
  // then resampled at (r + s.row, c + s.col) into the DEM's frame, which the MDIS maps share.
  const steep: number[] = [];
  for (let r = 10 * PPD; r < 30 * PPD; r++) {
    for (let c = 0, i = r * WIDTH; c < WIDTH; c++, i++) {
      if (!shot(i)) continue;
      const ns = Math.abs((dem[i + WIDTH] ?? 0) - (dem[i - WIDTH] ?? 0)) * 0.25;
      const ew =
        Math.abs(
          (dem[r * WIDTH + ((c + 1) % WIDTH)] ?? 0) -
            (dem[r * WIDTH + ((c + WIDTH - 1) % WIDTH)] ?? 0),
        ) * 0.25;
      if (Math.max(ns, ew) > STEEP_M) steep.push(i);
    }
  }
  const spread = (
    field: Int16Array,
    rows: number,
    sRow: number,
    sCol: number,
    other: (i: number) => number,
  ): number => {
    let n = 0;
    let sum = 0;
    let sum2 = 0;
    for (const i of steep) {
      const r = Math.floor(i / WIDTH);
      const c = i - r * WIDTH;
      const d = bilinearM(field, rows, r - sRow, c - sCol) - other(i);
      if (!Number.isFinite(d)) continue;
      n++;
      sum += d;
      sum2 += d * d;
    }
    const mean = sum / n;
    return Math.sqrt(sum2 / n - mean * mean);
  };
  const search = (other: (i: number) => number, field: Int16Array, rows: number) => {
    const grid: { row: number; col: number; stdM: number }[] = [];
    for (let a = -6; a <= 6; a++) {
      for (let b = -6; b <= 6; b++) {
        grid.push({
          row: a / 4,
          col: b / 4,
          stdM: round(spread(field, rows, a / 4, b / 4, other), 2),
        });
      }
    }
    return grid.reduce((x, y) => (y.stdM < x.stdM ? y : x));
  };
  const mlaM = (i: number): number => (mla[i] ?? 0) * 0.5;
  const fitted = search(mlaM, dem, HEIGHT);
  if (Math.abs(fitted.row) > 1.5 - 0.25 || Math.abs(fitted.col) > 1.5 - 0.25) {
    throw new Error(
      `the registration fit reached the edge of its search: ${JSON.stringify(fitted)}`,
    );
  }
  // MLA in the DEM's frame: at DEM pixel (r, c), MLA sampled at (r + row, c + col).
  const mlaShifted = (r: number, c: number): number =>
    bilinearM(mla, MLA_ROWS, r + fitted.row, c + fitted.col);
  // Check: the DEM against the shifted MLA now fits best unshifted, within a quarter pixel.
  const residual = search((i) => mlaShifted(Math.floor(i / WIDTH), i % WIDTH), dem, HEIGHT);
  if (Math.abs(residual.row) > 0.25 || Math.abs(residual.col) > 0.25) {
    throw new Error(`after the shift, the DEM still fits best at ${JSON.stringify(residual)}`);
  }

  // The DEM's offset to MLA: median of DEM - MLA at shot pixels, 70-80 N, in the DEM's frame.
  const overlap: number[] = [];
  for (let r = 0; r < MLA_ROWS; r++) {
    const lat = latOfRow(r);
    if (lat <= DEM_TO_DEG || lat >= MLA_FROM_DEG) continue;
    for (let c = 0, i = r * WIDTH; c < WIDTH; c++, i++) {
      if (!shot(i)) continue;
      const d = bilinearM(dem, HEIGHT, r - fitted.row, c - fitted.col) - mlaM(i);
      if (Number.isFinite(d)) overlap.push(d);
    }
  }
  const offsetM = median(Float32Array.from(overlap));

  // The composite, km above the sphere, and its source.
  const km = new Float32Array(HEIGHT * WIDTH);
  const source = new Uint8Array(HEIGHT * WIDTH);
  let demMissing = 0;
  for (let r = 0; r < HEIGHT; r++) {
    const w = r < MLA_ROWS ? mlaWeight(latOfRow(r)) : 0;
    for (let c = 0, i = r * WIDTH; c < WIDTH; c++, i++) {
      const d = dem[i] ?? MISSING;
      if (d === MISSING) demMissing++;
      const demM = d * 0.5 - offsetM;
      const m = w > 0 ? mlaShifted(r, c) : Number.NaN;
      if (!Number.isFinite(m)) {
        km[i] = demM / 1000;
        source[i] = w === 0 ? 0 : 3;
      } else {
        km[i] = (w * m + (1 - w) * demM) / 1000;
        source[i] = w === 1 ? 2 : 1;
      }
    }
  }
  if (demMissing > 0) throw new Error(`the DEM has ${demMissing} missing pixels`);

  // The composite against MLA at shot pixels, by 15-degree band, in MLA's own frame.
  const kmAt = (r: number, c: number): number => {
    const r0 = Math.floor(r);
    const c0 = Math.floor(c);
    const fr = r - r0;
    const fc = c - c0;
    const at = (rr: number, cc: number): number =>
      km[Math.min(Math.max(rr, 0), HEIGHT - 1) * WIDTH + (((cc % WIDTH) + WIDTH) % WIDTH)] ??
      Number.NaN;
    return (
      ((1 - fr) * ((1 - fc) * at(r0, c0) + fc * at(r0, c0 + 1)) +
        fr * ((1 - fc) * at(r0 + 1, c0) + fc * at(r0 + 1, c0 + 1))) *
      1000
    );
  };
  const bands: Record<string, unknown>[] = [];
  for (let top = 90; top > -18; top -= 15) {
    const diffs: number[] = [];
    let sum2 = 0;
    for (let r = (90 - top) * PPD; r < Math.min((105 - top) * PPD, MLA_ROWS); r++) {
      for (let c = 0, i = r * WIDTH; c < WIDTH; c++, i++) {
        if (!shot(i)) continue;
        const d = kmAt(r - fitted.row, c - fitted.col) - mlaM(i);
        diffs.push(d);
        sum2 += d * d;
      }
    }
    if (diffs.length === 0) continue;
    bands.push({
      latitudeDeg: `${top} to ${top - 15}`,
      shotPixels: diffs.length,
      medianM: round(median(Float32Array.from(diffs))),
      rmsM: round(Math.sqrt(sum2 / diffs.length)),
    });
  }

  const share = (k: number): number => {
    let num = 0;
    let den = 0;
    for (let r = 0; r < HEIGHT; r++) {
      const a = Math.cos((latOfRow(r) * Math.PI) / 180);
      let n = 0;
      for (let c = 0, i = r * WIDTH; c < WIDTH; c++, i++) if (source[i] === k) n++;
      num += a * n;
      den += a * WIDTH;
    }
    return round(num / den, 5);
  };

  const manifest = {
    story: 'docs/stories/SS-16.md (W4)',
    chosen:
      'owner, 2026-10-08: own data repo, levels 0-7; MLA north of 80 N, USGS DEM south of 70 N offset to MLA, linear blend between',
    sources: Object.fromEntries(
      Object.entries(SOURCES).map(([k, s]) => [k, { url: s.url, sha256: s.sha256, note: s.note }]),
    ),
    conventions:
      'heights in metres above the 2439.4 km sphere (both labels); planetocentric, east-positive; grid 64 px/deg, column 0 at 0 E, row 0 at 90 N, pixel-registered',
    offset: {
      model:
        'composite DEM = USGS DEM - offset; offset = median(DEM - MLA) at pixels holding laser shots, 70-80 N',
      offsetM: round(offsetM),
      shotPixels: overlap.length,
    },
    registration: {
      model:
        'MLA resampled at (row + shift.row, col + shift.col) into the DEM frame (owner, 2026-10-08, "Shift MLA to DEM frame")',
      fit: `the shift minimising the spread of DEM(r - row, c - col) - MLA(r, c) at shot pixels on slopes over ${STEEP_M} m per pixel, 60-80 N, in quarter pixels to 1.5 px`,
      pixels: steep.length,
      shiftPx: fitted,
      mlaRelativeToDemM: {
        north: round((-fitted.row * MERCURY_R_M * Math.PI) / 180 / PPD),
        east: round((fitted.col * MERCURY_R_M * Math.PI) / 180 / PPD),
      },
      residualAfterShift: residual,
    },
    blend: {
      mlaAloneNorthOfDeg: MLA_FROM_DEG,
      demAloneSouthOfDeg: DEM_TO_DEG,
      weight: 'linear in latitude',
    },
    compositeAgainstMla: bands,
    coverage: Object.fromEntries(SOURCE_CLASSES.map((name, k) => [name, share(k)])),
    source: {
      file: 'terrain-source.png',
      codes: Object.fromEntries(SOURCE_CLASSES.map((n, k) => [k * 85, n])),
      sampling: 'every 16th pixel: 4 px/deg, 1440 x 720, column 0 at 0 E',
    },
  };
  return { km, source, manifest };
}

function sourcePng(source: Uint8Array): Buffer {
  const w = WIDTH / 16;
  const h = HEIGHT / 16;
  const png = new PNG({ width: w, height: h, colorType: 0, inputColorType: 0, bitDepth: 8 });
  const grey = Buffer.alloc(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++)
      grey[r * w + c] = (source[(r * 16 + 8) * WIDTH + c * 16 + 8] ?? 0) * 85;
  }
  png.data = grey;
  return PNG.sync.write(png, { colorType: 0, inputColorType: 0 });
}

function sizeOf(dir: string): number {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((sum, entry) => sum + statSync(join(entry.parentPath, entry.name)).size, 0);
}

if (import.meta.main) {
  const { km, source, manifest } = await composite();
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, 'terrain-source.png'), sourcePng(source));
  writeFileSync(join(DATA, 'terrain.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ offset: manifest.offset, coverage: manifest.coverage }));
  const grid = new Grid(km, HEIGHT, WIDTH, 90, 0, PPD, true);
  const heights: HeightSource = async (lat, lon) =>
    lat.map((la, i) => grid.heightM(la, lon[i] ?? 0));
  rmSync(OUT, { recursive: true, force: true });
  let count = 0;
  for (let z = 0; z <= LEVELS; z++) {
    for (let x = 0; x < 2 ** (z + 1); x++) {
      for (let y = 0; y < 2 ** z; y++) {
        const path = join(OUT, String(z), String(x), `${y}.terrain`);
        mkdirSync(dirname(path), { recursive: true });
        const tile = await encodeTile(z, x, y, heights, 65, MERCURY_R_M);
        writeFileSync(path, gzipSync(tile, { level: 9 }));
        count++;
      }
    }
    console.log(`level ${z}: ${count} tiles`);
  }
  writeFileSync(
    join(OUT, 'layer.json'),
    JSON.stringify(
      {
        tilejson: '2.1.0',
        name: 'mercury-usgs-mla',
        format: 'quantized-mesh-1.0',
        version: '1.0.0',
        scheme: 'tms',
        projection: 'EPSG:4326',
        bounds: [-180, -90, 180, 90],
        tiles: ['{z}/{x}/{y}.terrain'],
        available: Array.from({ length: LEVELS + 1 }, (_, z) => [
          { startX: 0, startY: 0, endX: 2 ** (z + 1) - 1, endY: 2 ** z - 1 },
        ]),
        extensions: ['octvertexnormals'],
        attribution:
          'USGS MESSENGER global DEM v2 (PDS MESSDEM_1001, Becker et al. 2016); MESSENGER MLA gridded topography (PDS messmla_2001, Smith et al.)',
      },
      null,
      1,
    ),
  );
  const bytes = sizeOf(OUT);
  console.log(`${count} tiles in ${OUT}: ${(bytes / 1e6).toFixed(0)} MB`);
  if (bytes > BUDGET_BYTES) {
    throw new Error(
      `Mercury terrain is ${(bytes / 1e6).toFixed(0)} MB, over its ${BUDGET_BYTES / 1e6} MB budget`,
    );
  }
}
