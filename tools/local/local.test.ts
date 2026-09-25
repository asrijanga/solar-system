import { describe, expect, it } from 'vitest';
import {
  KAGUYA_TC,
  LDEM_64,
  LDEM_512,
  SLDEM2015,
  gridPosition,
  kaguyaName,
  type Product,
} from './grids.ts';
import { availability, productsFor } from './ladder.ts';
import { rangeHeader, splitRanges } from './multipart.ts';
import { encodeTile, octEncode, tileBounds } from './quantizedMesh.ts';

function fileAt(
  product: Product,
  lat: number,
  lon: number,
): { id: string; url: string; r: number; c: number } {
  const p = gridPosition(product, lat, lon);
  if (p === null) throw new Error('outside coverage');
  const at = product.locate(Math.floor(p.row), Math.floor(p.col));
  if (at === null) throw new Error('no file');
  return { id: at.file.id, url: at.file.url, r: at.r, c: at.c };
}

describe('publishers’ file layout', () => {
  it('names files exactly as PDS and JAXA publish them', () => {
    // Albategnius, 4.0 E 11.2 S: the files pinned in pipeline/terrain_tiles.py and listed by PDS.
    expect(fileAt(LDEM_512, -11.24, 4.0).id).toBe('ldem_512_45s_00s_000_090_float');
    expect(fileAt(LDEM_512, 70, 100).id).toBe('ldem_512_45n_90n_090_180_float');
    expect(fileAt(LDEM_512, 10, 300).id).toBe('ldem_512_00n_45n_270_360_float');
    expect(fileAt(SLDEM2015, -11.24, 4.0).id).toBe('sldem2015_512_30s_00s_000_045_float');
    expect(fileAt(SLDEM2015, 45, -10).id).toBe('sldem2015_512_30n_60n_315_360_float');
    const kaguya = fileAt(KAGUYA_TC, -11.24, 4.0);
    expect(kaguya.id).toBe('DTM_MAPs02_S09E003S12E006SC');
    expect(kaguya.url).toContain('/lon003/data/DTM_MAPs02_S09E003S12E006SC.img');
    expect(kaguyaName(3, 357)).toBe('DTM_MAPs02_N03E357N00E360SC');
    expect(kaguyaName(0, 3)).toBe('DTM_MAPs02_N00E003S03E006SC');
  });

  it('places samples where the labels say', () => {
    // LOLA grids are pixel-registered from 90 N and 0 E (LINE_PROJECTION_OFFSET = rows/2 - 0.5).
    expect(gridPosition(LDEM_64, 90 - 0.5 / 64, 0.5 / 64)).toEqual({ row: 0, col: 0 });
    // The Albategnius byte range began at LDEM_512 row 2560 of its file: latitude 5 S.
    const edge = fileAt(LDEM_512, -5 - 0.5 / 512, 0.5 / 512);
    expect([edge.r, edge.c]).toEqual([2560, 0]);
    // Kaguya samples sit on whole multiples of 1/3600 degree; a file's first is its top-left corner.
    const corner = fileAt(KAGUYA_TC, -9, 3);
    expect([corner.id, corner.r, corner.c]).toEqual(['DTM_MAPs02_S09E003S12E006SC', 0, 0]);
    // Longitude wraps: 180 W is 180 E.
    expect(gridPosition(LDEM_64, 0, -180)?.col).toBeCloseTo(
      gridPosition(LDEM_64, 0, 180)?.col ?? 0,
    );
    // SLDEM2015 stops at 60 degrees.
    expect(gridPosition(SLDEM2015, 61, 0)).toBeNull();
  });
});

describe('the level ladder', () => {
  it('uses finer measurements deeper down, and Kaguya only at 12 and 13', () => {
    expect(productsFor(3).map((p) => p.ppd)).toEqual([16]);
    expect(productsFor(6).map((p) => p.ppd)).toEqual([64]);
    expect(productsFor(8).map((p) => p.ppd)).toEqual([128]);
    expect(productsFor(11).map((p) => p.id)).toEqual(['sldem2015_512', 'ldem_512']);
    expect(productsFor(13).map((p) => p.id)).toEqual([
      'kaguya_tc_dtm_map_02',
      'sldem2015_512',
      'ldem_512',
    ]);
  });

  it('declares 12 and 13 only within Kaguya’s 84 degrees', () => {
    const levels = availability();
    expect(levels).toHaveLength(14);
    expect(levels[11]).toEqual([{ startX: 0, startY: 0, endX: 4095, endY: 2047 }]);
    const [range] = levels[12] ?? [];
    const size = 180 / 4096;
    // Tiles may straddle 84 degrees; their vertices beyond it take LOLA's measurement.
    const south = -90 + (range?.startY ?? 0) * size;
    const north = -90 + ((range?.endY ?? 0) + 1) * size;
    expect(south).toBeGreaterThan(-84 - size);
    expect(south).toBeLessThanOrEqual(-84);
    expect(north).toBeLessThan(84 + size);
    expect(north).toBeGreaterThanOrEqual(84);
  });
});

describe('multi-range replies', () => {
  const ranges = [
    { start: 0, end: 4 },
    { start: 100, end: 102 },
  ];

  it('asks for inclusive byte ranges', () => {
    expect(rangeHeader(ranges)).toBe('bytes=0-3,100-101');
  });

  it('reads multipart/byteranges parts in request order', () => {
    const body = new TextEncoder().encode(
      '\r\n--XYZ\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes 100-101/200\r\n\r\nhi' +
        '\r\n--XYZ\r\nContent-Range: bytes 0-3/200\r\n\r\nabcd\r\n--XYZ--\r\n',
    );
    const parts = splitRanges(body, 'multipart/byteranges; boundary=XYZ', null, ranges);
    expect(parts.map((p) => new TextDecoder().decode(p))).toEqual(['abcd', 'hi']);
  });

  it('reads a single-range reply', () => {
    const [part] = splitRanges(
      new TextEncoder().encode('abcd'),
      'application/octet-stream',
      'bytes 0-3/200',
      [ranges[0] ?? { start: 0, end: 0 }],
    );
    expect(new TextDecoder().decode(part)).toBe('abcd');
  });
});

/** Minimal quantized-mesh reader: header, vertices, triangles, edges and the normals extension. */
function decode(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const hMin = view.getFloat32(24, true);
  const hMax = view.getFloat32(28, true);
  at = 88;
  const n = view.getUint32(at, true);
  at += 4;
  const read = (): Int32Array => {
    const out = new Int32Array(n);
    let value = 0;
    for (let i = 0; i < n; i++) {
      const zz = view.getUint16(at, true);
      at += 2;
      value += (zz >> 1) ^ -(zz & 1);
      out[i] = value;
    }
    return out;
  };
  const u = read();
  const v = read();
  const h = read();
  const triangles = view.getUint32(at, true);
  at += 4;
  const indices: number[] = [];
  let highest = 0;
  for (let i = 0; i < triangles * 3; i++) {
    const code = view.getUint16(at, true);
    at += 2;
    indices.push(highest - code);
    if (code === 0) highest++;
  }
  const edges: number[] = [];
  for (let e = 0; e < 4; e++) {
    const count = view.getUint32(at, true);
    edges.push(count);
    at += 4 + count * 2;
  }
  const extension = view.getUint8(at);
  const length = view.getUint32(at + 1, true);
  return { n, u, v, h, hMin, hMax, indices, edges, extension, length, end: at + 5 + length };
}

describe('tile encoding', () => {
  it('round-trips heights, triangles, edges and normals', async () => {
    // A measured-looking surface: a 300 m bump on a slope. Flat normals would hide sign errors.
    const surface = (lat: number, lon: number): number =>
      50 * lon + 300 * Math.exp(-((lat + 11) ** 2 + (lon - 4) ** 2) * 50);
    const bytes = await encodeTile(9, 516, 219, async (lat, lon) =>
      lat.map((la, i) => surface(la, lon[i] ?? 0)),
    );
    const tile = decode(bytes);
    expect(tile.end).toBe(bytes.length);
    expect(tile.n).toBe(65 * 65);
    expect(tile.indices).toHaveLength(64 * 64 * 6);
    expect(Math.max(...tile.indices)).toBe(tile.n - 1);
    expect(tile.edges).toEqual([65, 65, 65, 65]);
    expect(tile.extension).toBe(1);
    expect(tile.length).toBe(2 * tile.n);
    const [west, south, east, north] = tileBounds(9, 516, 219);
    for (let k = 0; k < tile.n; k += 97) {
      const lon = west + ((tile.u[k] ?? 0) / 32767) * (east - west);
      const lat = south + ((tile.v[k] ?? 0) / 32767) * (north - south);
      const h = tile.hMin + ((tile.h[k] ?? 0) / 32767) * (tile.hMax - tile.hMin);
      expect(Math.abs(h - surface(lat, lon))).toBeLessThan((tile.hMax - tile.hMin) / 32767 + 0.01);
    }
  });

  it('refuses a tile with an unmeasured height instead of inventing one', async () => {
    await expect(
      encodeTile(9, 516, 219, async (lat) => lat.map((_, i) => (i === 7 ? Number.NaN : 0))),
    ).rejects.toThrow('missing');
  });

  it('encodes straight up and straight down to opposite octahedral corners', () => {
    expect(octEncode(0, 0, 1)).toEqual([128, 128]);
    expect(octEncode(0, 0, -1)).toEqual([255, 255]);
  });
});
