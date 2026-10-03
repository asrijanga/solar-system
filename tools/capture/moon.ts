// What a Moon capture must show, predicted pixel by pixel without the app's code paths.
//
// The camera is rebuilt from the viewpoint's Moon setup and ephemeris.json, in J2000, with
// no scene axes and no three.js. A ray through each pixel centre meets the true sphere, and
// the hit gives that pixel's longitude, latitude, μ0, μ and phase angle. The shading formula is
// the one the app's TSL must mirror: core/hapke.ts, which is unit-tested on its own.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PNG } from 'pngjs';
import type { BodyCheck, BodySetup } from '../../src/capture/viewpoints.ts';
import { hapke, type HapkeParameters } from '../../src/core/hapke.ts';
import { mallamaHiltonV } from '../../src/core/marsPhotometry.ts';
import {
  AU_KM,
  displayValue,
  EXPOSURE,
  linearToSrgb,
  SUN_V_MAGNITUDE,
} from '../../src/core/photometry.ts';
import type { CheckResult } from './checks.ts';

type V3 = [number, number, number];

export interface EphemerisFile {
  readonly body: { readonly radiiKm: readonly number[] };
  readonly epochs: readonly {
    readonly id: string;
    readonly sunDirectionJ2000: readonly number[];
    readonly sunDistanceKm: number;
    readonly earthDirectionJ2000: readonly number[];
    readonly j2000ToBodyFixed: readonly (readonly number[])[];
  }[];
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Per-pixel geometry of a Moon view. Arrays are row-major, one entry per pixel. */
export interface MoonPixels {
  readonly width: number;
  readonly height: number;
  /** 1 where the pixel's ray meets the sphere. */
  readonly hit: Uint8Array;
  /**
   * Body-fixed unit vector to the hit, 3 per pixel: the surface normal on a sphere, and the
   * planetocentric direction, which distances along the surface are measured with, on an
   * ellipsoid.
   */
  readonly normal: Float64Array;
  /** Each pixel's solid angle, steradians. */
  readonly solidAngle: Float64Array;
  readonly lonDeg: Float64Array;
  readonly mu0: Float64Array;
  readonly mu: Float64Array;
  /** Cosine of the phase angle: between the directions to the Sun and to the camera. */
  readonly cosG: Float64Array;
  readonly radiusKm: number;
  readonly sunDistanceKm: number;
  /** Sun-body-camera angle at the body's centre, degrees. */
  readonly phaseAngleDeg: number;
  /** The area the body's outline encloses seen from the camera's direction, km² (a sphere: πR²). */
  readonly projectedAreaKm2: number;
}

export function castMoonRays(
  setup: BodySetup,
  ephemeris: EphemerisFile,
  width: number,
  height: number,
): MoonPixels {
  const epoch = ephemeris.epochs.find((e) => e.id === setup.epoch);
  if (epoch === undefined) throw new Error(`ephemeris.json has no epoch ${setup.epoch}`);
  const radius = ephemeris.body.radiiKm[0] ?? Number.NaN;
  // An oblate world (Mars): equatorial a, polar c (pck00011). The Moon is a sphere.
  const polar = ephemeris.body.radiiKm[2] ?? radius;
  const m = epoch.j2000ToBodyFixed;
  const row = (i: number): readonly number[] => m[i] ?? [];
  // body = M · j2000; j2000 = Mᵀ · body.
  const toBody = (v: readonly number[]): V3 => [dot(row(0), v), dot(row(1), v), dot(row(2), v)];
  const toJ2000 = (b: V3): V3 => [
    (row(0)[0] ?? 0) * b[0] + (row(1)[0] ?? 0) * b[1] + (row(2)[0] ?? 0) * b[2],
    (row(0)[1] ?? 0) * b[0] + (row(1)[1] ?? 0) * b[1] + (row(2)[1] ?? 0) * b[2],
    (row(0)[2] ?? 0) * b[0] + (row(1)[2] ?? 0) * b[1] + (row(2)[2] ?? 0) * b[2],
  ];

  let from: V3;
  if (setup.vantage.kind === 'earth') {
    from = unit(epoch.earthDirectionJ2000 as unknown as V3);
  } else {
    const lon = (setup.vantage.lonDeg * Math.PI) / 180;
    const lat = (setup.vantage.latDeg * Math.PI) / 180;
    from = toJ2000([Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]);
  }
  const camera: V3 = [
    from[0] * setup.distanceKm,
    from[1] * setup.distanceKm,
    from[2] * setup.distanceKm,
  ];
  const down: V3 = [-from[0], -from[1], -from[2]];
  const north = toJ2000([0, 0, 1]);
  const right = unit(cross(down, north));
  const level = cross(right, down);
  // Pitched up by the tilt, about the camera's right axis, towards lunar north.
  const tilt = (setup.tiltDeg * Math.PI) / 180;
  const [c, s] = [Math.cos(tilt), Math.sin(tilt)];
  const forward: V3 = [
    c * down[0] + s * level[0],
    c * down[1] + s * level[1],
    c * down[2] + s * level[2],
  ];
  const up: V3 = [
    c * level[0] - s * down[0],
    c * level[1] - s * down[1],
    c * level[2] - s * down[2],
  ];
  const tanHalf = Math.tan((setup.fovDeg * Math.PI) / 360);
  const aspect = width / height;
  const sun = epoch.sunDirectionJ2000;

  const n = width * height;
  const fromBody = toBody(from);
  // The outline of a spheroid seen from latitude φ is an ellipse of semi-axes a and
  // sqrt(a² sin²φ + c² cos²φ).
  const sinPhi = fromBody[2];
  const out: MoonPixels = {
    width,
    height,
    hit: new Uint8Array(n),
    normal: new Float64Array(n * 3),
    solidAngle: new Float64Array(n),
    phaseAngleDeg: (Math.acos(Math.max(-1, Math.min(1, dot(from, sun)))) * 180) / Math.PI,
    projectedAreaKm2:
      Math.PI *
      radius *
      Math.sqrt(radius * radius * sinPhi * sinPhi + polar * polar * (1 - sinPhi * sinPhi)),
    lonDeg: new Float64Array(n),
    mu0: new Float64Array(n),
    mu: new Float64Array(n),
    cosG: new Float64Array(n),
    radiusKm: radius,
    sunDistanceKm: epoch.sunDistanceKm,
  };
  const cc = dot(camera, camera) - radius * radius;
  // Square pixels: (2 tan(fov/2) / height)² cos³θ, θ the ray's angle from the view axis.
  const pixelTan = (2 * tanHalf) / height;
  // On an ellipsoid the ray is met in the body frame, z stretched by a / c to make a sphere.
  const stretch = radius / polar;
  const cameraBody = toBody(camera);
  const sunBody = toBody(sun);
  for (let y = 0; y < height; y++) {
    const sy = (1 - ((y + 0.5) / height) * 2) * tanHalf;
    for (let x = 0; x < width; x++) {
      const sx = (((x + 0.5) / width) * 2 - 1) * tanHalf * aspect;
      const d = unit([
        forward[0] + sx * right[0] + sy * up[0],
        forward[1] + sx * right[1] + sy * up[1],
        forward[2] + sx * right[2] + sy * up[2],
      ]);
      out.solidAngle[y * width + x] = pixelTan * pixelTan * (1 / (1 + sx * sx + sy * sy)) ** 1.5;
      if (polar !== radius) {
        const db = toBody(d);
        const o: V3 = [cameraBody[0], cameraBody[1], cameraBody[2] * stretch];
        const v: V3 = [db[0], db[1], db[2] * stretch];
        const vv = dot(v, v);
        const bb = dot(o, v) / vv;
        const disc2 = bb * bb - (dot(o, o) - radius * radius) / vv;
        if (disc2 < 0) continue;
        const t = -bb - Math.sqrt(disc2);
        const pb: V3 = [
          cameraBody[0] + t * db[0],
          cameraBody[1] + t * db[1],
          cameraBody[2] + t * db[2],
        ];
        const nb = unit([
          pb[0] / (radius * radius),
          pb[1] / (radius * radius),
          pb[2] / (polar * polar),
        ]);
        const i = y * width + x;
        out.hit[i] = 1;
        out.normal.set(unit(pb), i * 3);
        out.lonDeg[i] = (Math.atan2(pb[1], pb[0]) * 180) / Math.PI;
        out.mu0[i] = dot(nb, sunBody);
        out.mu[i] = -dot(nb, db);
        out.cosG[i] = -dot(sun, d);
        continue;
      }
      const b = dot(camera, d);
      const disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      const p: V3 = [camera[0] + t * d[0], camera[1] + t * d[1], camera[2] + t * d[2]];
      const nrm: V3 = [p[0] / radius, p[1] / radius, p[2] / radius];
      const i = y * width + x;
      const body = toBody(nrm);
      out.hit[i] = 1;
      out.normal.set(body, i * 3);
      out.lonDeg[i] = (Math.atan2(body[1], body[0]) * 180) / Math.PI;
      out.mu0[i] = dot(nrm, sun);
      out.mu[i] = -dot(nrm, d);
      out.cosG[i] = -dot(sun, d);
    }
  }
  return out;
}

/** Pixels on the sphere with every pixel within `inset` (Chebyshev) also on it. */
export function interior(pixels: MoonPixels, inset: number): Uint8Array {
  const { width, height, hit } = pixels;
  const out = new Uint8Array(width * height);
  for (let y = inset; y < height - inset; y++) {
    for (let x = inset; x < width - inset; x++) {
      let all = 1;
      for (let dy = -inset; dy <= inset && all; dy++) {
        for (let dx = -inset; dx <= inset; dx++) {
          if (hit[(y + dy) * width + x + dx] === 0) {
            all = 0;
            break;
          }
        }
      }
      out[y * width + x] = all;
    }
  }
  return out;
}

/** Control positions for the seam check, in pixels along the row. */
const SEAM_CONTROL_OFFSETS = [-10, -6, 6, 10] as const;

const channel = (png: PNG, i: number, c: number): number => png.data[i * 4 + c] ?? 0;

/** The uniform Moon's scattering: the median tile (public/data/moon/hapke.json). */
const HAPKE_MANIFEST = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', 'public', 'data', 'moon', 'hapke.json'),
    'utf8',
  ),
) as { readonly median: HapkeParameters; readonly medianAtStandard: number };

/**
 * The 8-bit value core/hapke.ts predicts for a uniform Moon: `albedo` is its I/F at
 * the map's standard geometry (i = g = 60°, e = 0°), scattered with the median tile's parameters.
 */
export function predictedLevel(
  pixels: MoonPixels,
  i: number,
  albedo: number,
  model: 'hapke' | 'even' = 'hapke',
): number {
  const p = HAPKE_MANIFEST.median;
  const ratio = albedo / HAPKE_MANIFEST.medianAtStandard;
  const mu = pixels.mu[i] ?? 0;
  const radianceFactor =
    ratio *
    (model === 'even'
      ? hapke(mu, mu, 1, p) // lit from behind the viewer: i = e, g = 0
      : hapke(pixels.mu0[i] ?? 0, mu, pixels.cosG[i] ?? 1, p));
  return Math.round(linearToSrgb(displayValue(radianceFactor, pixels.sunDistanceKm)) * 255);
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

export function runMoonCheck(png: PNG, pixels: MoonPixels, check: BodyCheck): CheckResult {
  const n = pixels.width * pixels.height;
  switch (check.kind) {
    case 'photometry': {
      const inside = interior(pixels, check.limbInsetPx);
      let total = 0;
      let matching = 0;
      let worst = 0;
      for (let i = 0; i < n; i++) {
        if (inside[i] === 0) continue;
        total++;
        const expected = predictedLevel(pixels, i, check.albedo, check.model);
        let off = 0;
        for (let c = 0; c < 3; c++) off = Math.max(off, Math.abs(channel(png, i, c) - expected));
        worst = Math.max(worst, off);
        if (off <= check.tolerance) matching++;
      }
      const fraction = total === 0 ? 0 : matching / total;
      return {
        name: `${check.name}: ${total} disc pixels, worst ${worst} levels`,
        pass: total > 0 && fraction >= check.minFraction,
        fraction,
      };
    }
    case 'feature': {
      const inside = interior(pixels, 2);
      const lon = (check.lonDeg * Math.PI) / 180;
      const lat = (check.latDeg * Math.PI) / 180;
      const f: V3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
      const core: number[] = [];
      const ring: number[] = [];
      const lit: number[] = [];
      for (let i = 0; i < n; i++) {
        if (inside[i] === 0 || (pixels.mu0[i] ?? 0) <= 0) continue;
        const value = channel(png, i, 0);
        lit.push(value);
        const cos = Math.min(1, Math.max(-1, dot(pixels.normal.subarray(i * 3, i * 3 + 3), f)));
        const km = Math.acos(cos) * pixels.radiusKm;
        if (km < check.coreKm) core.push(value);
        else if (
          check.against !== 'disc-median' &&
          km >= check.against[0] &&
          km < check.against[1]
        ) {
          ring.push(value);
        }
      }
      const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
      const reference = check.against === 'disc-median' ? median(lit) : mean(ring);
      const enough = core.length >= 5 && (check.against === 'disc-median' || ring.length >= 5);
      const ratio = mean(core) / reference;
      const pass = enough && (check.expect === 'brighter' ? ratio > 1 : ratio < 1);
      return {
        name: `${check.name} ${check.expect} (${core.length} px): ratio ${enough ? ratio.toFixed(3) : 'not visible'}`,
        pass,
        fraction: pass ? 1 : 0,
      };
    }
    case 'disc-magnitude': {
      // The disc's luminance, CIE Y of the linear drawn colour (Johnson V follows it), as I/F:
      // display = EXPOSURE · I/F / r² (core/photometry.ts). Its mean over the disc's solid angle
      // is p Φ(α), and with the outline's area the V magnitude at 1 AU from the Sun and viewer.
      const r = pixels.sunDistanceKm / AU_KM;
      const linear = (v: number): number => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      let flux = 0;
      let omega = 0;
      for (let i = 0; i < n; i++) {
        if (pixels.hit[i] === 0) continue;
        const y =
          0.2126 * linear(channel(png, i, 0)) +
          0.7152 * linear(channel(png, i, 1)) +
          0.0722 * linear(channel(png, i, 2));
        const w = pixels.solidAngle[i] ?? 0;
        flux += ((y * r * r) / EXPOSURE) * w;
        omega += w;
      }
      const pPhi = flux / omega;
      const measured =
        SUN_V_MAGNITUDE -
        2.5 * Math.log10((pPhi * pixels.projectedAreaKm2) / (Math.PI * AU_KM * AU_KM));
      const expected = mallamaHiltonV(pixels.phaseAngleDeg);
      const off = measured - expected;
      const pass = omega > 0 && Math.abs(off) <= check.toleranceMag;
      return {
        name: `${check.name}: V(1, ${pixels.phaseAngleDeg.toFixed(1)}°) drawn ${measured.toFixed(3)}, Mallama & Hilton ${expected.toFixed(3)} (${off >= 0 ? '+' : ''}${off.toFixed(3)} mag)`,
        pass,
        fraction: pass ? 1 : 0,
      };
    }
    case 'night': {
      const inside = interior(pixels, 2);
      const limit = -Math.sin((check.minDepthDeg * Math.PI) / 180);
      let total = 0;
      let black = 0;
      for (let i = 0; i < n; i++) {
        if (inside[i] === 0 || (pixels.mu0[i] ?? 0) >= limit) continue;
        total++;
        if (Math.max(channel(png, i, 0), channel(png, i, 1), channel(png, i, 2)) === 0) black++;
      }
      const fraction = total === 0 ? 0 : black / total;
      return {
        name: `${check.name}: ${total} night pixels`,
        pass: total > 0 && fraction >= check.minFraction,
        fraction,
      };
    }
    case 'walls': {
      const inside = interior(pixels, 2);
      const lon = (check.lonDeg * Math.PI) / 180;
      const lat = (check.latDeg * Math.PI) / 180;
      const centre: V3 = [
        Math.cos(lat) * Math.cos(lon),
        Math.cos(lat) * Math.sin(lon),
        Math.sin(lat),
      ];
      const eastAxis: V3 = [-Math.sin(lon), Math.cos(lon), 0];
      const northAxis: V3 = [
        -Math.sin(lat) * Math.cos(lon),
        -Math.sin(lat) * Math.sin(lon),
        Math.cos(lat),
      ];
      const [r0, r1] = check.inner.map((f) => f * check.diameterKm);
      const west: number[] = [];
      const east: number[] = [];
      for (let i = 0; i < n; i++) {
        if (inside[i] === 0) continue;
        const p = pixels.normal.subarray(i * 3, i * 3 + 3);
        const km = Math.acos(Math.min(1, Math.max(-1, dot(p, centre)))) * pixels.radiusKm;
        if (km < (r0 ?? 0) || km >= (r1 ?? 0)) continue;
        const be = dot(p, eastAxis);
        const bn = dot(p, northAxis);
        if (Math.abs(bn) > Math.abs(be)) continue; // within 45° of due east or west
        (be < 0 ? west : east).push(channel(png, i, 0));
      }
      const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
      const enough = west.length >= 20 && east.length >= 20;
      const [lit, dark] =
        check.brighter === 'west' ? [mean(west), mean(east)] : [mean(east), mean(west)];
      const pass = enough && lit > dark;
      return {
        name: `${check.name}: ${check.brighter} wall ${lit.toFixed(1)} vs ${dark.toFixed(1)} (${west.length} / ${east.length} px)`,
        pass,
        fraction: pass ? 1 : 0,
      };
    }
    case 'seam': {
      // A seam is a run of two pixels (one 2x2 quad) pulled towards a coarse mip. For each
      // row the meridian crosses, d is how far the pair either side of it sits from the pair
      // around it: |(v[x] + v[x+1]) / 2 − (v[x−1] + v[x+2]) / 2|. Natural detail makes d
      // non-zero anywhere, so the same statistic is taken at control positions a few pixels
      // either side in the same rows. A seam shows as d at the meridian well above control.
      const inside = interior(pixels, 16);
      const { width, height } = pixels;
      const d = (i: number): number =>
        Math.abs(
          (channel(png, i, 0) + channel(png, i + 1, 0)) / 2 -
            (channel(png, i - 1, 0) + channel(png, i + 2, 0)) / 2,
        );
      let crossed = 0;
      let atSeam = 0;
      let control = 0;
      let controls = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 12; x < width - 12; x++) {
          const i = y * width + x;
          if (inside[i] === 0 || inside[i + 1] === 0) continue;
          if (Math.abs((pixels.lonDeg[i] ?? 0) - (pixels.lonDeg[i + 1] ?? 0)) < 180) continue;
          crossed++;
          atSeam += d(i);
          for (const offset of SEAM_CONTROL_OFFSETS) {
            control += d(i + offset);
            controls++;
          }
        }
      }
      const seam = atSeam / crossed;
      const reference = control / controls;
      const ratio = seam / reference;
      const pass = crossed > 0 && ratio <= check.maxRatio;
      return {
        name: `${check.name}: ${crossed} crossed rows, step at the meridian ${seam.toFixed(2)} vs ${reference.toFixed(2)} beside it (ratio ${ratio.toFixed(2)})`,
        pass,
        fraction: pass ? 1 : 0,
      };
    }
  }
}
