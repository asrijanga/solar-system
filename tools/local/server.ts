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
import { encodeTile } from '../terrain/quantizedMesh.ts';

const root = join(import.meta.dirname, '..', '..');
const dist = join(root, 'dist');
const cacheDir = process.env['MOON_CACHE'] ?? join(root, '.cache', 'local');
const port = Number(process.env['PORT'] ?? 5178);

const log = (message: string): void => console.log(`[moon] ${message}`);
const store = new BlockStore(cacheDir, 4, log);
const ladder = new Ladder(store, cacheDir, log);

const layer = JSON.stringify({
  tilejson: '2.1.0',
  name: 'moon-local',
  format: 'quantized-mesh-1.0',
  version: '1.0.0',
  scheme: 'tms',
  projection: 'EPSG:4326',
  bounds: [-180, -90, 180, 90],
  tiles: ['{z}/{x}/{y}.terrain'],
  available: availability(),
  extensions: ['octvertexnormals'],
  attribution:
    'LOLA LDEM_16/64/128/512 and SLDEM2015 (NASA PDS); SELENE TC DTM_MAP_02 (JAXA DARTS)',
});

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

async function tile(z: number, x: number, y: number): Promise<Uint8Array> {
  const path = join(cacheDir, 'tiles', String(z), String(x), `${y}.terrain`);
  if (existsSync(path)) return readFile(path);
  const key = `${z}/${x}/${y}`;
  let promise = building.get(key);
  if (promise === undefined) {
    promise = (async () => {
      const started = performance.now();
      const bytes = await encodeTile(z, x, y, ladder.heightsFor(z));
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
  if (path === '/terrain/layer.json') return send(res, 200, 'application/json', layer);
  const match = /^\/terrain\/(\d+)\/(\d+)\/(\d+)\.terrain$/.exec(path);
  if (match !== null) {
    const [z, x, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (z > MAX_LEVEL || x >= 2 ** (z + 1) || y >= 2 ** z) return send(res, 404, 'text/plain', '');
    tile(z, x, y).then(
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
}).listen(port, '127.0.0.1', () => {
  log(`the Moon at full measured detail: http://localhost:${port}/`);
  log(`cache: ${cacheDir}`);
});
