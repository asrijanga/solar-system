// Mars at full measured detail, on this computer (docs/stories/SS-14.md, W5): the sources and
// the level ladder the local server builds Mars's tiles from, as tools/local/ladder.ts does for
// the Moon.
//
// - Levels 0-7: the website's own tiles (W4), from Mars's data site, unchanged.
// - Levels 8-12: HRSC stereo strips at their native 50-200 m, each registered to MOLA by its
//   W4 fit and faded into MOLA's 128 px/deg grid by the website's own per-bin weights (owner,
//   2026-10-03, "Fade 5 km"); MOLA alone where no strip measured. Beyond 88 degrees, MOLA's
//   polar 512 px/deg grid.
// - Levels 13-17: HiRISE DTMs (1-2 m) where one measured and passed its registration (owner,
//   "Moon's rule: within 5 m"); elsewhere the level-12 heights, per vertex.
//
// Heights are above MOLA's areoid in every source; tiles are on the 3396 km sphere, as the
// website's: areoid radius (MEGDR mega) - 3396 km + height.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { BLOCK, sampleProduct, type BlockStore, type FileSpec, type Product } from './grids.ts';
import {
  labelNumber,
  molaPolar,
  parseLabel,
  projectionOf,
  type Label,
  type Projection,
} from './marsProjection.ts';
import type { HeightSource } from '../terrain/quantizedMesh.ts';
import type { TileRange } from '../../src/core/terrain.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const MOLA = 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/';
const HIRISE = 'https://hirise-pds.lpl.arizona.edu/PDS/';
/** Mars's data site (W4): the website's tiles and the HRSC fade weights. */
export const DATA_SITE = 'https://asrijanga.github.io/solar-system-mars-data/terrain/';

/** The MEGDR's sphere, metres: tile heights are measured from it. */
export const SPHERE_M = 3_396_000;
/** The website's deepest level (W4); local mode builds the levels below it. */
export const WEBSITE_LEVELS = 7;
export const HRSC_TO = 12;
export const MAX_LEVEL = 17;
/** Where the cylindrical MEGDR stops and the polar grids take over, degrees. */
const POLAR_LAT = 88;
/** HiRISE registration (owner, 2026-10-03, "Moon's rule: within 5 m"; SS-10c). */
const HIRISE_MAX_OFFSET_M = 5;

/** Vertex spacing of a level, metres on the sphere: 65 vertices across a tile. */
export function vertexSpacingM(level: number): number {
  return ((180 / 2 ** level / 64) * Math.PI * SPHERE_M) / 180;
}

/** Where levels exist: 0-12 everywhere, 13-17 over the HiRISE models' bounding boxes. */
export function marsAvailability(boxes: readonly Box[]): TileRange[][] {
  const out: TileRange[][] = [];
  for (let z = 0; z <= MAX_LEVEL; z++) {
    const rows = 2 ** z;
    if (z <= HRSC_TO) {
      out.push([{ startX: 0, startY: 0, endX: 2 * rows - 1, endY: rows - 1 }]);
      continue;
    }
    const size = 180 / rows;
    out.push(
      boxes.map((b) => {
        const west = b.west > 180 ? b.west - 360 : b.west;
        const east = west + (b.east - b.west);
        return {
          startX: Math.max(0, Math.floor((west + 180) / size)),
          startY: Math.max(0, Math.floor((b.south + 90) / size)),
          endX: Math.min(2 * rows - 1, Math.floor((east + 180) / size)),
          endY: Math.min(rows - 1, Math.floor((b.north + 90) / size)),
        };
      }),
    );
  }
  return out;
}

// ---- MOLA ----------------------------------------------------------------------------------

const deg3 = (v: number): string => String(v).padStart(3, '0');

/**
 * MOLA MEGDR at 128 px/deg (463 m), 16 files of 44 x 90 degrees from 88 N to 88 S, named by
 * their top latitude and west longitude (`megt88n000hb.img`); from the labels, MSB 16-bit metres
 * (megt) or unsigned bytes (megc, shots per bin), pixel-registered, simple cylindrical.
 */
export function megdr128(kind: 'megt' | 'megc'): Product {
  const ppd = 128;
  const rowsPer = 44 * ppd;
  const colsPer = 90 * ppd;
  const files = new Map<string, FileSpec>();
  return {
    id: `${kind}128`,
    ppd,
    north: POLAR_LAT,
    west: 0,
    rows: 2 * POLAR_LAT * ppd,
    cols: 360 * ppd,
    point: false,
    locate(row, col) {
      const i = Math.floor(row / rowsPer);
      const j = Math.floor(col / colsPer);
      const top = POLAR_LAT - 44 * i;
      const name = `${kind}${String(Math.abs(top)).padStart(2, '0')}${top < 0 ? 's' : 'n'}${deg3(90 * j)}hb`;
      let file = files.get(name);
      if (file === undefined) {
        file = {
          id: `mars-${name}`,
          url: `${MOLA}meg128/${name}.img`,
          rows: rowsPer,
          cols: colsPer,
          dtype: kind === 'megt' ? 'i16be-m' : 'u8',
          nodata: null,
          whole: false,
        };
        files.set(name, file);
      }
      return { file, r: row - i * rowsPer, c: col - j * colsPer };
    },
  };
}

/** MOLA's areoid radius (MEGDR mega, 16 px/deg, MSB 16-bit metres + 3396000), 33 MB whole. */
export const AREOID: Product = (() => {
  const file: FileSpec = {
    id: 'mars-mega90n000eb',
    url: `${MOLA}meg016/mega90n000eb.img`,
    rows: 180 * 16,
    cols: 360 * 16,
    dtype: 'i16be-m',
    nodata: null,
    whole: true,
  };
  return {
    id: 'mega16',
    ppd: 16,
    north: 90,
    west: 0,
    rows: file.rows,
    cols: file.cols,
    point: false,
    locate: (r, c) => ({ file, r, c }),
  };
})();

/** MOLA's polar MEGDR topography at 512 px/deg (115 m), 12288 x 12288, 73.15 to 90 degrees. */
function polar512(north: boolean): { file: FileSpec; projection: Projection } {
  const name = `megt_${north ? 'n' : 's'}_512_1`;
  const n = 12288;
  return {
    file: {
      id: `mars-${name}`,
      url: `${MOLA}polar/${name}.img`,
      rows: n,
      cols: n,
      dtype: 'u16be-q',
      nodata: null,
      whole: false,
    },
    projection: molaPolar(north, n, 512),
  };
}
const POLAR = { north: polar512(true), south: polar512(false) } as const;

// ---- Projected rasters ---------------------------------------------------------------------

/**
 * Heights of a projected raster at many points, metres, NaN where it has none: bilinear when
 * `box` is 1 (NaN if any of the four samples is missing), else the mean of the box x box samples
 * nearest each point, NaN unless at least half of them are measured.
 */
export async function sampleRaster(
  store: BlockStore,
  file: FileSpec,
  projection: Projection,
  lat: Float64Array,
  lon: Float64Array,
  box = 1,
): Promise<Float64Array> {
  const n = lat.length;
  const out = new Float64Array(n).fill(Number.NaN);
  const plans: ({ cells: [number, number][]; fr: number; fc: number } | null)[] = [];
  const needed = new Map<string, [number, number]>();
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < file.rows && c < file.cols;
  for (let k = 0; k < n; k++) {
    const p = projection.toPixel(lat[k] ?? 0, lon[k] ?? 0);
    if (p === null) {
      plans.push(null);
      continue;
    }
    const cells: [number, number][] = [];
    let fr = 0;
    let fc = 0;
    if (box <= 1) {
      const r0 = Math.floor(p.row);
      const c0 = Math.floor(p.col);
      fr = p.row - r0;
      fc = p.col - c0;
      for (const [dr, dc] of [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ] as const) {
        cells.push([r0 + dr, c0 + dc]);
      }
    } else {
      const r0 = Math.round(p.row - (box - 1) / 2);
      const c0 = Math.round(p.col - (box - 1) / 2);
      for (let i = 0; i < box; i++) for (let j = 0; j < box; j++) cells.push([r0 + i, c0 + j]);
    }
    if (!cells.some(([r, c]) => inside(r, c))) {
      plans.push(null);
      continue;
    }
    for (const [r, c] of cells) {
      if (inside(r, c)) {
        const br = Math.floor(r / BLOCK);
        const bc = Math.floor(c / BLOCK);
        needed.set(`${br}_${bc}`, [br, bc]);
      }
    }
    plans.push({ cells, fr, fc });
  }
  const blocks = new Map<string, Float32Array>();
  await Promise.all(
    [...needed.entries()].map(async ([key, [br, bc]]) => {
      blocks.set(key, await store.block(file, br, bc));
    }),
  );
  const value = (r: number, c: number): number => {
    if (!inside(r, c)) return Number.NaN;
    const br = Math.floor(r / BLOCK);
    const bc = Math.floor(c / BLOCK);
    const data = blocks.get(`${br}_${bc}`);
    const w = Math.min(BLOCK, file.cols - bc * BLOCK);
    return data?.[(r - br * BLOCK) * w + (c - bc * BLOCK)] ?? Number.NaN;
  };
  plans.forEach((plan, k) => {
    if (plan === null) return;
    const v = plan.cells.map(([r, c]) => value(r, c));
    if (box <= 1) {
      const [a, b, c, d] = v as [number, number, number, number];
      const { fr, fc } = plan;
      out[k] = a * (1 - fc) * (1 - fr) + b * fc * (1 - fr) + c * (1 - fc) * fr + d * fc * fr;
    } else {
      const measured = v.filter((x) => !Number.isNaN(x));
      if (measured.length * 2 >= v.length) {
        out[k] = measured.reduce((s, x) => s + x, 0) / measured.length;
      }
    }
  });
  return out;
}

/** A file's attached PDS label, from its first 64 kB, cached on disk. */
async function remoteLabel(url: string, cachePath: string): Promise<Label> {
  if (existsSync(cachePath)) return parseLabel(await readFile(cachePath, 'utf8'));
  const response = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
  if (response.status !== 206 && response.status !== 200) {
    throw new Error(`${url}: HTTP ${response.status} for its label`);
  }
  const head = new Uint8Array(await response.arrayBuffer()).subarray(0, 65536);
  const text = new TextDecoder('latin1').decode(head);
  const end = text.search(/\r?\nEND\s*\r?\n/);
  if (end < 0) throw new Error(`${url}: no END to its label in the first 64 kB`);
  const label = text.slice(0, end + 5);
  mkdirSync(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, label);
  return parseLabel(label);
}

/** The image a label describes, as a block-store file: its offset, size and sample type. */
function imageFile(id: string, url: string, label: Label, extra: Partial<FileSpec>): FileSpec {
  const recordBytes = labelNumber(label, 'RECORD_BYTES');
  const pointer = labelNumber(label, '^IMAGE');
  const type = (label.get('SAMPLE_TYPE') ?? '').replace(/"/g, '');
  const bits = labelNumber(label, 'SAMPLE_BITS');
  const dtype =
    type === 'PC_REAL' && bits === 32
      ? 'f32le-m'
      : type === 'MSB_INTEGER' && bits === 16
        ? 'i16be-m'
        : null;
  if (dtype === null) throw new Error(`${id}: unexpected samples ${type} ${bits}`);
  return {
    id,
    url,
    rows: labelNumber(label, 'LINES'),
    cols: labelNumber(label, 'LINE_SAMPLES'),
    dtype,
    nodata: dtype === 'i16be-m' ? -32768 : null,
    whole: false,
    offset: (pointer - 1) * recordBytes,
    ...extra,
  };
}

/** Axis-aligned extent in degrees: longitudes 0-360 east, `east` may pass 360. */
export interface Box {
  readonly south: number;
  readonly north: number;
  readonly west: number;
  readonly east: number;
}

function covers(b: Box, lat: number, lon: number): boolean {
  if (lat < b.south || lat > b.north) return false;
  const e = ((lon % 360) + 360) % 360;
  return (e >= b.west && e <= b.east) || (e + 360 >= b.west && e + 360 <= b.east);
}

/** Boxes bucketed by whole degree, to find the ones over a point without scanning them all. */
class BoxIndex<T extends { box: Box }> {
  private readonly cells = new Map<number, T[]>();
  constructor(items: readonly T[]) {
    for (const item of items) {
      const { south, north, west, east } = item.box;
      for (let la = Math.floor(south); la <= Math.floor(north); la++) {
        for (let lo = Math.floor(west); lo <= Math.floor(east); lo++) {
          const key = (la + 90) * 360 + (((lo % 360) + 360) % 360);
          const list = this.cells.get(key) ?? [];
          list.push(item);
          this.cells.set(key, list);
        }
      }
    }
  }
  at(lat: number, lon: number): T[] {
    const e = ((lon % 360) + 360) % 360;
    const key = (Math.min(Math.floor(lat), 89) + 90) * 360 + (Math.floor(e) % 360);
    return (this.cells.get(key) ?? []).filter((item) => covers(item.box, lat, lon));
  }
}

/** The median of the measured values at each point, NaN where none measured. */
function medianOf(columns: readonly Float64Array[], n: number): Float64Array {
  const out = new Float64Array(n).fill(Number.NaN);
  for (let k = 0; k < n; k++) {
    const v = columns.map((c) => c[k] ?? Number.NaN).filter((x) => !Number.isNaN(x));
    if (v.length === 0) continue;
    v.sort((a, b) => a - b);
    const m = v.length >> 1;
    out[k] = v.length % 2 === 1 ? (v[m] ?? 0) : ((v[m - 1] ?? 0) + (v[m] ?? 0)) / 2;
  }
  return out;
}

// ---- HRSC ----------------------------------------------------------------------------------

interface Strip {
  readonly name: string;
  readonly box: Box;
  readonly offsetM: number;
  readonly url: string;
  readonly sha256: string;
}

interface TerrainManifest {
  readonly composite: { leftOut: Record<string, unknown> };
  readonly fits: Record<
    string,
    { offsetM?: number; extent?: { rows: [number, number]; cols: [number, number] } }
  >;
  readonly localMode: { hrscWeight: { sha256: string } };
}

/**
 * HRSC strips used by the website's composite (W4), with its registration: the offset to MOLA
 * fitted there. The 26 left out there are left out here.
 */
export function hrscStrips(manifest: TerrainManifest, sources: unknown): Strip[] {
  const listing = sources as {
    base: string;
    strips: Record<string, { path: string; sha256: string }>;
  };
  const out: Strip[] = [];
  for (const [name, fit] of Object.entries(manifest.fits)) {
    if (name in manifest.composite.leftOut) continue;
    if (fit.extent === undefined || fit.offsetM === undefined) continue;
    const entry = listing.strips[name];
    if (entry === undefined) throw new Error(`${name} is not in pipeline/hrsc_dtm_sources.json`);
    const [r0, r1] = fit.extent.rows;
    const [c0, c1] = fit.extent.cols;
    out.push({
      name,
      // The extent is in 64 px/deg bins, columns from 0 E; one bin of margin either side.
      box: {
        north: 90 - (r0 - 1) / 64,
        south: 90 - (r1 + 1) / 64,
        west: (c0 - 1) / 64,
        east: (c1 + 1) / 64,
      },
      offsetM: fit.offsetM,
      url: `${listing.base}${entry.path}`,
      sha256: entry.sha256,
    });
  }
  return out;
}

// ---- HiRISE --------------------------------------------------------------------------------

interface Model {
  readonly id: string;
  readonly url: string;
  readonly box: Box;
}

/** HiRISE DTMs from the archive's cumulative index (`PDS/INDEX/DTMCUMINDEX.TAB`). */
export function hiriseModels(indexText: string): Model[] {
  const out: Model[] = [];
  for (const line of indexText.split(/\r?\n/)) {
    const cells = [...line.matchAll(/"([^"]*)"|([^,]+)/g)].map((m) => (m[1] ?? m[2] ?? '').trim());
    if (cells.length < 19 || cells[11] !== 'DTM') continue;
    const [south, north, west, east] = [15, 16, 17, 18].map((i) => Number(cells[i]));
    const path = cells[1] ?? '';
    out.push({
      id: cells[4] ?? path,
      url: `${HIRISE}${path}`,
      box: { south: south ?? 0, north: north ?? 0, west: west ?? 0, east: east ?? 0 },
    });
  }
  return out;
}

interface Verdict {
  readonly ok: boolean;
  readonly meanM: number;
  readonly points: number;
  readonly shotBins: number;
}

// ---- The ladder ----------------------------------------------------------------------------

export class MarsLadder {
  private readonly store: BlockStore;
  private readonly cacheDir: string;
  private readonly log: (message: string) => void;
  private readonly megt = megdr128('megt');
  private readonly megc = megdr128('megc');
  private readonly strips: BoxIndex<Strip>;
  private readonly weightSha: string;
  private weight: Promise<Uint8Array> | null = null;
  private readonly hrscFiles = new Map<
    string,
    Promise<{ file: FileSpec; projection: Projection; scaleM: number }>
  >();
  private hirise: Promise<BoxIndex<Model>> | null = null;
  private readonly hiriseFiles = new Map<
    string,
    Promise<{ file: FileSpec; projection: Projection }>
  >();
  private readonly verdictPath: string;
  private readonly verdicts: Record<string, Verdict>;
  private readonly checking = new Map<string, Promise<Verdict>>();

  constructor(
    store: BlockStore,
    cacheDir: string,
    log: (message: string) => void = () => undefined,
  ) {
    this.store = store;
    this.cacheDir = cacheDir;
    this.log = log;
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'public', 'data', 'mars', 'terrain.json'), 'utf8'),
    ) as TerrainManifest;
    const sources: unknown = JSON.parse(
      readFileSync(join(ROOT, 'pipeline', 'hrsc_dtm_sources.json'), 'utf8'),
    );
    this.strips = new BoxIndex(hrscStrips(manifest, sources));
    this.weightSha = manifest.localMode.hrscWeight.sha256;
    this.verdictPath = join(cacheDir, 'hirise-registration.json');
    this.verdicts = existsSync(this.verdictPath)
      ? (JSON.parse(readFileSync(this.verdictPath, 'utf8')) as Record<string, Verdict>)
      : {};
  }

  /** HiRISE's bounding boxes, for the layer's availability. */
  async hiriseBoxes(): Promise<Box[]> {
    return hiriseModels(await this.hiriseIndexText()).map((m) => m.box);
  }

  /** Heights above the 3396 km sphere for a level below the website's (8-17). */
  heightsFor(level: number): HeightSource {
    return async (lat, lon) => {
      const n = lat.length;
      const [areoid, terrain] = await Promise.all([
        sampleProduct(AREOID, this.store, lat, lon),
        this.aboveAreoid(level, lat, lon),
      ]);
      const out = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        out[k] = (areoid[k] ?? Number.NaN) + (terrain[k] ?? Number.NaN);
      }
      return out;
    };
  }

  /** Heights above the areoid: HiRISE where registered and measured, else HRSC into MOLA. */
  async aboveAreoid(level: number, lat: Float64Array, lon: Float64Array): Promise<Float64Array> {
    const base = await this.hrscIntoMola(Math.min(level, HRSC_TO), lat, lon);
    if (level <= HRSC_TO) return base;
    const fine = await this.hiriseAt(lat, lon);
    return base.map((v, k) => {
      const h = fine[k] ?? Number.NaN;
      return Number.isNaN(h) ? v : h;
    });
  }

  private async mola(lat: Float64Array, lon: Float64Array): Promise<Float64Array> {
    const out = await sampleProduct(this.megt, this.store, lat, lon);
    for (const [north, polar] of [
      [true, POLAR.north],
      [false, POLAR.south],
    ] as const) {
      const idx: number[] = [];
      lat.forEach((la, k) => {
        if (north ? la > POLAR_LAT : la < -POLAR_LAT) idx.push(k);
      });
      if (idx.length === 0) continue;
      const values = await sampleRaster(
        this.store,
        polar.file,
        polar.projection,
        Float64Array.from(idx, (k) => lat[k] ?? 0),
        Float64Array.from(idx, (k) => lon[k] ?? 0),
      );
      idx.forEach((k, i) => (out[k] = values[i] ?? Number.NaN));
    }
    return out;
  }

  private async hrscIntoMola(
    level: number,
    lat: Float64Array,
    lon: Float64Array,
  ): Promise<Float64Array> {
    const n = lat.length;
    const [mola, weight] = await Promise.all([this.mola(lat, lon), this.weightAt(lat, lon)]);
    // The strips over this tile, and the points each covers.
    const byStrip = new Map<Strip, number[]>();
    for (let k = 0; k < n; k++) {
      if ((weight[k] ?? 0) <= 0) continue;
      for (const s of this.strips.at(lat[k] ?? 0, lon[k] ?? 0)) {
        const list = byStrip.get(s) ?? [];
        list.push(k);
        byStrip.set(s, list);
      }
    }
    const columns = await Promise.all(
      [...byStrip.entries()].map(async ([strip, points]) => {
        const { file, projection, scaleM } = await this.hrscFile(strip);
        const box = Math.max(1, Math.floor(vertexSpacingM(level) / 2 / scaleM));
        const values = await sampleRaster(
          this.store,
          file,
          projection,
          Float64Array.from(points, (k) => lat[k] ?? 0),
          Float64Array.from(points, (k) => lon[k] ?? 0),
          box,
        );
        const column = new Float64Array(n).fill(Number.NaN);
        points.forEach((k, i) => (column[k] = (values[i] ?? Number.NaN) + strip.offsetM));
        return column;
      }),
    );
    const hrsc = medianOf(columns, n);
    return mola.map((m, k) => {
      const h = hrsc[k] ?? Number.NaN;
      const w = weight[k] ?? 0;
      return Number.isNaN(h) || w <= 0 ? m : w * h + (1 - w) * m;
    });
  }

  private hrscFile(strip: Strip) {
    let promise = this.hrscFiles.get(strip.name);
    if (promise === undefined) {
      promise = (async () => {
        const label = await remoteLabel(
          strip.url,
          join(this.cacheDir, 'labels', `${strip.name}.lbl`),
        );
        const file = imageFile(`mars-${strip.name}`, strip.url, label, {
          whole: true,
          sha256: strip.sha256,
        });
        return {
          file,
          projection: projectionOf(label),
          scaleM: labelNumber(label, 'MAP_SCALE', 'm'),
        };
      })();
      this.hrscFiles.set(strip.name, promise);
    }
    return promise;
  }

  /** The website's HRSC weight at each point, 0-1, bilinear on its 64 px/deg grid. */
  private async weightAt(lat: Float64Array, lon: Float64Array): Promise<Float64Array> {
    this.weight ??= this.loadWeight();
    const grid = await this.weight;
    const cols = 360 * 64;
    const rows = 180 * 64;
    return lat.map((la, k) => {
      const row = Math.min(Math.max((90 - la) * 64 - 0.5, 0), rows - 1.000001);
      const col = (((((lon[k] ?? 0) + 180) % 360) + 360) % 360) * 64 - 0.5;
      const r0 = Math.floor(row);
      const c0 = Math.floor(col);
      const fr = row - r0;
      const fc = col - c0;
      const at = (r: number, c: number) =>
        (grid[r * cols + (((c % cols) + cols) % cols)] ?? 0) / 255;
      return (
        at(r0, c0) * (1 - fr) * (1 - fc) +
        at(r0, c0 + 1) * (1 - fr) * fc +
        at(r0 + 1, c0) * fr * (1 - fc) +
        at(r0 + 1, c0 + 1) * fr * fc
      );
    });
  }

  private async loadWeight(): Promise<Uint8Array> {
    const path = join(this.cacheDir, 'files', 'hrsc-weight.u8.gz');
    if (!existsSync(path)) {
      this.log(`downloading ${DATA_SITE}hrsc-weight.u8.gz`);
      const response = await fetch(`${DATA_SITE}hrsc-weight.u8.gz`);
      if (!response.ok) throw new Error(`hrsc-weight.u8.gz: HTTP ${response.status}`);
      mkdirSync(dirname(path), { recursive: true });
      await writeFile(path, new Uint8Array(await response.arrayBuffer()));
    }
    const bytes = await readFile(path);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== this.weightSha) {
      throw new Error(`hrsc-weight.u8.gz is ${sha}, the manifest pins ${this.weightSha}`);
    }
    return new Uint8Array(gunzipSync(bytes));
  }

  // ---- HiRISE ----

  private async hiriseIndexText(): Promise<string> {
    const path = join(this.cacheDir, 'files', 'hirise-dtmcumindex.tab');
    if (!existsSync(path)) {
      this.log(`downloading ${HIRISE}INDEX/DTMCUMINDEX.TAB`);
      const response = await fetch(`${HIRISE}INDEX/DTMCUMINDEX.TAB`);
      if (!response.ok) throw new Error(`DTMCUMINDEX.TAB: HTTP ${response.status}`);
      mkdirSync(dirname(path), { recursive: true });
      await writeFile(path, await response.text());
    }
    return readFile(path, 'utf8');
  }

  private async hiriseAt(lat: Float64Array, lon: Float64Array): Promise<Float64Array> {
    this.hirise ??= this.hiriseIndexText().then((t) => new BoxIndex(hiriseModels(t)));
    const index = await this.hirise;
    const n = lat.length;
    const byModel = new Map<Model, number[]>();
    for (let k = 0; k < n; k++) {
      for (const m of index.at(lat[k] ?? 0, lon[k] ?? 0)) {
        const list = byModel.get(m) ?? [];
        list.push(k);
        byModel.set(m, list);
      }
    }
    const columns: Float64Array[] = [];
    for (const [model, points] of byModel) {
      if (!(await this.verdict(model)).ok) continue;
      const { file, projection } = await this.hiriseFile(model);
      const values = await sampleRaster(
        this.store,
        file,
        projection,
        Float64Array.from(points, (k) => lat[k] ?? 0),
        Float64Array.from(points, (k) => lon[k] ?? 0),
      );
      const column = new Float64Array(n).fill(Number.NaN);
      points.forEach((k, i) => (column[k] = values[i] ?? Number.NaN));
      columns.push(column);
    }
    return medianOf(columns, n);
  }

  private hiriseFile(model: Model) {
    let promise = this.hiriseFiles.get(model.id);
    if (promise === undefined) {
      promise = (async () => {
        const label = await remoteLabel(
          model.url,
          join(this.cacheDir, 'labels', `${model.id}.lbl`),
        );
        return {
          file: imageFile(`mars-${model.id}`, model.url, label, {}),
          projection: projectionOf(label),
        };
      })();
      this.hiriseFiles.set(model.id, promise);
    }
    return promise;
  }

  /**
   * Before a HiRISE model is used it must sit on MOLA (owner, 2026-10-03, "Moon's rule"): its
   * mean difference from MOLA's 128 px/deg topography, over the bins inside its bounding box
   * that hold laser shots, within 5 m, with the model measured in at least half of those bins.
   * Verdicts are kept on disk with their numbers.
   */
  private verdict(model: Model): Promise<Verdict> {
    const known = this.verdicts[model.id];
    if (known !== undefined) return Promise.resolve(known);
    let promise = this.checking.get(model.id);
    if (promise === undefined) {
      promise = this.check(model);
      this.checking.set(model.id, promise);
    }
    return promise;
  }

  private async check(model: Model): Promise<Verdict> {
    const { south, north, west, east } = model.box;
    const lat: number[] = [];
    const lon: number[] = [];
    for (let r = Math.ceil((90 - north) * 128 - 0.5); 90 - (r + 0.5) / 128 >= south; r++) {
      for (let c = Math.ceil(west * 128 - 0.5); (c + 0.5) / 128 <= east; c++) {
        lat.push(90 - (r + 0.5) / 128);
        lon.push((c + 0.5) / 128);
      }
    }
    const la = Float64Array.from(lat);
    const lo = Float64Array.from(lon);
    const [shots, mola, values] = await Promise.all([
      sampleProduct(this.megc, this.store, la, lo),
      sampleProduct(this.megt, this.store, la, lo),
      this.hiriseFile(model).then(({ file, projection }) =>
        sampleRaster(this.store, file, projection, la, lo),
      ),
    ]);
    let sum = 0;
    let points = 0;
    let shotBins = 0;
    shots.forEach((s, k) => {
      // At a bin centre, bilinear reads that bin's own count.
      if (!((s ?? 0) > 0.5)) return;
      shotBins++;
      const h = values[k] ?? Number.NaN;
      const m = mola[k] ?? Number.NaN;
      if (Number.isNaN(h) || Number.isNaN(m)) return;
      sum += h - m;
      points++;
    });
    const meanM = points === 0 ? Number.NaN : sum / points;
    const verdict = {
      ok: points > 0 && points * 2 >= shotBins && Math.abs(meanM) <= HIRISE_MAX_OFFSET_M,
      meanM,
      points,
      shotBins,
    };
    this.log(
      `HiRISE ${model.id} against MOLA: mean ${meanM.toFixed(2)} m over ${points} of ${shotBins} laser-shot bins: ${verdict.ok ? 'used' : 'NOT used'}`,
    );
    this.verdicts[model.id] = verdict;
    mkdirSync(dirname(this.verdictPath), { recursive: true });
    writeFileSync(this.verdictPath, `${JSON.stringify(this.verdicts, null, 2)}\n`);
    return verdict;
  }
}
