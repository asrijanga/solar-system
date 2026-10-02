import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GunzipPlugin } from './tileFetch';

// The terrain's tile fetch (docs/stories/SS-10e.md): a failed tile left a black square on the
// owner's iPhone and iPad, because 3d-tiles-renderer draws nothing for a tile that failed.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function run(plugin: GunzipPlugin, signal?: AbortSignal): Promise<Response> {
  // Only the retry waits: streams need their own scheduling to inflate.
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const pending = plugin.fetchData('tile.terrain', signal === undefined ? {} : { signal });
  let settled = false;
  pending.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 50 && !settled; i++) await vi.advanceTimersByTimeAsync(500);
  return pending;
}

describe('terrain tile fetch', () => {
  it('retries a dropped connection and returns the inflated tile', async () => {
    const tile = Uint8Array.from([1, 2, 3, 4]);
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValue(new Response(gzipSync(tile)));
    vi.stubGlobal('fetch', fetch);
    const response = await run(new GunzipPlugin());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(tile);
  });

  it('retries a server error', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(new Response(Uint8Array.from([9])));
    vi.stubGlobal('fetch', fetch);
    const response = await run(new GunzipPlugin());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([9]));
  });

  it('retries a transfer cut short, which fails to inflate', async () => {
    const whole = gzipSync(Uint8Array.from({ length: 4096 }, (_, i) => i % 251));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(whole.subarray(0, whole.length / 2)))
      .mockResolvedValue(new Response(whole));
    vi.stubGlobal('fetch', fetch);
    const response = await run(new GunzipPlugin());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await response.arrayBuffer()).byteLength).toBe(4096);
  });

  it('does not retry a tile that does not exist', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const response = await run(new GunzipPlugin());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
  });

  it('gives up after four attempts, so the renderer can try again later', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetch);
    await expect(run(new GunzipPlugin())).rejects.toThrow('offline');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('never retries a request the renderer aborted', async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    vi.stubGlobal('fetch', fetch);
    await expect(run(new GunzipPlugin(), controller.signal)).rejects.toThrow('aborted');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
