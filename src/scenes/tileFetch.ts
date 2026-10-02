// Fetching the Moon's terrain tiles (docs/stories/SS-10e.md), kept apart from moon.ts so it can be
// tested without a page. Tiles are built gzip-compressed by tools/terrain/build.ts.
import type { TilesRenderer } from '3d-tiles-renderer';

/** Download attempts per tile, and the wait before each retry, ms (doubling). */
const TILE_ATTEMPTS = 4;
const TILE_RETRY_MS = 500;
/** After a tile still fails, the renderer is asked to try it again this much later, ms. */
export const FAILED_TILE_RETRY_MS = 5000;
/** At most this many such later retries per page, so a tile that can never load cannot loop. */
export const FAILED_TILE_RETRIES = 20;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches a tile, retrying a dropped connection or a server error, and inflates tiles stored
 * gzip-compressed (tools/terrain/build.ts), recognised by the gzip header 1f 8b. Anything else,
 * such as layer.json or the local server's uncompressed tiles, passes through unchanged. GitHub
 * Pages also gzips them in transit, which fetch undoes by itself.
 *
 * The retries matter: 3d-tiles-renderer counts a failed tile as finished, hides its parent and
 * draws nothing in its place, which on the owner's iPhone and iPad left a black square on the
 * Moon until reload (docs/stories/SS-10e.md). The tile is inflated inside the retry, so a
 * transfer cut short is retried too. A request the renderer aborts is never retried.
 */
export class GunzipPlugin {
  async fetchData(url: string, options: RequestInit): Promise<Response> {
    const aborted = (): boolean => options.signal?.aborted === true;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < TILE_ATTEMPTS; attempt++) {
      if (attempt > 0) await wait(TILE_RETRY_MS * 2 ** (attempt - 1));
      if (aborted()) break;
      try {
        const response = await fetch(url, options);
        if (response.status >= 500 || response.status === 429) {
          lastError = new Error(`${url}: HTTP ${response.status}`);
          continue;
        }
        if (!response.ok) return response;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const body =
          bytes[0] === 0x1f && bytes[1] === 0x8b
            ? await new Response(
                new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
              ).arrayBuffer()
            : bytes;
        return new Response(body, { status: response.status });
      } catch (error) {
        if (aborted()) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${url} failed to load`);
  }
}

/** 3d-tiles-renderer's loading state for a tile that failed (core/renderer/constants.js). */
const TILE_FAILED = -1;

/**
 * Lets failed tiles load again on the next update. A failed tile stays in the renderer's cache,
 * which then refuses to add it for a new download, and the library's own resetFailedTiles()
 * neither removes it nor survives tiles it has not set up yet (it throws "Cannot read properties
 * of undefined (reading 'loadingState')", 3d-tiles-renderer 0.5.3). Removing it from the cache
 * runs the cache's own unload, which marks it unloaded.
 */
export function retryFailedTiles(tiles: TilesRenderer): void {
  // The typings omit traverse's third argument (skip setting up unprocessed tiles), the cache
  // and the stats.
  const base = tiles as unknown as {
    traverse(before: (tile: object) => boolean, after: null, ensureFullyProcessed: boolean): void;
    lruCache: { remove(tile: object): boolean };
    stats: { failed: number };
  };
  const failed: object[] = [];
  base.traverse(
    (tile) => {
      const internal = (tile as { internal?: { loadingState: number } }).internal;
      if (internal?.loadingState === TILE_FAILED) failed.push(tile);
      return false;
    },
    null,
    false,
  );
  for (const tile of failed) base.lruCache.remove(tile);
  base.stats.failed = Math.max(0, base.stats.failed - failed.length);
}
