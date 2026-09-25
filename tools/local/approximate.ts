// The labelled approximation below the finest measurement (docs/stories/SS-10b.md): levels 14 to
// 16 (5.2, 2.6 and 1.3 m vertex spacing) wherever Kaguya measured, served as a separate layer
// that the app loads only when the viewer asks for it and labels on screen while it is shown.
//
// Heights there are Kaguya's measurement, interpolated, plus two kinds of detail that are both
// exactly zero at every Kaguya sample (src/core/approximation.ts):
// - roughness, scaled by how rough Kaguya measures this place over 67 m, with the fall-off to
//   small scales measured from NASA's 2 m stereo models (public/data/moon/roughness.json);
// - small craters, 2 to 16.8 m, at the density and in the shapes NASA's DSNE gives.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bandLimitedCraters, detailM, MEASURED_PPD } from '../../src/core/approximation.ts';
import type { TileRange } from '../../src/core/terrain.ts';
import { KAGUYA_TC, sampleProduct, type BlockStore } from './grids.ts';
import { availability, KAGUYA_LAT, MAX_LEVEL, type Ladder } from './ladder.ts';
import type { HeightSource } from '../terrain/quantizedMesh.ts';

export const APPROX_MAX_LEVEL = 16;

const roughness = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', 'public', 'data', 'moon', 'roughness.json'),
    'utf8',
  ),
) as { anchor: { samples: number }; octaves: { amplitudePerAnchorMetre: number[] } };

/** Measured levels, then 14-16 over Kaguya's latitudes. */
export function approxAvailability(): TileRange[][] {
  const out = availability();
  for (let z = MAX_LEVEL + 1; z <= APPROX_MAX_LEVEL; z++) {
    const size = 180 / 2 ** z;
    out.push([
      {
        startX: 0,
        startY: Math.floor((90 - KAGUYA_LAT) / size),
        endX: 2 ** (z + 1) - 1,
        endY: Math.ceil((90 + KAGUYA_LAT) / size) - 1,
      },
    ]);
  }
  return out;
}

/** Kaguya's RMS height difference over 67 m, per cell of 256 x 256 samples (2.1 km). */
const CELL = 256;

export class Approximation {
  private readonly ladder: Ladder;
  private readonly store: BlockStore;
  private readonly cells = new Map<string, Promise<number>>();

  constructor(ladder: Ladder, store: BlockStore) {
    this.ladder = ladder;
    this.store = store;
  }

  /** RMS over 8-sample pairs along rows and columns at 32 x 32 places in the cell. */
  private cellRoughness(ci: number, cj: number): Promise<number> {
    const key = `${ci}_${cj}`;
    let promise = this.cells.get(key);
    if (promise === undefined) {
      promise = (async () => {
        const lag = roughness.anchor.samples;
        const n = 32;
        const lat = new Float64Array(3 * n * n);
        const lon = new Float64Array(3 * n * n);
        for (let a = 0; a < n; a++) {
          for (let b = 0; b < n; b++) {
            const row = cj * CELL + (a + 0.5) * (CELL / n);
            const col = ci * CELL + (b + 0.5) * (CELL / n);
            const k = 3 * (a * n + b);
            const la = KAGUYA_TC.north - row / MEASURED_PPD;
            const lo = col / MEASURED_PPD;
            lat.set([la, la, la - lag / MEASURED_PPD], k);
            lon.set([lo, lo + lag / MEASURED_PPD, lo], k);
          }
        }
        const h = await sampleProduct(KAGUYA_TC, this.store, lat, lon);
        let sum = 0;
        let count = 0;
        for (let k = 0; k < h.length; k += 3) {
          for (const d of [(h[k] ?? 0) - (h[k + 1] ?? 0), (h[k] ?? 0) - (h[k + 2] ?? 0)]) {
            if (Number.isFinite(d)) {
              sum += d * d;
              count++;
            }
          }
        }
        return count === 0 ? 0 : Math.sqrt(sum / count);
      })();
      this.cells.set(key, promise);
    }
    return promise;
  }

  /** Cell coordinates and weights for bilinear interpolation between cell centres. */
  private corners(lat: number, lon: number): { cells: [number, number][]; weights: number[] } {
    const row = ((KAGUYA_TC.north - lat) * MEASURED_PPD) / CELL - 0.5;
    const col = ((((lon % 360) + 360) % 360) * MEASURED_PPD) / CELL - 0.5;
    const r0 = Math.floor(row);
    const c0 = Math.floor(col);
    const fr = row - r0;
    const fc = col - c0;
    const wrap = (360 * MEASURED_PPD) / CELL;
    const c = (v: number): number => ((v % wrap) + wrap) % wrap;
    return {
      cells: [
        [c(c0), Math.max(r0, 0)],
        [c(c0 + 1), Math.max(r0, 0)],
        [c(c0), Math.max(r0 + 1, 0)],
        [c(c0 + 1), Math.max(r0 + 1, 0)],
      ],
      weights: [(1 - fc) * (1 - fr), fc * (1 - fr), (1 - fc) * fr, fc * fr],
    };
  }

  /** Local 67 m roughness at many places: each cell resolved once, then interpolated. */
  private async anchorsM(
    lat: Float64Array,
    lon: Float64Array,
    use: Uint8Array,
  ): Promise<Float64Array> {
    const plans = Array.from(lat, (la, i) => (use[i] === 1 ? this.corners(la, lon[i] ?? 0) : null));
    const keys = new Map<string, [number, number]>();
    for (const plan of plans)
      for (const cell of plan?.cells ?? []) keys.set(`${cell[0]}_${cell[1]}`, cell);
    const values = new Map<string, number>();
    await Promise.all(
      [...keys].map(async ([key, [ci, cj]]) => values.set(key, await this.cellRoughness(ci, cj))),
    );
    return Float64Array.from(plans, (plan) =>
      plan === null
        ? 0
        : plan.cells.reduce(
            (sum, [ci, cj], k) => sum + (values.get(`${ci}_${cj}`) ?? 0) * (plan.weights[k] ?? 0),
            0,
          ),
    );
  }

  heightsFor(level: number): HeightSource {
    const measured = this.ladder.heightsWithSource(level);
    const amplitudes = roughness.octaves.amplitudePerAnchorMetre;
    return async (lat, lon) => {
      const { heights, kaguya } = await measured(lat, lon);
      const anchors = await this.anchorsM(lat, lon, kaguya);
      return heights.map((h, i) => {
        if (kaguya[i] !== 1) return h;
        const la = lat[i] ?? 0;
        const lo = lon[i] ?? 0;
        const sigma = anchors[i] ?? 0;
        return (
          h +
          detailM(
            la,
            lo,
            amplitudes.map((a) => a * sigma),
          ) +
          bandLimitedCraters(la, lo)
        );
      });
    };
  }
}
