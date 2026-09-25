// Which measurement supplies each level of detail, finest available first. Nothing is ever
// filled in: where the finest product has no measurement at a point, the next product's
// measurement is used there (per vertex, so neighbouring tiles always agree on shared edges).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  KAGUYA_TC,
  LDEM_16,
  LDEM_64,
  LDEM_128,
  LDEM_512,
  SLDEM2015,
  gridPosition,
  sampleProduct,
  type BlockStore,
  type Product,
} from './grids.ts';
import type { HeightSource } from '../terrain/quantizedMesh.ts';
import type { TileRange } from '../../src/core/terrain.ts';

/** The deepest level: 10 m vertex spacing, Kaguya's 8.4 m sampling. */
export const MAX_LEVEL = 13;
/** Levels from Kaguya: 21 m and 10 m vertex spacing. */
export const KAGUYA_FROM = 12;
/** Kaguya's coverage, degrees of latitude either side of the equator. */
export const KAGUYA_LAT = 84;

/**
 * The product for a level, coarse to fine, each chosen so a vertex spacing spans at least a
 * few of its samples: LDEM_16 (1.9 km) to level 4 (5.3 km vertices), LDEM_64 (474 m) to 6
 * (1.3 km), LDEM_128 (237 m) to 8 (330 m), SLDEM2015 or LDEM_512 (59 m) to 11 (41 m), Kaguya
 * (8.4 m) at 12 and 13.
 */
export function productsFor(level: number): readonly Product[] {
  if (level <= 4) return [LDEM_16];
  if (level <= 6) return [LDEM_64];
  if (level <= 8) return [LDEM_128];
  // SLDEM2015 (LOLA with Kaguya, co-registered by Barker et al. 2016) within 60 degrees of the
  // equator, LOLA LDEM_512 beyond it.
  if (level < KAGUYA_FROM) return [SLDEM2015, LDEM_512];
  return [KAGUYA_TC, SLDEM2015, LDEM_512];
}

/** Levels available where: all of 0-11 everywhere, 12-13 within Kaguya's latitudes. */
export function availability(): TileRange[][] {
  const out: TileRange[][] = [];
  for (let z = 0; z <= MAX_LEVEL; z++) {
    const size = 180 / 2 ** z;
    const rows = 2 ** z;
    if (z < KAGUYA_FROM) {
      out.push([{ startX: 0, startY: 0, endX: 2 * rows - 1, endY: rows - 1 }]);
    } else {
      out.push([
        {
          startX: 0,
          startY: Math.floor((90 - KAGUYA_LAT) / size),
          endX: 2 * rows - 1,
          endY: Math.ceil((90 + KAGUYA_LAT) / size) - 1,
        },
      ]);
    }
  }
  return out;
}

/**
 * Before any Kaguya file is used it must sit on LOLA: its mean height difference from the
 * product below it (SLDEM2015, or LDEM_512 past 60 degrees), over a 32 x 32 grid of points
 * inside the file, within MAX_OFFSET_M. The Albategnius file measured 0.6 m (SS-10). Files
 * that fail are not used, and the verdicts are kept on disk with their numbers.
 */
const MAX_OFFSET_M = 5;

interface Verdict {
  readonly ok: boolean;
  readonly meanM: number;
  readonly points: number;
}

export class Ladder {
  private readonly store: BlockStore;
  private readonly verdictPath: string;
  private readonly verdicts: Record<string, Verdict>;
  private readonly checking = new Map<string, Promise<Verdict>>();
  private readonly log: (message: string) => void;

  constructor(
    store: BlockStore,
    cacheDir: string,
    log: (message: string) => void = () => undefined,
  ) {
    this.store = store;
    this.log = log;
    this.verdictPath = join(cacheDir, 'kaguya-registration.json');
    this.verdicts = existsSync(this.verdictPath)
      ? (JSON.parse(readFileSync(this.verdictPath, 'utf8')) as Record<string, Verdict>)
      : {};
  }

  heightsFor(level: number): HeightSource {
    const products = productsFor(level);
    return async (lat, lon) => {
      const out = new Float64Array(lat.length).fill(Number.NaN);
      for (const product of products) {
        const missing: number[] = [];
        out.forEach((v, i) => {
          if (Number.isNaN(v)) missing.push(i);
        });
        if (missing.length === 0) break;
        const la = Float64Array.from(missing, (i) => lat[i] ?? 0);
        const lo = Float64Array.from(missing, (i) => lon[i] ?? 0);
        const values = await sampleProduct(product, this.store, la, lo);
        const usable = product === KAGUYA_TC ? await this.kaguyaUsable(la, lo) : null;
        missing.forEach((i, k) => {
          if (usable === null || usable[k] === 1) out[i] = values[k] ?? Number.NaN;
        });
      }
      return out;
    };
  }

  /** 1 where the Kaguya file holding each point passed registration, else 0. */
  private async kaguyaUsable(lat: Float64Array, lon: Float64Array): Promise<Uint8Array> {
    const out = new Uint8Array(lat.length);
    const files = new Map<string, number[]>();
    lat.forEach((la, k) => {
      const p = gridPosition(KAGUYA_TC, la, lon[k] ?? 0);
      if (p === null) return;
      const at = KAGUYA_TC.locate(Math.round(p.row), Math.round(p.col) % KAGUYA_TC.cols);
      if (at === null) return;
      const list = files.get(at.file.id) ?? [];
      list.push(k);
      files.set(at.file.id, list);
    });
    for (const [id, points] of files) {
      const verdict = await this.verdict(id);
      if (verdict.ok) for (const k of points) out[k] = 1;
    }
    return out;
  }

  private verdict(id: string): Promise<Verdict> {
    const known = this.verdicts[id];
    if (known !== undefined) return Promise.resolve(known);
    let promise = this.checking.get(id);
    if (promise === undefined) {
      promise = this.check(id);
      this.checking.set(id, promise);
    }
    return promise;
  }

  private async check(id: string): Promise<Verdict> {
    // DTM_MAPs02_S09E003S12E006SC: the file's top latitude and west longitude.
    const match = /_([NS])(\d\d)E(\d\d\d)/.exec(id);
    if (match === null) throw new Error(`not a Kaguya file name: ${id}`);
    const top = (match[1] === 'S' ? -1 : 1) * Number(match[2]);
    const west = Number(match[3]);
    const side = 32;
    const lat = new Float64Array(side * side);
    const lon = new Float64Array(side * side);
    for (let i = 0; i < side; i++) {
      for (let j = 0; j < side; j++) {
        lat[i * side + j] = top - (3 * (i + 0.5)) / side;
        lon[i * side + j] = west + (3 * (j + 0.5)) / side;
      }
    }
    const kaguya = await sampleProduct(KAGUYA_TC, this.store, lat, lon);
    const reference = Math.abs(top - 1.5) <= 60 ? SLDEM2015 : LDEM_512;
    const lola = await sampleProduct(reference, this.store, lat, lon);
    let sum = 0;
    let points = 0;
    kaguya.forEach((k, i) => {
      const l = lola[i] ?? Number.NaN;
      if (!Number.isNaN(k) && !Number.isNaN(l)) {
        sum += k - l;
        points++;
      }
    });
    const meanM = points === 0 ? Number.NaN : sum / points;
    const verdict = {
      ok: points > side * side * 0.5 && Math.abs(meanM) <= MAX_OFFSET_M,
      meanM,
      points,
    };
    this.log(
      `Kaguya ${id} against ${reference.id}: mean ${meanM.toFixed(2)} m over ${points} points: ${verdict.ok ? 'used' : 'NOT used'}`,
    );
    this.verdicts[id] = verdict;
    mkdirSync(join(this.verdictPath, '..'), { recursive: true });
    writeFileSync(this.verdictPath, `${JSON.stringify(this.verdicts, null, 2)}\n`);
    return verdict;
  }
}
