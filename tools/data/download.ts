// Checksummed, resumable, retrying downloads into pipeline/.cache: the TypeScript twin of
// pipeline/download.py, sharing its cache so a file fetched by either is reused by both.
//
// Every source is pinned by SHA-256. A download that does not match is discarded and fetched
// again; it is never used. Cached files are re-verified on every run.

import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const CACHE = join(import.meta.dirname, '..', '..', 'pipeline', '.cache');
const ATTEMPTS = 6;
const USER_AGENT = 'solar-system-pipeline/0 (+https://github.com/asrijanga/solar-system)';

export async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path, { highWaterMark: 1 << 20 }), hash);
  return hash.digest('hex');
}

export interface FetchOptions {
  /** Inclusive start, exclusive end: fetch only these bytes, by HTTP range request. */
  readonly byteRange?: readonly [number, number];
}

/** A verified local copy of `url` (or of a byte range of it), as `name` in the cache. */
export async function fetchPinned(
  url: string,
  expectedSha256: string,
  name: string,
  options: FetchOptions = {},
): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const target = join(CACHE, name);
  if (existsSync(target)) {
    if ((await sha256(target)) === expectedSha256) return target;
    unlinkSync(target);
  }
  const partial = `${target}.partial`;
  let lastError = 'no attempt made';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const have = existsSync(partial) ? statSync(partial).size : 0;
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
      if (options.byteRange !== undefined) {
        const [start, end] = options.byteRange;
        headers['Range'] = `bytes=${start + have}-${end - 1}`;
      } else if (have > 0) {
        headers['Range'] = `bytes=${have}-`;
      }
      const response = await fetch(url, { headers });
      if (options.byteRange !== undefined && response.status !== 206) {
        throw new Error(`server ignored the range request (HTTP ${response.status})`);
      }
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
      const resumed = have > 0 && response.status === 206;
      const length = response.headers.get('content-length');
      const total = length === null ? null : (resumed ? have : 0) + Number(length);
      await pipeline(
        Readable.fromWeb(response.body as never),
        createWriteStream(partial, { flags: resumed ? 'a' : 'w' }),
      );
      const size = statSync(partial).size;
      // The connection ended early without an error: keep what arrived and resume.
      if (total !== null && size < total)
        throw new Error(`transfer ended early at ${size} of ${total} bytes`);
      const actual = await sha256(partial);
      if (actual === expectedSha256) {
        renameSync(partial, target);
        return target;
      }
      lastError = `sha256 mismatch: got ${actual}`;
      unlinkSync(partial); // a complete but wrong file: start again
    } catch (error) {
      lastError = String(error);
    }
    console.log(`  download attempt ${attempt} of ${url} failed: ${lastError}`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt, 30) * 1000));
  }
  throw new Error(`could not download ${url}: ${lastError}`);
}
