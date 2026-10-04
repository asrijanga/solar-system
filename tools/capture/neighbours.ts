// Checks on views of Mars's moons (docs/stories/SS-14.md, W8). The harness rebuilds the camera
// from the viewpoint in J2000 with the app's own pure-TypeScript geometry (core/marsMoons.ts,
// core/mars.ts), reading the committed data files, and predicts what the image must show without
// three.js or the shader: the moon's brightness from its law summed over its shape's facets, and
// where its named crater is.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { PNG } from 'pngjs';
import type { BodyCheck, BodySetup } from '../../src/capture/viewpoints.ts';
import { marsEpochAt, type MarsEpoch, type MarsTimelineManifest } from '../../src/core/mars.ts';
import {
  DEIMOS_LAW,
  decodeShape,
  monthFor,
  moonIOverF,
  moonsAt,
  neighbourPose,
  PHOBOS_LAW,
  sunlitFraction,
  type MoonShape,
  type MoonsManifest,
} from '../../src/core/marsMoons.ts';
import { AU_KM, EXPOSURE } from '../../src/core/photometry.ts';
import type { CheckResult } from './checks.ts';

type V3 = [number, number, number];
const MARS = join(import.meta.dirname, '..', '..', 'public', 'data', 'mars');

const dot = (a: readonly number[], b: readonly number[]): number =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
const cross = (a: readonly number[], b: readonly number[]): V3 => [
  (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
  (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
  (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
];
const sub = (a: readonly number[], b: readonly number[]): V3 => [
  (a[0] ?? 0) - (b[0] ?? 0),
  (a[1] ?? 0) - (b[1] ?? 0),
  (a[2] ?? 0) - (b[2] ?? 0),
];
const unit = (a: readonly number[]): V3 => {
  const l = Math.hypot(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
  return [(a[0] ?? 0) / l, (a[1] ?? 0) / l, (a[2] ?? 0) / l];
};
const linear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (png: PNG, i: number): number =>
  0.2126 * linear(png.data[i * 4] ?? 0) +
  0.7152 * linear(png.data[i * 4 + 1] ?? 0) +
  0.0722 * linear(png.data[i * 4 + 2] ?? 0);

/** The epoch at a viewpoint's instant, from Mars's timeline, as the page builds it. */
export function epochAtUtc(utc: string): MarsEpoch {
  const manifest = JSON.parse(
    readFileSync(join(MARS, 'timeline.json'), 'utf8'),
  ) as MarsTimelineManifest;
  const bytes = readFileSync(join(MARS, 'timeline.bin'));
  const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const epoch = marsEpochAt(manifest, data, Date.parse(utc));
  if (epoch === null) throw new Error(`${utc} is outside Mars's timeline`);
  return epoch;
}

interface View {
  readonly epoch: MarsEpoch;
  readonly centre: V3;
  /** Rows: J2000 to the moon's frame. */
  readonly toBody: readonly (readonly number[])[];
  readonly shape: MoonShape;
  readonly radiiKm: readonly number[];
  readonly camera: V3;
  readonly forward: V3;
  readonly right: V3;
  readonly up: V3;
  readonly tanHalf: number;
  readonly width: number;
  readonly height: number;
}

function buildView(setup: BodySetup, width: number, height: number): View {
  const neighbour = setup.neighbour;
  if (neighbour === null || setup.utc === null) throw new Error('not a view of a moon');
  const epoch = epochAtUtc(setup.utc);
  const manifest = JSON.parse(readFileSync(join(MARS, 'moons.json'), 'utf8')) as MoonsManifest;
  const month = monthFor(manifest, epoch.utc);
  if (month === null) throw new Error(`no moons file for ${epoch.utc}`);
  const bytes = readFileSync(join(MARS, 'moons', month.file));
  const at = moonsAt(
    manifest,
    month,
    new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4),
    epoch.tdbSecondsPastJ2000,
  );
  const raw = gunzipSync(readFileSync(join(MARS, 'moons', manifest.shapes[neighbour.moon].file)));
  const shape = decodeShape(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const centre = (neighbour.moon === 'phobos' ? at.phobosJ2000Km : at.deimosJ2000Km) as V3;
  const toBody = neighbour.moon === 'phobos' ? at.j2000ToPhobos : at.j2000ToDeimos;
  const pose = neighbourPose(
    centre,
    toBody,
    epoch.j2000ToBodyFixed[2],
    neighbour.lonDeg,
    neighbour.latDeg,
    neighbour.distanceKm,
  );
  const ephemeris = JSON.parse(readFileSync(join(MARS, 'ephemeris.json'), 'utf8')) as {
    body: { radiiKm: number[] };
  };
  const forward = unit(sub(pose.target, pose.position));
  const right = unit(cross(forward, pose.up));
  return {
    epoch,
    centre,
    toBody,
    shape,
    radiiKm: ephemeris.body.radiiKm,
    camera: [...pose.position] as V3,
    forward,
    right,
    up: cross(right, forward),
    tanHalf: Math.tan((setup.fovDeg * Math.PI) / 360),
    width,
    height,
  };
}

/** Body-fixed to J2000: the transpose of the rows. */
function toJ2000(view: View, b: readonly number[]): V3 {
  const m = view.toBody;
  return [0, 1, 2].map(
    (j) =>
      (m[0]?.[j] ?? 0) * (b[0] ?? 0) +
      (m[1]?.[j] ?? 0) * (b[1] ?? 0) +
      (m[2]?.[j] ?? 0) * (b[2] ?? 0),
  ) as V3;
}

/** The pixel a J2000 point projects to, or null behind the camera. */
function project(view: View, p: readonly number[]): [number, number] | null {
  const d = sub(p, view.camera);
  const z = dot(d, view.forward);
  if (z <= 0) return null;
  const u = dot(d, view.right) / z / view.tanHalf;
  const v = dot(d, view.up) / z / view.tanHalf;
  const aspect = view.width / view.height;
  return [((u / aspect + 1) / 2) * view.width - 0.5, ((1 - v) / 2) * view.height - 0.5];
}

/** Where the ray from the moon's centre along body direction `b` leaves its surface, body km. */
function surfacePoint(shape: MoonShape, b: V3): V3 {
  const p = shape.positions;
  const t = shape.indices;
  let best = -1;
  for (let k = 0; k < t.length; k += 3) {
    const a = (t[k] ?? 0) * 3;
    const i1 = (t[k + 1] ?? 0) * 3;
    const i2 = (t[k + 2] ?? 0) * 3;
    const v0: V3 = [p[a] ?? 0, p[a + 1] ?? 0, p[a + 2] ?? 0];
    const e1 = sub([p[i1] ?? 0, p[i1 + 1] ?? 0, p[i1 + 2] ?? 0], v0);
    const e2 = sub([p[i2] ?? 0, p[i2 + 1] ?? 0, p[i2 + 2] ?? 0], v0);
    // Möller–Trumbore from the origin.
    const h = cross(b, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s: V3 = [-v0[0], -v0[1], -v0[2]];
    const u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(b, q) / det;
    if (v < 0 || u + v > 1) continue;
    const dist = dot(e2, q) / det;
    if (dist > best) best = dist;
  }
  if (best <= 0) throw new Error('a ray from the moon’s centre found no surface');
  return [b[0] * best, b[1] * best, b[2] * best];
}

function lawFor(setup: BodySetup) {
  return setup.neighbour?.moon === 'deimos' ? DEIMOS_LAW : PHOBOS_LAW;
}

export function runNeighbourCheck(png: PNG, setup: BodySetup, check: BodyCheck): CheckResult {
  const view = buildView(setup, png.width, png.height);
  const { epoch } = view;
  const sun = epoch.sunDirectionJ2000;
  const [a, , c] = view.radiiKm;
  const lit = sunlitFraction(
    view.centre,
    epoch.j2000ToBodyFixed[2],
    (c ?? 1) / (a ?? 1),
    a ?? 0,
    sun,
    epoch.sunDistanceKm,
  );
  switch (check.kind) {
    case 'neighbour-brightness': {
      if (lit !== 1) throw new Error(`${check.name}: the moon is not in full sunlight`);
      // Mars must be out of the frame, or its light would count.
      const toMars = unit(sub([0, 0, 0], view.camera));
      const marsRadius = Math.asin((a ?? 0) / Math.hypot(...view.camera));
      const corner = Math.atan(view.tanHalf * Math.hypot(1, view.width / view.height));
      if (Math.acos(dot(toMars, view.forward)) < corner + marsRadius) {
        throw new Error(`${check.name}: Mars is in the frame`);
      }
      // Drawn: luminance times each pixel's solid angle, over the moon's bounding cone.
      const pixelSide = (2 * view.tanHalf) / view.height;
      let outer = 0;
      for (let i = 0; i < view.shape.positions.length; i += 3) {
        const pp = view.shape.positions;
        outer = Math.max(outer, Math.hypot(pp[i] ?? 0, pp[i + 1] ?? 0, pp[i + 2] ?? 0));
      }
      // The moon's bounding cone, a few pixels wider for the point of light and the edges.
      const bound =
        Math.asin(outer / Math.hypot(...sub(view.centre, view.camera))) +
        (4 * 2 * view.tanHalf) / view.height;
      const toCentre = unit(sub(view.centre, view.camera));
      let drawn = 0;
      for (let y = 0; y < view.height; y++) {
        for (let x = 0; x < view.width; x++) {
          const u = ((x + 0.5) / view.width) * 2 - 1;
          const v = 1 - ((y + 0.5) / view.height) * 2;
          const aspect = view.width / view.height;
          const ray = unit([
            view.forward[0] +
              u * aspect * view.tanHalf * view.right[0] +
              v * view.tanHalf * view.up[0],
            view.forward[1] +
              u * aspect * view.tanHalf * view.right[1] +
              v * view.tanHalf * view.up[1],
            view.forward[2] +
              u * aspect * view.tanHalf * view.right[2] +
              v * view.tanHalf * view.up[2],
          ]);
          if (Math.acos(Math.min(1, dot(ray, toCentre))) > bound) continue;
          const cos = dot(ray, view.forward);
          drawn += luminance(png, y * view.width + x) * pixelSide * pixelSide * cos * cos * cos;
        }
      }
      // Predicted: the law over every facet that is lit and faces the camera, each by the solid
      // angle it covers. Nothing on the moon shades anything else here.
      const law = lawFor(setup);
      const p = view.shape.positions;
      const t = view.shape.indices;
      let predicted = 0;
      for (let k = 0; k < t.length; k += 3) {
        const i0 = (t[k] ?? 0) * 3;
        const i1 = (t[k + 1] ?? 0) * 3;
        const i2 = (t[k + 2] ?? 0) * 3;
        const v0: V3 = [p[i0] ?? 0, p[i0 + 1] ?? 0, p[i0 + 2] ?? 0];
        const v1: V3 = [p[i1] ?? 0, p[i1 + 1] ?? 0, p[i1 + 2] ?? 0];
        const v2: V3 = [p[i2] ?? 0, p[i2 + 1] ?? 0, p[i2 + 2] ?? 0];
        const n2 = cross(sub(v1, v0), sub(v2, v0));
        const area = Math.hypot(...n2) / 2;
        const normal = toJ2000(view, unit(n2));
        const centreBody = [0, 1, 2].map((j) => ((v0[j] ?? 0) + (v1[j] ?? 0) + (v2[j] ?? 0)) / 3);
        const at = toJ2000(view, centreBody).map((x, j) => x + (view.centre[j] ?? 0));
        const toCamera = sub(view.camera, at);
        const dist = Math.hypot(...toCamera);
        const e = unit(toCamera);
        const mu = dot(normal, e);
        const mu0 = dot(normal, sun);
        if (mu <= 0 || mu0 <= 0) continue;
        predicted += (moonIOverF(law, mu0, mu, dot(sun, e)) * mu * area) / (dist * dist);
      }
      const r = epoch.sunDistanceKm / AU_KM;
      predicted *= EXPOSURE / (r * r);
      const off = drawn / predicted - 1;
      const pass = Math.abs(off) <= check.tolerance;
      return {
        name: `${check.name}: drawn ${drawn.toExponential(4)}, the law ${predicted.toExponential(4)} (${off >= 0 ? '+' : ''}${(off * 100).toFixed(2)}%)`,
        pass,
        fraction: pass ? 1 : 0,
      };
    }
    case 'neighbour-walls': {
      if (lit !== 1) throw new Error(`${check.name}: the moon is not in full sunlight`);
      const centreBody = surfacePoint(view.shape, unitLonLat(check.lonDeg, check.latDeg));
      const radiusRad = check.diameterKm / 2 / Math.hypot(...centreBody);
      const mean = (sign: 1 | -1): { value: number; count: number } => {
        let sum = 0;
        let count = 0;
        // Points in the band east (sign 1) or west of the centre, within 45° of due east or west.
        for (
          let f = check.inner[0];
          f <= check.inner[1] + 1e-9;
          f += (check.inner[1] - check.inner[0]) / 4
        ) {
          for (let bearing = -40; bearing <= 40; bearing += 10) {
            const rho = f * radiusRad;
            const az = (((sign === 1 ? 90 : 270) + bearing) * Math.PI) / 180;
            const lat0 = (check.latDeg * Math.PI) / 180;
            const lon0 = (check.lonDeg * Math.PI) / 180;
            // Destination point on a sphere: bearing az from north (90° is east).
            const lat = Math.asin(
              Math.sin(lat0) * Math.cos(rho) + Math.cos(lat0) * Math.sin(rho) * Math.cos(az),
            );
            const lon =
              lon0 +
              Math.atan2(
                Math.sin(az) * Math.sin(rho) * Math.cos(lat0),
                Math.cos(rho) - Math.sin(lat0) * Math.sin(lat),
              );
            const body = surfacePoint(
              view.shape,
              unitLonLat((lon * 180) / Math.PI, (lat * 180) / Math.PI),
            );
            const at = toJ2000(view, body).map((x, j) => x + (view.centre[j] ?? 0));
            const pixel = project(view, at);
            if (pixel === null) continue;
            const px = Math.round(pixel[0]);
            const py = Math.round(pixel[1]);
            if (px < 0 || py < 0 || px >= view.width || py >= view.height) continue;
            sum += luminance(png, py * view.width + px);
            count++;
          }
        }
        return { value: count === 0 ? Number.NaN : sum / count, count };
      };
      const east = mean(1);
      const west = mean(-1);
      const pass =
        east.count > 0 &&
        west.count > 0 &&
        (check.brighter === 'east' ? east.value > west.value : west.value > east.value);
      return {
        name: `${check.name}: east ${east.value.toFixed(4)} (${east.count} points), west ${west.value.toFixed(4)} (${west.count}), ${check.brighter} expected brighter`,
        pass,
        fraction: pass ? 1 : 0,
      };
    }
    case 'black': {
      if (lit !== 0) throw new Error(`${check.name}: the moon is not in Mars's umbra (${lit})`);
      let max = 0;
      for (let i = 0; i < png.width * png.height * 4; i++) {
        if (i % 4 !== 3) max = Math.max(max, png.data[i] ?? 0);
      }
      const pass = max <= check.maxLevel;
      return { name: `${check.name}: brightest level ${max}`, pass, fraction: pass ? 1 : 0 };
    }
    default:
      throw new Error(`${check.kind} is not a check on a view of a moon`);
  }
}

function unitLonLat(lonDeg: number, latDeg: number): V3 {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}
