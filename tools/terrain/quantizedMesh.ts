// Cesium quantized-mesh 1.0 tiles with octahedral vertex normals, for the website's terrain
// build (tools/terrain/build.ts) and the local server (tools/local/server.ts). It replaced
// pipeline/quantized_mesh.py, whose tiles it reproduced exactly: every height and normal, with
// headers equal to within a nanometre. Same tiling (geographic TMS, two tiles at level 0, y = 0 at the south), same vertex grid, same
// normals: every vertex is a measured height; nothing is added between them.

export const R_M = 1_737_400;
const MAX = 32767;

/** Round half to even, as numpy's rint did in the Python encoder this replaced. */
function rint(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const size = 180 / 2 ** z;
  const west = -180 + x * size;
  const south = -90 + y * size;
  return [west, south, west + size, south + size];
}

/** Heights in metres above the 1737.4 km sphere at (lat, lon) in degrees, NaN if unmeasured. */
export type HeightSource = (lat: Float64Array, lon: Float64Array) => Promise<Float64Array>;

interface GridOrder {
  /** Vertex indices (row-major, rows south to north) in first-use order. */
  readonly order: Int32Array;
  /** High-water-mark encoded triangle indices. */
  readonly codes: Uint16Array;
}

const orders = new Map<number, GridOrder>();

/** The fixed triangulation of a grid x grid tile, counter-clockwise in (east, north). */
function gridOrder(grid: number): GridOrder {
  const cached = orders.get(grid);
  if (cached !== undefined) return cached;
  const tris: number[] = [];
  for (let r = 0; r < grid - 1; r++) {
    for (let c = 0; c < grid - 1; c++) {
      const a = r * grid + c;
      const b = a + 1;
      const d = a + grid;
      const e = d + 1;
      tris.push(a, b, e, a, e, d);
    }
  }
  const seen = new Int32Array(grid * grid).fill(-1);
  const order: number[] = [];
  for (const i of tris) {
    if ((seen[i] ?? -1) < 0) {
      seen[i] = order.length;
      order.push(i);
    }
  }
  const codes = new Uint16Array(tris.length);
  let highest = 0;
  tris.forEach((i, k) => {
    const remapped = seen[i] ?? 0;
    codes[k] = highest - remapped;
    if (remapped === highest) highest++;
  });
  const result = { order: Int32Array.from(order), codes };
  orders.set(grid, result);
  return result;
}

function ecef(lat: number, lon: number, h: number): [number, number, number] {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  const r = R_M + h;
  return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
}

/** Cesium's 8-bit octahedral encoding of a unit vector. */
export function octEncode(x: number, y: number, z: number): [number, number] {
  const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z);
  let ox = x / l1;
  let oy = y / l1;
  if (z < 0) {
    const tx = (1 - Math.abs(oy)) * (ox >= 0 ? 1 : -1);
    const ty = (1 - Math.abs(ox)) * (oy >= 0 ? 1 : -1);
    ox = tx;
    oy = ty;
  }
  return [rint((ox * 0.5 + 0.5) * 255), rint((oy * 0.5 + 0.5) * 255)];
}

function zigzag(values: Int32Array): Uint16Array {
  const out = new Uint16Array(values.length);
  let previous = 0;
  values.forEach((v, i) => {
    const d = v - previous;
    previous = v;
    out[i] = (d << 1) ^ (d >> 31);
  });
  return out;
}

/**
 * One tile. Heights are sampled once for every vertex and, for the normals, at a vertex
 * spacing east, west, north and south of it (central differences over one vertex spacing, offsets as distances on the sphere), in a
 * single call so a source can fetch everything it needs at once.
 */
export async function encodeTile(
  z: number,
  x: number,
  y: number,
  heights: HeightSource,
  grid = 65,
): Promise<Uint8Array> {
  const [west, south, east, north] = tileBounds(z, x, y);
  const n = grid * grid;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      lat[r * grid + c] = south + (r / (grid - 1)) * (north - south);
      lon[r * grid + c] = west + (c / (grid - 1)) * (east - west);
    }
  }
  const stepM = (((north - south) * Math.PI) / 180 / (grid - 1)) * R_M;
  const dLat = ((stepM / R_M) * 180) / Math.PI;
  const wrap = (v: number): number => ((((v + 180) % 360) + 360) % 360) - 180;
  const qLat = new Float64Array(5 * n);
  const qLon = new Float64Array(5 * n);
  for (let i = 0; i < n; i++) {
    const la = lat[i] ?? 0;
    const lo = lon[i] ?? 0;
    const dLon = dLat / Math.max(Math.cos((la * Math.PI) / 180), 1e-6);
    const points: [number, number][] = [
      [la, lo],
      [la, wrap(lo + dLon)],
      [la, wrap(lo - dLon)],
      [Math.min(la + dLat, 90), lo],
      [Math.max(la - dLat, -90), lo],
    ];
    points.forEach(([pla, plo], k) => {
      qLat[k * n + i] = pla;
      qLon[k * n + i] = plo;
    });
  }
  const all = await heights(qLat, qLon);
  const h = all.subarray(0, n);
  for (const v of all) {
    if (Number.isNaN(v)) throw new Error(`tile ${z}/${x}/${y}: a height is missing`);
  }

  let hMin = Infinity;
  let hMax = -Infinity;
  for (const v of h) {
    hMin = Math.min(hMin, v);
    hMax = Math.max(hMax, v);
  }
  const span = Math.max(hMax - hMin, 1);

  const { order, codes } = gridOrder(grid);
  const u = new Int32Array(n);
  const v = new Int32Array(n);
  const hq = new Int32Array(n);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const positions: [number, number, number][] = [];
  order.forEach((i, k) => {
    const r = Math.floor(i / grid);
    const c = i % grid;
    u[k] = rint((c / (grid - 1)) * MAX);
    v[k] = rint((r / (grid - 1)) * MAX);
    hq[k] = rint((((h[i] ?? 0) - hMin) / span) * MAX);
    const p = ecef(lat[i] ?? 0, lon[i] ?? 0, h[i] ?? 0);
    positions.push(p);
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a] ?? 0, p[a] ?? 0);
      hi[a] = Math.max(hi[a] ?? 0, p[a] ?? 0);
    }
  });
  const centre = [0, 1, 2].map((a) => ((lo[a] ?? 0) + (hi[a] ?? 0)) / 2) as [
    number,
    number,
    number,
  ];
  let radius = 0;
  for (const p of positions) {
    radius = Math.max(radius, Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]));
  }
  const mid = ecef((south + north) / 2, (west + east) / 2, (hMin + hMax) / 2);

  const normals = new Uint8Array(2 * n);
  order.forEach((i, k) => {
    const la = ((lat[i] ?? 0) * Math.PI) / 180;
    const lon0 = ((lon[i] ?? 0) * Math.PI) / 180;
    const ge = ((all[n + i] ?? 0) - (all[2 * n + i] ?? 0)) / (2 * stepM);
    const gn = ((all[3 * n + i] ?? 0) - (all[4 * n + i] ?? 0)) / (2 * stepM);
    const len = Math.sqrt(1 + ge * ge + gn * gn);
    let [e, no, up] = [-ge / len, -gn / len, 1 / len];
    if (Math.abs(lat[i] ?? 0) > 89.9999) [e, no, up] = [0, 0, 1];
    const east = [-Math.sin(lon0), Math.cos(lon0), 0];
    const northV = [-Math.sin(la) * Math.cos(lon0), -Math.sin(la) * Math.sin(lon0), Math.cos(la)];
    const upV = [Math.cos(la) * Math.cos(lon0), Math.cos(la) * Math.sin(lon0), Math.sin(la)];
    const b = [0, 1, 2].map((a) => (east[a] ?? 0) * e + (northV[a] ?? 0) * no + (upV[a] ?? 0) * up);
    const [ox, oy] = octEncode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 1);
    normals[2 * k] = ox;
    normals[2 * k + 1] = oy;
  });

  const edges = [
    (k: number) => u[k] === 0,
    (k: number) => v[k] === 0,
    (k: number) => u[k] === MAX,
    (k: number) => v[k] === MAX,
  ].map((test) => {
    const ids: number[] = [];
    for (let k = 0; k < n; k++) if (test(k)) ids.push(k);
    return Uint16Array.from(ids);
  });

  const size =
    88 +
    4 +
    6 * n +
    4 +
    codes.length * 2 +
    edges.reduce((s, e) => s + 4 + e.length * 2, 0) +
    5 +
    2 * n;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const f64 = (value: number): void => {
    view.setFloat64(at, value, true);
    at += 8;
  };
  const u32 = (value: number): void => {
    view.setUint32(at, value, true);
    at += 4;
  };
  const u16s = (values: Uint16Array): void => {
    values.forEach((value) => {
      view.setUint16(at, value, true);
      at += 2;
    });
  };
  mid.forEach(f64);
  view.setFloat32(at, hMin, true);
  view.setFloat32(at + 4, hMax, true);
  at += 8;
  [...centre, radius].forEach(f64);
  centre.forEach(f64); // horizon occlusion point: not used by the renderer
  u32(n);
  u16s(zigzag(u));
  u16s(zigzag(v));
  u16s(zigzag(hq));
  u32(codes.length / 3);
  u16s(codes);
  for (const edge of edges) {
    u32(edge.length);
    u16s(edge);
  }
  // Extension 1, octvertexnormals: body-frame unit normals, 2 bytes each.
  out[at] = 1;
  at += 1;
  u32(normals.length);
  out.set(normals, at);
  at += normals.length;
  if (at !== size) throw new Error(`tile size ${at}, expected ${size}`);
  return out;
}
