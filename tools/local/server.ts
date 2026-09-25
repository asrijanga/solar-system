// npm run local
//
// The Moon at full measured detail, on this computer. Serves the built app and makes each
// terrain tile the first time a view needs it, from the publishers' own files (NASA PDS, JAXA
// DARTS), fetching only the parts of them that tile covers. Everything fetched or built is
// cached in .cache/local/, so a place is only downloaded once. docs/stories/SS-10c.md.

import { createServer, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { BlockStore } from './grids.ts';
import { Ladder, availability, MAX_LEVEL } from './ladder.ts';
import { APPROX_MAX_LEVEL, Approximation, approxAvailability } from './approximate.ts';
import { encodeTile } from '../terrain/quantizedMesh.ts';

const root = join(import.meta.dirname, '..', '..');
const dist = join(root, 'dist');
const cacheDir = process.env['MOON_CACHE'] ?? join(root, '.cache', 'local');
const port = Number(process.env['PORT'] ?? 5178);
/** Where to listen: this machine only by default; `0.0.0.0` in the container (Dockerfile). */
const host = process.env['HOST'] ?? '127.0.0.1';

const log = (message: string): void => console.log(`[moon] ${message}`);
const store = new BlockStore(cacheDir, 4, log);
const ladder = new Ladder(store, cacheDir, log);
const approximation = new Approximation(ladder, store);

const layerJson = (name: string, available: unknown, attribution: string): string =>
  JSON.stringify({
    tilejson: '2.1.0',
    name,
    format: 'quantized-mesh-1.0',
    version: '1.0.0',
    scheme: 'tms',
    projection: 'EPSG:4326',
    bounds: [-180, -90, 180, 90],
    tiles: ['{z}/{x}/{y}.terrain'],
    available,
    extensions: ['octvertexnormals'],
    attribution,
  });
const SOURCES =
  'LOLA LDEM_16/64/128/512 and SLDEM2015 (NASA PDS); SELENE TC DTM_MAP_02 (JAXA DARTS)';
const layers = {
  terrain: { json: layerJson('moon-local', availability(), SOURCES), maxLevel: MAX_LEVEL },
  // The labelled approximation (docs/stories/SS-10b.md): the same measured levels, then 14-16.
  'terrain-approx': {
    json: layerJson(
      'moon-local-approx',
      approxAvailability(),
      `${SOURCES}; below 10 m, an APPROXIMATION: roughness from LROC NAC DTM statistics and craters from NASA DSNE (SLS-SPEC-159)`,
    ),
    maxLevel: APPROX_MAX_LEVEL,
  },
} as const;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.bin': 'application/octet-stream',
};

const building = new Map<string, Promise<Uint8Array>>();

/**
 * A tile of either layer. Measured levels are the same in both; approximated ones (14-16) are
 * cached apart, under tiles-approx/, so the measured cache never holds generated heights.
 */
async function tile(approx: boolean, z: number, x: number, y: number): Promise<Uint8Array> {
  const generated = approx && z > MAX_LEVEL;
  const dir = generated ? 'tiles-approx' : 'tiles';
  const path = join(cacheDir, dir, String(z), String(x), `${y}.terrain`);
  if (existsSync(path)) return readFile(path);
  const key = `${dir}/${z}/${x}/${y}`;
  let promise = building.get(key);
  if (promise === undefined) {
    promise = (async () => {
      const started = performance.now();
      const heights = generated ? approximation.heightsFor(z) : ladder.heightsFor(z);
      const bytes = await encodeTile(z, x, y, heights);
      mkdirSync(dirname(path), { recursive: true });
      await writeFile(`${path}.partial`, bytes);
      await rename(`${path}.partial`, path);
      log(`tile ${key} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
      return bytes;
    })().finally(() => building.delete(key));
    building.set(key, promise);
  }
  return promise;
}

function send(res: ServerResponse, status: number, type: string, body: Uint8Array | string): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error('No build found: run `npm run local`, which builds first.');
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  const layerMatch = /^\/(terrain|terrain-approx)\/layer\.json$/.exec(path);
  if (layerMatch !== null) {
    return send(res, 200, 'application/json', layers[layerMatch[1] as keyof typeof layers].json);
  }
  const match = /^\/(terrain|terrain-approx)\/(\d+)\/(\d+)\/(\d+)\.terrain$/.exec(path);
  if (match !== null) {
    const name = match[1] as keyof typeof layers;
    const [z, x, y] = [Number(match[2]), Number(match[3]), Number(match[4])];
    if (z > layers[name].maxLevel || x >= 2 ** (z + 1) || y >= 2 ** z) {
      return send(res, 404, 'text/plain', '');
    }
    tile(name === 'terrain-approx', z, x, y).then(
      (bytes) => send(res, 200, 'application/octet-stream', bytes),
      (error: unknown) => {
        log(`tile ${z}/${x}/${y} failed: ${String(error)}`);
        send(res, 502, 'text/plain', String(error));
      },
    );
    return;
  }
  const file = normalize(join(dist, path === '/' ? 'index.html' : path));
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    return send(res, 404, 'text/plain', 'not found');
  }
  send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file));
}).listen(port, host, () => {
  log(
    `the Moon at full measured detail: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`,
  );
  log(`cache: ${cacheDir}`);
});
