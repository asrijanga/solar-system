// Mars's neighbours in its sky (docs/stories/SS-14.md, W8): Phobos and Deimos as lit shapes, and
// Earth and the Moon as points of light. Positions and orientations from SPICE through
// pipeline/moons_mars.py (public/data/mars/moons.json, moons/YYYY-MM.bin); brightness from each
// body's own measured photometry. Pure TypeScript: no three.js (CLAUDE.md).
//
// Frames: positions are J2000 from Mars's centre, km. Each moon's shape is in its IAU frame
// (IAU_PHOBOS, IAU_DEIMOS: +x towards longitude 0 on the equator, +z north, east-positive),
// turned by pck00011's model evaluated as IAU_MARS is (core/mars.ts).
import { hapke, porosityFactor, singleLobe, type HapkeParameters } from './hapke.ts';
import { marsRotation, type MarsRotation } from './mars.ts';
import type { Mat3Rows, Vec3 } from './moon.ts';
import { SUN_V_MAGNITUDE } from './photometry.ts';

/** A moon's scattering law, as its paper fitted it (core/hapke.ts with K). */
export interface MoonLaw {
  readonly parameters: HapkeParameters;
  readonly thetaBarDeg: number;
  readonly porosityK: number;
  readonly source: string;
  /** The geometric albedo the law is checked against (the owner's thresholds, SS-14 W8). */
  readonly geometricAlbedo: {
    readonly value: number;
    readonly tolerance: number;
    readonly source: string;
  };
}

/**
 * Phobos: Fornasier et al. (2024), A&A, arXiv:2403.12156, Table 3, green filter (HRSC, about
 * 538 nm), read from the arXiv PDF 2026-10-04: "Hapke 2012 parameters derived from the Phobos
 * disk-resolved photometry": w = 0.0725, g = -0.267 (single-term Henyey-Greenstein, negative
 * backscatters), B0 = 2.283, h = 0.05728 (both fixed from their SRC disk-averaged fit), θ̄ =
 * 24.07°, K = 1.19 (porosity 0.87). Coherent backscatter left out, as they did (§5).
 *
 * The check's reference is their disk-averaged green geometric albedo, 0.0816 (Table 1), within
 * 3%: Table 3's printed 0.0683 is the law without K, and the law with K, as fitted (their Eq. 6),
 * gives 0.084 (owner, 2026-10-04).
 */
export const PHOBOS_LAW: MoonLaw = {
  parameters: { w: 0.0725, ...singleLobe(-0.267), bs0: 2.283, hs: 0.05728 },
  thetaBarDeg: 24.07,
  porosityK: 1.19,
  source:
    'Fornasier et al. (2024), "Phobos photometric properties from Mars Express HRSC observations", A&A, arXiv:2403.12156, Table 3 (green)',
  geometricAlbedo: {
    value: 0.0816,
    tolerance: 0.03,
    source: 'Fornasier et al. (2024), Table 1, HRSC green, disk-averaged',
  },
};

/**
 * Deimos: Wargnier et al. (2025), A&A, arXiv:2509.12804, Table 5 (SRC), read 2026-10-04:
 * w = 0.068, g = -0.275, B_S0 = 2.14, h_S = 0.065, θ̄ = 19.4°, porosity 85.7%, so K = 1.214 by
 * Hapke's formula (core/hapke.ts porosityFactor). Geometric albedo 0.080 (their Table 4), within
 * 2%. Only the side facing Mars was observed.
 */
export const DEIMOS_LAW: MoonLaw = {
  parameters: { w: 0.068, ...singleLobe(-0.275), bs0: 2.14, hs: 0.065 },
  thetaBarDeg: 19.4,
  porosityK: porosityFactor(0.857),
  source:
    'Wargnier et al. (2025), "Deimos photometric properties", A&A, arXiv:2509.12804, Table 5 (SRC)',
  geometricAlbedo: {
    value: 0.08,
    tolerance: 0.02,
    source: 'Wargnier et al. (2025), Table 4',
  },
};

/** I/F of a moon's surface: its law at these cosines. */
export function moonIOverF(law: MoonLaw, mu0: number, mu: number, cosG: number): number {
  return hapke(mu0, mu, cosG, law.parameters, law.thetaBarDeg, law.porosityK);
}

/**
 * Earth's V magnitude: Mallama & Hilton (2018), Astronomy and Computing 25, arXiv:1808.01973,
 * Eq. 5, read from the arXiv copy 2026-10-04: "V = 5 log10 ( r d ) -3.99 – 1.060E-3 α +
 * 2.054E-4 α2", r and d in AU, α in degrees, from V(1,0) = -3.99 (geometric albedo 0.434).
 */
export function earthMagnitudeV(rAu: number, dAu: number, alphaDeg: number): number {
  return 5 * Math.log10(rAu * dAu) - 3.99 - 1.06e-3 * alphaDeg + 2.054e-4 * alphaDeg * alphaDeg;
}

/**
 * The V magnitude of a body whose I/F summed over its disc, times the area each part presents to
 * the viewer, is `sumKm2`, seen from `distanceKm` with the Sun `sunDistanceAu` away from it: its
 * irradiance over the Sun's at 1 AU is sumKm2 / (π d² r²). A sphere of geometric albedo p seen at
 * zero phase has sumKm2 = p π R², which gives core/photometry.ts zeroPhaseMagnitude.
 */
export function magnitudeFromSum(
  sumKm2: number,
  distanceKm: number,
  sunDistanceAu: number,
): number {
  return (
    SUN_V_MAGNITUDE -
    2.5 * Math.log10(sumKm2 / (Math.PI * distanceKm * distanceKm * sunDistanceAu * sunDistanceAu))
  );
}

/** A shape as public/data/mars/moons/<moon>.bin.gz holds it, decompressed. */
export interface MoonShape {
  /** Vertices, km, in the moon's IAU frame. */
  readonly positions: Float32Array;
  /** Triangles, counter-clockwise seen from outside. */
  readonly indices: Uint32Array;
}

/**
 * Decodes a shape: uint32 vertex and triangle counts, then int16 metres per vertex component as
 * differences from the previous vertex, then int32 indices as differences from the previous
 * index (pipeline/moons_mars.py).
 */
export function decodeShape(raw: ArrayBuffer): MoonShape {
  const view = new DataView(raw);
  const vertices = view.getUint32(0, true);
  const triangles = view.getUint32(4, true);
  const expected = 8 + vertices * 6 + triangles * 12;
  if (raw.byteLength !== expected) {
    throw new Error(`a moon's shape is ${raw.byteLength} bytes, not ${expected}`);
  }
  const positions = new Float32Array(vertices * 3);
  const xyz = [0, 0, 0];
  let at = 8;
  for (let i = 0; i < vertices * 3; i++) {
    const c = i % 3;
    xyz[c] = (xyz[c] ?? 0) + view.getInt16(at, true);
    positions[i] = (xyz[c] ?? 0) / 1000;
    at += 2;
  }
  const indices = new Uint32Array(triangles * 3);
  let index = 0;
  for (let i = 0; i < triangles * 3; i++) {
    index += view.getInt32(at, true);
    indices[i] = index;
    at += 4;
  }
  return { positions, indices };
}

/**
 * A shape reduced to what its whole-disc brightness depends on when nothing on it shades
 * anything else: its triangles' areas, binned by the direction they face. Each bin keeps its
 * summed area and its area-weighted mean normal.
 */
export interface FacetBins {
  /** Unit mean normal per bin, xyz. */
  readonly normals: Float64Array;
  /** Summed area per bin, km². */
  readonly areas: Float64Array;
}

/** Bins of `step` degrees of latitude and longitude of the facing direction. */
export function facetBins(shape: MoonShape, stepDeg = 3): FacetBins {
  const rows = Math.round(180 / stepDeg);
  const cols = Math.round(360 / stepDeg);
  const sum = new Float64Array(rows * cols * 3);
  const area = new Float64Array(rows * cols);
  const p = shape.positions;
  const t = shape.indices;
  for (let k = 0; k < t.length; k += 3) {
    const a = (t[k] ?? 0) * 3;
    const b = (t[k + 1] ?? 0) * 3;
    const c = (t[k + 2] ?? 0) * 3;
    const ux = (p[b] ?? 0) - (p[a] ?? 0);
    const uy = (p[b + 1] ?? 0) - (p[a + 1] ?? 0);
    const uz = (p[b + 2] ?? 0) - (p[a + 2] ?? 0);
    const vx = (p[c] ?? 0) - (p[a] ?? 0);
    const vy = (p[c + 1] ?? 0) - (p[a + 1] ?? 0);
    const vz = (p[c + 2] ?? 0) - (p[a + 2] ?? 0);
    // Cross product: twice the area, along the outward normal.
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const twice = Math.hypot(nx, ny, nz);
    if (twice === 0) continue;
    const lat = Math.asin(Math.max(-1, Math.min(1, nz / twice)));
    const lon = Math.atan2(ny, nx);
    const row = Math.min(rows - 1, Math.floor(((lat + Math.PI / 2) / Math.PI) * rows));
    const col = Math.min(cols - 1, Math.floor(((lon + Math.PI) / (2 * Math.PI)) * cols));
    const bin = row * cols + col;
    sum[bin * 3] = (sum[bin * 3] ?? 0) + nx / 2;
    sum[bin * 3 + 1] = (sum[bin * 3 + 1] ?? 0) + ny / 2;
    sum[bin * 3 + 2] = (sum[bin * 3 + 2] ?? 0) + nz / 2;
    area[bin] = (area[bin] ?? 0) + twice / 2;
  }
  const used = Array.from(area.keys()).filter((i) => (area[i] ?? 0) > 0);
  const normals = new Float64Array(used.length * 3);
  const areas = new Float64Array(used.length);
  used.forEach((bin, j) => {
    const x = sum[bin * 3] ?? 0;
    const y = sum[bin * 3 + 1] ?? 0;
    const z = sum[bin * 3 + 2] ?? 0;
    const l = Math.hypot(x, y, z);
    normals.set([x / l, y / l, z / l], j * 3);
    areas[j] = area[bin] ?? 0;
  });
  return { normals, areas };
}

/**
 * I/F summed over the facets lit and facing the viewer, each times its area as the viewer sees
 * it (km²), for unit directions to the Sun and to a distant viewer in the moon's own frame.
 * Nothing on the moon shades anything else here.
 */
export function discSum(bins: FacetBins, law: MoonLaw, toSun: Vec3, toViewer: Vec3): number {
  const cosG = toSun[0] * toViewer[0] + toSun[1] * toViewer[1] + toSun[2] * toViewer[2];
  const n = bins.normals;
  let total = 0;
  for (let j = 0; j < bins.areas.length; j++) {
    const x = n[j * 3] ?? 0;
    const y = n[j * 3 + 1] ?? 0;
    const z = n[j * 3 + 2] ?? 0;
    const mu0 = x * toSun[0] + y * toSun[1] + z * toSun[2];
    const mu = x * toViewer[0] + y * toViewer[1] + z * toViewer[2];
    if (mu0 <= 0 || mu <= 0) continue;
    total += moonIOverF(law, mu0, mu, cosG) * mu * (bins.areas[j] ?? 0);
  }
  return total;
}

/** The geometric albedo a law gives a sphere: its disc's mean I/F at zero phase, numerically. */
export function sphereGeometricAlbedo(law: MoonLaw, samples = 400): number {
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const x = -1 + (2 * i + 1) / samples;
      const y = -1 + (2 * j + 1) / samples;
      const r2 = x * x + y * y;
      if (r2 >= 1) continue;
      const mu = Math.sqrt(1 - r2);
      sum += moonIOverF(law, mu, mu, 1) * (4 / (samples * samples));
    }
  }
  return sum / Math.PI;
}

/**
 * A table of a moon's disc sum against the viewer's direction in its frame, for a fixed Sun:
 * rows of latitude from -90° to 90° and columns of longitude from -180° to 180°, `stepDeg` apart,
 * so a point of light carries the moon's whole brightness from wherever it is seen.
 */
export interface DiscTable {
  readonly stepDeg: number;
  readonly rows: number;
  readonly cols: number;
  readonly values: Float64Array;
}

export function discTable(bins: FacetBins, law: MoonLaw, toSun: Vec3, stepDeg = 5): DiscTable {
  const rows = Math.round(180 / stepDeg) + 1;
  const cols = Math.round(360 / stepDeg) + 1;
  const values = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const lat = ((-90 + r * stepDeg) * Math.PI) / 180;
    for (let c = 0; c < cols; c++) {
      const lon = ((-180 + c * stepDeg) * Math.PI) / 180;
      const view: Vec3 = [
        Math.cos(lat) * Math.cos(lon),
        Math.cos(lat) * Math.sin(lon),
        Math.sin(lat),
      ];
      values[r * cols + c] = discSum(bins, law, toSun, view);
    }
  }
  return { stepDeg, rows, cols, values };
}

/** The table's value for unit direction (x, y, z) to the viewer, bilinear. Allocates nothing. */
export function lookupDisc(table: DiscTable, x: number, y: number, z: number): number {
  const lat = (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI;
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  const fr = Math.min(table.rows - 1.000001, (lat + 90) / table.stepDeg);
  const fc = Math.min(table.cols - 1.000001, (lon + 180) / table.stepDeg);
  const r = Math.floor(fr);
  const c = Math.floor(fc);
  const dr = fr - r;
  const dc = fc - c;
  const v = table.values;
  // No closure here: this runs every frame and must allocate nothing.
  const i00 = r * table.cols + c;
  const i10 = i00 + table.cols;
  return (
    (1 - dr) * ((1 - dc) * (v[i00] ?? 0) + dc * (v[i00 + 1] ?? 0)) +
    dr * ((1 - dc) * (v[i10] ?? 0) + dc * (v[i10 + 1] ?? 0))
  );
}

export interface MoonsMonth {
  readonly month: string;
  readonly file: string;
  readonly fromUtc: string;
  readonly toUtc: string;
  readonly firstPhobosTdbSecondsPastJ2000: number;
  readonly firstDeimosTdbSecondsPastJ2000: number;
  readonly phobosSamples: number;
  readonly deimosSamples: number;
  readonly firstMoonDiscTdbSecondsPastJ2000: number;
  readonly moonDiscSamples: number;
}

export interface MoonsManifest {
  readonly positions: {
    readonly phobosStepMinutes: number;
    readonly deimosStepMinutes: number;
    readonly moonDiscStepMinutes: number;
    readonly months: readonly MoonsMonth[];
  };
  readonly shapes: Readonly<Record<'phobos' | 'deimos', { readonly file: string }>>;
  readonly rotation: Readonly<Record<'phobos' | 'deimos', MarsRotation>>;
  readonly stickney: { readonly latDeg: number; readonly lonEastDeg: number };
}

/** The month whose file holds `utc` (ISO 8601), or null outside the span. */
export function monthFor(manifest: MoonsManifest, utc: string): MoonsMonth | null {
  const ms = Date.parse(utc.endsWith('Z') ? utc : `${utc}Z`);
  return (
    manifest.positions.months.find(
      (m) => Date.parse(m.fromUtc) <= ms && ms < Date.parse(m.toUtc),
    ) ?? null
  );
}

/** Where the moons are at an instant, and how they are turned. */
export interface MoonsAt {
  readonly phobosJ2000Km: Vec3;
  readonly deimosJ2000Km: Vec3;
  /** The Moon minus Earth, as seen from Mars (LT+S each), km. */
  readonly moonOffsetJ2000Km: Vec3;
  /** The Moon page's I/F summed over the disc Mars sees, times projected area, km². */
  readonly moonDiscKm2: number;
  readonly j2000ToPhobos: Mat3Rows;
  readonly j2000ToDeimos: Mat3Rows;
}

function lagrange(
  data: Float32Array,
  offset: number,
  width: number,
  position: number,
  field: number,
): number {
  const k = Math.floor(position);
  const x = position - k;
  const w0 = (-x * (x - 1) * (x - 2)) / 6;
  const w1 = ((x + 1) * (x - 1) * (x - 2)) / 2;
  const w2 = (-(x + 1) * x * (x - 2)) / 2;
  const w3 = ((x + 1) * x * (x - 1)) / 6;
  const at = (j: number): number => data[offset + (k - 1 + j) * width + field] ?? 0;
  return w0 * at(0) + w1 * at(1) + w2 * at(2) + w3 * at(3);
}

/**
 * The moons at a TDB instant within `month`, from its file's samples with the timeline's 4-point
 * Lagrange polynomial (core/timeline.ts). Runs once when the page opens, not in the frame loop.
 */
export function moonsAt(
  manifest: MoonsManifest,
  month: MoonsMonth,
  data: Float32Array,
  tdbSecondsPastJ2000: number,
): MoonsAt {
  const np = month.phobosSamples;
  const nd = month.deimosSamples;
  if (data.length !== (np + 2 * nd) * 3 + month.moonDiscSamples) {
    throw new Error(`moons/${month.file} does not match moons.json`);
  }
  const { phobosStepMinutes, deimosStepMinutes, moonDiscStepMinutes } = manifest.positions;
  const xp =
    (tdbSecondsPastJ2000 - month.firstPhobosTdbSecondsPastJ2000) / (phobosStepMinutes * 60);
  const xd =
    (tdbSecondsPastJ2000 - month.firstDeimosTdbSecondsPastJ2000) / (deimosStepMinutes * 60);
  const xm =
    (tdbSecondsPastJ2000 - month.firstMoonDiscTdbSecondsPastJ2000) / (moonDiscStepMinutes * 60);
  for (const [x, n] of [
    [xp, np],
    [xd, nd],
    [xm, month.moonDiscSamples],
  ] as const) {
    if (!(x >= 1 && x <= n - 3)) throw new Error(`the instant is outside moons/${month.file}`);
  }
  const vec = (offset: number, x: number): Vec3 => [
    lagrange(data, offset, 3, x, 0),
    lagrange(data, offset, 3, x, 1),
    lagrange(data, offset, 3, x, 2),
  ];
  return {
    phobosJ2000Km: vec(0, xp),
    deimosJ2000Km: vec(np * 3, xd),
    moonOffsetJ2000Km: vec((np + nd) * 3, xd),
    moonDiscKm2: lagrange(data, (np + 2 * nd) * 3, 1, xm, 0),
    j2000ToPhobos: marsRotation(manifest.rotation.phobos, tdbSecondsPastJ2000),
    j2000ToDeimos: marsRotation(manifest.rotation.deimos, tdbSecondsPastJ2000),
  };
}

/** The Sun's radius, km: IAU 2015 Resolution B3, nominal solar radius. */
export const SUN_RADIUS_KM = 695_700;

/**
 * The fraction of the Sun's disc that a sphere hides, seen from a point: the Sun of angular
 * radius `sunDeg`, the sphere of angular radius `bodyDeg`, their centres `separationDeg` apart.
 * The overlap of two circles on the sky, as a fraction of the Sun's. Branch-free in the shader
 * (scenes/marsMoons.ts); this is its reference.
 */
export function hiddenFraction(sunRad: number, bodyRad: number, separationRad: number): number {
  const a = sunRad;
  const b = bodyRad;
  const d = separationRad;
  if (d >= a + b) return 0;
  if (d <= Math.abs(b - a)) return b >= a ? 1 : (b * b) / (a * a);
  const alpha = Math.acos((d * d + a * a - b * b) / (2 * d * a));
  const beta = Math.acos((d * d + b * b - a * a) / (2 * d * b));
  const lens = a * a * (alpha - Math.sin(2 * alpha) / 2) + b * b * (beta - Math.sin(2 * beta) / 2);
  return lens / (Math.PI * a * a);
}

/**
 * The fraction of the Sun a point near Mars sees, with Mars's shadow cast by its ellipsoid. The
 * ellipsoid is made a sphere of its equatorial radius by stretching along the pole by a/c; the
 * point and the Sun's direction are stretched with it. `point` is from Mars's centre, km; `pole`
 * and `toSun` are unit vectors, all in one frame.
 */
export function sunlitFraction(
  point: Vec3,
  pole: Vec3,
  polarRatio: number,
  equatorialKm: number,
  toSun: Vec3,
  sunDistanceKm: number,
): number {
  const stretch = 1 / polarRatio - 1;
  const pn = point[0] * pole[0] + point[1] * pole[1] + point[2] * pole[2];
  const qx = point[0] + stretch * pn * pole[0];
  const qy = point[1] + stretch * pn * pole[1];
  const qz = point[2] + stretch * pn * pole[2];
  const sn = toSun[0] * pole[0] + toSun[1] * pole[1] + toSun[2] * pole[2];
  let sx = toSun[0] + stretch * sn * pole[0];
  let sy = toSun[1] + stretch * sn * pole[1];
  let sz = toSun[2] + stretch * sn * pole[2];
  const sl = Math.hypot(sx, sy, sz);
  sx /= sl;
  sy /= sl;
  sz /= sl;
  const q = Math.hypot(qx, qy, qz);
  if (q <= equatorialKm) return 0;
  // From the point, Mars's centre is along -q.
  const cosSep = -(qx * sx + qy * sy + qz * sz) / q;
  const separation = Math.acos(Math.max(-1, Math.min(1, cosSep)));
  return (
    1 -
    hiddenFraction(
      Math.asin(SUN_RADIUS_KM / sunDistanceKm),
      Math.asin(equatorialKm / q),
      separation,
    )
  );
}

/**
 * A camera over a moon (the captures' close views, SS-14 W8): `distanceKm` from its centre,
 * straight above the point at `lonDeg`, `latDeg` of its own frame, looking at its centre, with
 * Mars's north pole up. J2000, km from Mars's centre.
 */
export function neighbourPose(
  centreJ2000: Vec3,
  j2000ToBody: Mat3Rows,
  marsPoleJ2000: Vec3,
  lonDeg: number,
  latDeg: number,
  distanceKm: number,
): { readonly position: Vec3; readonly target: Vec3; readonly up: Vec3 } {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const b: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const m = j2000ToBody;
  const out: Vec3 = [
    m[0][0] * b[0] + m[1][0] * b[1] + m[2][0] * b[2],
    m[0][1] * b[0] + m[1][1] * b[1] + m[2][1] * b[2],
    m[0][2] * b[0] + m[1][2] * b[1] + m[2][2] * b[2],
  ];
  return {
    position: [
      centreJ2000[0] + out[0] * distanceKm,
      centreJ2000[1] + out[1] * distanceKm,
      centreJ2000[2] + out[2] * distanceKm,
    ],
    target: centreJ2000,
    up: marsPoleJ2000,
  };
}
