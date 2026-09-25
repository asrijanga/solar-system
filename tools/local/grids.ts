// The measured elevation grids the local server streams from, exactly as their publishers lay
// them out, and a block store that fetches only the parts a view needs.
//
// Every grid is simple cylindrical, planetocentric, east-positive, heights from the 1737.4 km
// sphere (each product's PDS label; docs/data/moon.md). Blocks of up to 256 x 256 samples are
// fetched with one multi-range request (one range per row) and cached on disk.

import {
  mkdirSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
  renameSync,
  statSync,
} from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { rangeHeader, splitRanges, type ByteRange } from './multipart.ts';

export const BLOCK = 256;

/** One file as its label describes it. */
export interface FileSpec {
  readonly id: string;
  readonly url: string;
  readonly rows: number;
  readonly cols: number;
  /** 32-bit little-endian float km (LOLA), or 16-bit big-endian integer metres (Kaguya). */
  readonly dtype: 'f32le-km' | 'i16be-m';
  /** A sample value meaning "not measured". */
  readonly nodata: number | null;
  /** Downloaded whole: the server ignores ranges (JAXA DARTS), or the file is small. */
  readonly whole: boolean;
}

/** A product: one or more files forming one grid over its coverage. */
export interface Product {
  readonly id: string;
  readonly ppd: number;
  /** Latitude of row 0, longitude of column 0: pixel edges, or sample positions if `point`. */
  readonly north: number;
  readonly west: number;
  readonly rows: number;
  /** Always 360 degrees: longitude wraps. */
  readonly cols: number;
  /** Samples sit on grid lines (Kaguya) rather than at pixel centres (LOLA). */
  readonly point: boolean;
  locate(row: number, col: number): { file: FileSpec; r: number; c: number } | null;
}

const LOLA = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/';
const KAGUYA = 'https://data.darts.isas.jaxa.jp/pub/pds3/sln-l-tc-5-dtm-map-seamless-v2.0/';

function single(id: string, ppd: number, whole: boolean): Product {
  const file: FileSpec = {
    id,
    url: `${LOLA}lola_gdr/cylindrical/float_img/${id}.img`,
    rows: 180 * ppd,
    cols: 360 * ppd,
    dtype: 'f32le-km',
    nodata: null,
    whole,
  };
  return {
    id,
    ppd,
    north: 90,
    west: 0,
    rows: file.rows,
    cols: file.cols,
    point: false,
    locate: (r, c) => ({ file, r, c }),
  };
}

/** LOLA LDEM_16 (1.9 km), 66 MB: fetched whole. */
export const LDEM_16 = single('ldem_16_float', 16, true);
/** LOLA LDEM_64 (474 m). */
export const LDEM_64 = single('ldem_64_float', 64, false);
/** LOLA LDEM_128 (237 m). */
export const LDEM_128 = single('ldem_128_float', 128, false);

/** "45s", "00n": the equator takes the hemisphere of the band it bounds ("45s_00s", "00n_45n"). */
const hemi = (lat: number, southBand: boolean): string =>
  `${String(Math.abs(lat)).padStart(2, '0')}${lat < 0 || (lat === 0 && southBand) ? 's' : 'n'}`;
const deg3 = (lon: number): string => String(lon).padStart(3, '0');

/** A mosaic of equal files, `fileLat` x `fileLon` degrees, from `north` down and 0 E eastward. */
function mosaic(
  id: string,
  ppd: number,
  north: number,
  south: number,
  fileLat: number,
  fileLon: number,
  name: (top: number, bottom: number, west: number, east: number) => string,
): Product {
  const rowsPer = fileLat * ppd;
  const colsPer = fileLon * ppd;
  const files = new Map<string, FileSpec>();
  return {
    id,
    ppd,
    north,
    west: 0,
    rows: (north - south) * ppd,
    cols: 360 * ppd,
    point: false,
    locate(row, col) {
      const i = Math.floor(row / rowsPer);
      const j = Math.floor(col / colsPer);
      const top = north - i * fileLat;
      const west = j * fileLon;
      const key = `${i}_${j}`;
      let file = files.get(key);
      if (file === undefined) {
        const path = name(top, top - fileLat, west, west + fileLon);
        file = {
          id: path.slice(path.lastIndexOf('/') + 1, -'.img'.length),
          url: `${LOLA}${path}`,
          rows: rowsPer,
          cols: colsPer,
          dtype: 'f32le-km',
          nodata: null,
          whole: false,
        };
        files.set(key, file);
      }
      return { file, r: row - i * rowsPer, c: col - j * colsPer };
    },
  };
}

/** LOLA LDEM_512 (59 m), 16 files of 45 x 90 degrees, 4.2 GB each. */
export const LDEM_512 = mosaic(
  'ldem_512',
  512,
  90,
  -90,
  45,
  90,
  (top, bottom, w, e) =>
    `lola_gdr/cylindrical/float_img/ldem_512_${hemi(bottom, bottom < 0)}_${hemi(top, bottom < 0)}_${deg3(w)}_${deg3(e)}_float.img`,
);

/** SLDEM2015 (LOLA with Kaguya TC, Barker et al. 2016), 59 m, 60 S to 60 N, 32 files. */
export const SLDEM2015 = mosaic(
  'sldem2015_512',
  512,
  60,
  -60,
  30,
  45,
  (top, bottom, w, e) =>
    `sldem2015/tiles/float_img/sldem2015_512_${hemi(bottom, bottom < 0)}_${hemi(top, bottom < 0)}_${deg3(w)}_${deg3(e)}_float.img`,
);

/** Kaguya TC DTM file name for the 3 x 3 degree cell whose top-left sample is (top, west). */
export function kaguyaName(top: number, west: number): string {
  const lat = (v: number): string => `${v < 0 ? 'S' : 'N'}${String(Math.abs(v)).padStart(2, '0')}`;
  return `DTM_MAPs02_${lat(top)}E${deg3(west)}${lat(top - 3)}E${deg3(west + 3)}SC`;
}

const KAGUYA_PPD = 3600;
const KAGUYA_NORTH = 84;

/** SELENE TC DTM_MAP_02 seamless, 8.4 m sampling, 84 S to 84 N, 3 x 3 degree files. */
export const KAGUYA_TC: Product = (() => {
  const per = 3 * KAGUYA_PPD;
  const files = new Map<string, FileSpec>();
  return {
    id: 'kaguya_tc_dtm_map_02',
    ppd: KAGUYA_PPD,
    north: KAGUYA_NORTH,
    west: 0,
    rows: 2 * KAGUYA_NORTH * KAGUYA_PPD,
    cols: 360 * KAGUYA_PPD,
    point: true,
    locate(row, col) {
      const i = Math.floor(row / per);
      const j = Math.floor(col / per);
      const top = KAGUYA_NORTH - 3 * i;
      const west = 3 * j;
      const key = `${i}_${j}`;
      let file = files.get(key);
      if (file === undefined) {
        const id = kaguyaName(top, west);
        file = {
          id,
          url: `${KAGUYA}lon${deg3(west)}/data/${id}.img`,
          rows: per,
          cols: per,
          dtype: 'i16be-m',
          nodata: -9999,
          whole: true,
        };
        files.set(key, file);
      }
      return { file, r: row - i * per, c: col - j * per };
    },
  };
})();

/** Fetches, caches and decodes blocks. Heights come out in metres, NaN where not measured. */
export class BlockStore {
  private readonly memory = new Map<string, Float32Array>();
  private readonly pending = new Map<string, Promise<Float32Array>>();
  private readonly downloads = new Map<string, Promise<string | null>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly cacheDir: string;
  private readonly concurrency: number;
  private readonly log: (message: string) => void;

  constructor(cacheDir: string, concurrency = 4, log: (message: string) => void = () => undefined) {
    this.cacheDir = cacheDir;
    this.concurrency = concurrency;
    this.log = log;
  }

  block(file: FileSpec, br: number, bc: number): Promise<Float32Array> {
    const key = `${file.id}/${br}_${bc}`;
    const hit = this.memory.get(key);
    if (hit !== undefined) {
      // Most recently used last.
      this.memory.delete(key);
      this.memory.set(key, hit);
      return Promise.resolve(hit);
    }
    let promise = this.pending.get(key);
    if (promise === undefined) {
      promise = this.load(file, br, bc, key).finally(() => this.pending.delete(key));
      this.pending.set(key, promise);
    }
    return promise;
  }

  private async load(file: FileSpec, br: number, bc: number, key: string): Promise<Float32Array> {
    const path = join(this.cacheDir, 'blocks', `${key}.f32`);
    let values: Float32Array;
    if (existsSync(path)) {
      const bytes = await readFile(path);
      values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    } else {
      values = file.whole
        ? await this.fromWhole(file, br, bc)
        : await this.fromRanges(file, br, bc);
      mkdirSync(dirname(path), { recursive: true });
      await writeFile(path, new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
    }
    this.memory.set(key, values);
    // About 256 MB of decoded blocks in memory; the disk cache keeps the rest.
    while (this.memory.size > 1024) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
    return values;
  }

  private span(file: FileSpec, br: number, bc: number) {
    const r0 = br * BLOCK;
    const c0 = bc * BLOCK;
    return { r0, c0, h: Math.min(BLOCK, file.rows - r0), w: Math.min(BLOCK, file.cols - c0) };
  }

  private bytesPer(file: FileSpec): number {
    return file.dtype === 'f32le-km' ? 4 : 2;
  }

  private decode(
    file: FileSpec,
    bytes: Uint8Array,
    out: Float32Array,
    at: number,
    n: number,
  ): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < n; i++) {
      const v =
        file.dtype === 'f32le-km'
          ? view.getFloat32(i * 4, true) * 1000
          : view.getInt16(i * 2, false);
      out[at + i] = file.nodata !== null && v === file.nodata ? Number.NaN : v;
    }
  }

  private async fromRanges(file: FileSpec, br: number, bc: number): Promise<Float32Array> {
    const { r0, c0, h, w } = this.span(file, br, bc);
    const bps = this.bytesPer(file);
    const ranges: ByteRange[] = [];
    for (let r = 0; r < h; r++) {
      const start = ((r0 + r) * file.cols + c0) * bps;
      ranges.push({ start, end: start + w * bps });
    }
    const response = await this.network(() =>
      fetch(file.url, { headers: { Range: rangeHeader(ranges) } }),
    );
    if (response.status !== 206) {
      throw new Error(`${file.url}: expected 206 for a range request, got ${response.status}`);
    }
    // The file must be the size its label gives: rows x columns x sample size.
    const total = /\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1];
    const body = new Uint8Array(await response.arrayBuffer());
    const parts = splitRanges(
      body,
      response.headers.get('content-type') ?? '',
      response.headers.get('content-range'),
      ranges,
    );
    if (total !== undefined && Number(total) !== file.rows * file.cols * bps) {
      throw new Error(
        `${file.url} is ${total} bytes, its label implies ${file.rows * file.cols * bps}`,
      );
    }
    const out = new Float32Array(h * w);
    parts.forEach((part, r) => this.decode(file, part, out, r * w, w));
    this.log(`fetched ${file.id} block ${br},${bc}`);
    return out;
  }

  private async fromWhole(file: FileSpec, br: number, bc: number): Promise<Float32Array> {
    const { r0, c0, h, w } = this.span(file, br, bc);
    const path = await this.download(file);
    const out = new Float32Array(h * w);
    if (path === null) return out.fill(Number.NaN); // not published: not measured
    const bps = this.bytesPer(file);
    const fd = openSync(path, 'r');
    try {
      const row = new Uint8Array(w * bps);
      for (let r = 0; r < h; r++) {
        readSync(fd, row, 0, row.length, ((r0 + r) * file.cols + c0) * bps);
        this.decode(file, row, out, r * w, w);
      }
    } finally {
      closeSync(fd);
    }
    return out;
  }

  /** The whole file on disk, or null if the publisher has no such file (404). */
  private download(file: FileSpec): Promise<string | null> {
    let promise = this.downloads.get(file.id);
    if (promise === undefined) {
      promise = this.fetchWhole(file);
      this.downloads.set(file.id, promise);
    }
    return promise;
  }

  private async fetchWhole(file: FileSpec): Promise<string | null> {
    const path = join(this.cacheDir, 'files', `${file.id}.img`);
    const size = file.rows * file.cols * this.bytesPer(file);
    if (existsSync(path) && statSync(path).size === size) return path;
    const missing = `${path}.missing`;
    if (existsSync(missing)) return null;
    mkdirSync(dirname(path), { recursive: true });
    this.log(`downloading ${file.url} (${(size / 1e6).toFixed(0)} MB)`);
    const response = await this.network(() => fetch(file.url));
    if (response.status === 404) {
      await writeFile(missing, '');
      return null;
    }
    if (!response.ok || response.body === null)
      throw new Error(`${file.url}: HTTP ${response.status}`);
    const partial = `${path}.partial`;
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));
    if (statSync(partial).size !== size) {
      throw new Error(
        `${file.url}: got ${statSync(partial).size} bytes, the label implies ${size}`,
      );
    }
    renameSync(partial, path);
    this.log(`downloaded ${file.id}`);
    return path;
  }

  private async network<T>(task: () => Promise<T>): Promise<T> {
    while (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

/** Fractional grid position of (lat, lon) in a product; null outside its latitude coverage. */
export function gridPosition(
  product: Product,
  lat: number,
  lon: number,
): { row: number; col: number } | null {
  const shift = product.point ? 0 : 0.5;
  const row = (product.north - lat) * product.ppd - shift;
  const east = (((lon - product.west) % 360) + 360) % 360;
  const col = east * product.ppd - shift;
  const last = product.rows - 1;
  // Pixel-registered grids reach half a pixel past their outer centres.
  if (row < -shift - 1e-9 || row > last + shift + 1e-9) return null;
  return { row: Math.min(Math.max(row, 0), last), col };
}

/**
 * Bilinear heights (metres) of a product at many points, NaN where it has no measurement:
 * outside its coverage, or where any of the four surrounding samples is a no-data value.
 */
export async function sampleProduct(
  product: Product,
  store: BlockStore,
  lat: Float64Array,
  lon: Float64Array,
): Promise<Float64Array> {
  const n = lat.length;
  const out = new Float64Array(n).fill(Number.NaN);
  const corner = (row: number, col: number) => {
    const c = ((col % product.cols) + product.cols) % product.cols;
    const r = Math.min(Math.max(row, 0), product.rows - 1);
    const at = product.locate(r, c);
    if (at === null) return null;
    return {
      file: at.file,
      br: Math.floor(at.r / BLOCK),
      bc: Math.floor(at.c / BLOCK),
      i: at.r % BLOCK,
      j: at.c % BLOCK,
    };
  };
  const plans: ({ corners: ReturnType<typeof corner>[]; fr: number; fc: number } | null)[] = [];
  const needed = new Map<string, { file: FileSpec; br: number; bc: number }>();
  for (let k = 0; k < n; k++) {
    const p = gridPosition(product, lat[k] ?? 0, lon[k] ?? 0);
    if (p === null) {
      plans.push(null);
      continue;
    }
    const r0 = Math.min(Math.floor(p.row), product.rows - 2);
    const c0 = Math.floor(p.col);
    const corners = [
      corner(r0, c0),
      corner(r0, c0 + 1),
      corner(r0 + 1, c0),
      corner(r0 + 1, c0 + 1),
    ];
    for (const c of corners) {
      if (c !== null) needed.set(`${c.file.id}/${c.br}_${c.bc}`, c);
    }
    plans.push({ corners, fr: Math.min(Math.max(p.row - r0, 0), 1), fc: p.col - c0 });
  }
  const blocks = new Map<string, { data: Float32Array; w: number }>();
  await Promise.all(
    [...needed.entries()].map(async ([key, { file, br, bc }]) => {
      const data = await store.block(file, br, bc);
      blocks.set(key, { data, w: Math.min(BLOCK, file.cols - bc * BLOCK) });
    }),
  );
  const value = (c: ReturnType<typeof corner>): number => {
    if (c === null) return Number.NaN;
    const b = blocks.get(`${c.file.id}/${c.br}_${c.bc}`);
    return b === undefined ? Number.NaN : (b.data[c.i * b.w + c.j] ?? Number.NaN);
  };
  plans.forEach((plan, k) => {
    if (plan === null) return;
    const [a, b, c, d] = plan.corners.map(value) as [number, number, number, number];
    const { fr, fc } = plan;
    out[k] = a * (1 - fc) * (1 - fr) + b * fc * (1 - fr) + c * (1 - fc) * fr + d * fc * fr;
  });
  return out;
}
