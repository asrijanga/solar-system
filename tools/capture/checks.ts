import type { PNG } from 'pngjs';
import type {
  PixelCheck,
  SkyPointing,
  StarCheck,
  Viewpoint,
} from '../../src/capture/viewpoints.ts';
import { castMoonRays, runMoonCheck, type EphemerisFile } from './moon.ts';

export interface CheckResult {
  readonly name: string;
  readonly pass: boolean;
  /** Fraction of the region within tolerance of the expected colour. */
  readonly fraction: number;
}

export function runCheck(png: PNG, check: PixelCheck): CheckResult {
  const { x, y, width, height } = check.region;
  if (x < 0 || y < 0 || x + width > png.width || y + height > png.height || width * height === 0) {
    throw new Error(
      `check "${check.name}" region lies outside the ${png.width}x${png.height} capture`,
    );
  }
  const [r, g, b] = check.colour;
  let matching = 0;
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) {
      const i = (row * png.width + col) * 4;
      if (
        Math.abs((png.data[i] ?? 0) - r) <= check.tolerance &&
        Math.abs((png.data[i + 1] ?? 0) - g) <= check.tolerance &&
        Math.abs((png.data[i + 2] ?? 0) - b) <= check.tolerance
      ) {
        matching++;
      }
    }
  }
  const fraction = matching / (width * height);
  return { name: check.name, pass: fraction >= check.minFraction, fraction };
}

/**
 * Where a star should appear, by the standard gnomonic (tangent-plane) projection of the sky
 * seen from inside the celestial sphere: north up, east to the LEFT. Deliberately independent
 * of the app's axis mapping and of three.js, so the two can only agree if both are right.
 * Returns pixel-centre coordinates, or null for a star behind the camera.
 */
export function projectStar(
  sky: SkyPointing,
  width: number,
  height: number,
  raDeg: number,
  decDeg: number,
): { x: number; y: number } | null {
  const rad = Math.PI / 180;
  const a0 = sky.raDeg * rad;
  const d0 = sky.decDeg * rad;
  const a = raDeg * rad;
  const d = decDeg * rad;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  if (cosc <= 0) return null;
  const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc;
  const focal = height / 2 / Math.tan((sky.fovDeg / 2) * rad);
  // Pixel (i, j) covers [i, i+1); the image centre is the corner between the middle pixels.
  return { x: width / 2 - xi * focal - 0.5, y: height / 2 - eta * focal - 0.5 };
}

/** Brightest pixel (max channel) within a square window, and where it is. */
export function findPeak(
  png: PNG,
  cx: number,
  cy: number,
  radius: number,
): { x: number; y: number; value: number } {
  let best = { x: Math.round(cx), y: Math.round(cy), value: -1 };
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(png.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(png.height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * png.width + x) * 4;
      const value = Math.max(png.data[i] ?? 0, png.data[i + 1] ?? 0, png.data[i + 2] ?? 0);
      if (value > best.value) best = { x, y, value };
    }
  }
  return best;
}

export function runStarCheck(png: PNG, sky: SkyPointing, check: StarCheck): CheckResult {
  const expected = projectStar(sky, png.width, png.height, check.raDeg, check.decDeg);
  if (expected === null) return { name: check.name, pass: false, fraction: 0 };
  // Search twice the allowed offset, so a star just outside it is found and reported as off.
  const peak = findPeak(png, expected.x, expected.y, check.maxOffsetPx * 2);
  const offset = Math.hypot(peak.x - expected.x, peak.y - expected.y);
  const pass = peak.value >= check.minPeak && offset <= check.maxOffsetPx;
  return {
    name: `${check.name} at (${expected.x.toFixed(1)}, ${expected.y.toFixed(1)}): peak ${peak.value} at ${offset.toFixed(1)} px`,
    pass,
    fraction: pass ? 1 : 0,
  };
}

export interface ViewpointVerdict {
  readonly ok: boolean;
  readonly results: readonly CheckResult[];
  readonly message: string | null;
}

/**
 * A normal viewpoint is ok when every check passes. A negative control is ok only when at
 * least one check FAILS: if the fault it stages goes undetected, the check is worthless.
 */
export function judge(
  png: PNG,
  viewpoint: Viewpoint,
  ephemeris: EphemerisFile | null = null,
): ViewpointVerdict {
  const moonResults: CheckResult[] = [];
  if (viewpoint.moonChecks.length > 0) {
    if (viewpoint.moon === null || ephemeris === null) {
      throw new Error(`${viewpoint.id} has Moon checks but no Moon setup or ephemeris`);
    }
    const pixels = castMoonRays(viewpoint.moon, ephemeris, png.width, png.height);
    for (const check of viewpoint.moonChecks) moonResults.push(runMoonCheck(png, pixels, check));
  }
  const results = [
    ...viewpoint.checks.map((check) => runCheck(png, check)),
    ...viewpoint.starChecks.map((check) => {
      if (viewpoint.sky === null) throw new Error(`${viewpoint.id} has star checks but no sky`);
      return runStarCheck(png, viewpoint.sky, check);
    }),
    ...moonResults,
  ];
  if (viewpoint.negativeControl) {
    if (results.length === 0) {
      return { ok: false, results, message: 'negative control has no checks to fail' };
    }
    const detected = results.some((r) => !r.pass);
    return {
      ok: detected,
      results,
      message: detected ? null : 'negative control passed its checks: they cannot detect the fault',
    };
  }
  const failed = results.filter((r) => !r.pass);
  return {
    ok: failed.length === 0,
    results,
    message: failed.length === 0 ? null : `failed: ${failed.map((r) => r.name).join(', ')}`,
  };
}
