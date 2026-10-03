// npm run pipeline:mars:tiles [-- <out dir>]
//
// Mars's terrain for the website: quantized-mesh tiles, levels 0-7 everywhere (vertices 1.31 km
// apart at level 7), for Mars's own data repository and its own 1 GB of GitHub Pages (owner,
// 2026-10-02, "Own data repo, 1.3 km"; docs/stories/SS-14.md, W4). Built from the composite of
// pipeline/mars_terrain.py: HRSC stereo, MOLA where it has laser shots, and MOLA's
// interpolation between tracks where nothing measured, at 64 px/deg. Every vertex height is
// bilinear between composite samples; nothing is added between them.
//
// Tile heights are metres above the 3396 km sphere (the MEGDR's): MOLA's areoid radius plus the
// composite's height above it. Stored gzip-compressed, as the Moon's are.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encodeTile, type HeightSource } from './quantizedMesh.ts';
import { Grid } from './sources.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const CACHE = join(ROOT, 'pipeline', '.cache');
const MANIFEST = join(ROOT, 'public', 'data', 'mars', 'terrain.json');
const OUT = process.argv[2] ?? join(ROOT, 'dist-mars', 'terrain');

/** The MEGDR's sphere, metres. */
export const MARS_R_M = 3_396_000;
const PPD = 64;
const WIDTH = 360 * PPD;
const HEIGHT = 180 * PPD;
const LEVELS = 7;

/**
 * GitHub Pages publishes at most 1 GB per site, counted uncompressed on disk. Mars's data site
 * holds only its terrain: the tiles may use 950 MB, leaving the rest for layer.json, the
 * provenance and its page.
 */
const BUDGET_BYTES = 950e6;

/** The composite as km above the 3396 km sphere: areoid radius + height, column 0 at -180. */
function composite(): Grid {
  const heights = readFileSync(join(CACHE, 'mars-terrain-64.img'));
  const areoid = readFileSync(join(CACHE, 'mars-terrain-64-areoid.img'));
  const n = WIDTH * HEIGHT;
  if (heights.byteLength !== n * 2 || areoid.byteLength !== n * 4) {
    throw new Error('the composite is not 23040 x 11520: run npm run pipeline:mars:terrain');
  }
  const h = new DataView(heights.buffer, heights.byteOffset, heights.byteLength);
  const a = new DataView(areoid.buffer, areoid.byteOffset, areoid.byteLength);
  const km = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    km[i] = (a.getInt32(i * 4, true) - MARS_R_M + h.getInt16(i * 2, true)) / 1000;
  }
  return new Grid(km, HEIGHT, WIDTH, 90, -180, PPD, true);
}

function sizeOf(dir: string): number {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((sum, entry) => sum + statSync(join(entry.parentPath, entry.name)).size, 0);
}

if (import.meta.main) {
  const grid = composite();
  const source: HeightSource = async (lat, lon) =>
    lat.map((la, i) => grid.heightM(la, lon[i] ?? 0));
  rmSync(OUT, { recursive: true, force: true });
  let count = 0;
  for (let z = 0; z <= LEVELS; z++) {
    for (let x = 0; x < 2 ** (z + 1); x++) {
      for (let y = 0; y < 2 ** z; y++) {
        const path = join(OUT, String(z), String(x), `${y}.terrain`);
        mkdirSync(dirname(path), { recursive: true });
        const tile = await encodeTile(z, x, y, source, 65, MARS_R_M);
        writeFileSync(path, gzipSync(tile, { level: 9 }));
        count++;
      }
    }
    console.log(`level ${z}: ${count} tiles`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    composite: { stripsUsed: number };
  };
  writeFileSync(
    join(OUT, 'layer.json'),
    JSON.stringify(
      {
        tilejson: '2.1.0',
        name: 'mars-mola-hrsc',
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
        attribution: `MOLA MEGDR (PDS MGS-M-MOLA-5-MEGDR-L3-V1.0); HRSC DTMs, ${manifest.composite.stripsUsed} strips (PDS MEX-M-HRSC-5-REFDR-DTM-V1.0; ESA/DLR/FU Berlin, CC BY-SA 3.0 IGO)`,
      },
      null,
      1,
    ),
  );
  const bytes = sizeOf(OUT);
  console.log(`${count} tiles in ${OUT}: ${(bytes / 1e6).toFixed(0)} MB`);
  if (bytes > BUDGET_BYTES) {
    throw new Error(
      `Mars terrain is ${(bytes / 1e6).toFixed(0)} MB, over its ${BUDGET_BYTES / 1e6} MB budget`,
    );
  }
}
