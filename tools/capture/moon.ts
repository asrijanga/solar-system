// What a Moon capture must show, predicted pixel by pixel without the app's code paths.
//
// The camera is rebuilt from the viewpoint's Moon setup and ephemeris.json, in J2000, with
// no scene axes and no three.js. A ray through each pixel centre meets the true sphere, and
// the hit gives that pixel's longitude, latitude, μ0 and μ. The shading formula is the one
// the app's TSL must mirror: core/photometry.ts, which is unit-tested on its own.
import type { PNG } from 'pngjs';
import type { MoonCheck, MoonSetup } from '../../src/capture/viewpoints.ts';
import { displayValue, linearToSrgb, lommelSeeliger } from '../../src/core/photometry.ts';
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
  /** Body-fixed unit normal at the hit, 3 per pixel. */
  readonly normal: Float64Array;
  readonly lonDeg: Float64Array;
  readonly mu0: Float64Array;
  readonly mu: Float64Array;
  readonly radiusKm: number;
  readonly sunDistanceKm: number;
}

export function castMoonRays(
  setup: MoonSetup,
  ephemeris: EphemerisFile,
  width: number,
  height: number,
): MoonPixels {
  const epoch = ephemeris.epochs.find((e) => e.id === setup.epoch);
  if (epoch === undefined) throw new Error(`ephemeris.json has no epoch ${setup.epoch}`);
  const radius = ephemeris.body.radiiKm[0] ?? Number.NaN;
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
  const forward: V3 = [-from[0], -from[1], -from[2]];
  const north = toJ2000([0, 0, 1]);
  const right = unit(cross(forward, north));
  const up = cross(right, forward);
  const tanHalf = Math.tan((setup.fovDeg * Math.PI) / 360);
  const aspect = width / height;
  const sun = epoch.sunDirectionJ2000;

  const n = width * height;
  const out: MoonPixels = {
    width,
    height,
    hit: new Uint8Array(n),
    normal: new Float64Array(n * 3),
    lonDeg: new Float64Array(n),
    mu0: new Float64Array(n),
    mu: new Float64Array(n),
    radiusKm: radius,
    sunDistanceKm: epoch.sunDistanceKm,
  };
  const cc = dot(camera, camera) - radius * radius;
  for (let y = 0; y < height; y++) {
    const sy = (1 - ((y + 0.5) / height) * 2) * tanHalf;
    for (let x = 0; x < width; x++) {
      const sx = (((x + 0.5) / width) * 2 - 1) * tanHalf * aspect;
      const d = unit([
        forward[0] + sx * right[0] + sy * up[0],
        forward[1] + sx * right[1] + sy * up[1],
        forward[2] + sx * right[2] + sy * up[2],
      ]);
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

/** The 8-bit value core/photometry.ts predicts for a uniform Lommel–Seeliger Moon. */
export function predictedLevel(pixels: MoonPixels, i: number, albedo: number): number {
  const ls = lommelSeeliger(albedo, pixels.mu0[i] ?? 0, pixels.mu[i] ?? 0);
  return Math.round(linearToSrgb(displayValue(ls, pixels.sunDistanceKm)) * 255);
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

export function runMoonCheck(png: PNG, pixels: MoonPixels, check: MoonCheck): CheckResult {
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
        const expected = predictedLevel(pixels, i, check.albedo);
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
