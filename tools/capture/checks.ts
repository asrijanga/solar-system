import type { PNG } from 'pngjs';
import type { PixelCheck, Viewpoint } from '../../src/capture/viewpoints.ts';

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

export interface ViewpointVerdict {
  readonly ok: boolean;
  readonly results: readonly CheckResult[];
  readonly message: string | null;
}

/**
 * A normal viewpoint is ok when every check passes. A negative control is ok only when at
 * least one check FAILS: if the fault it stages goes undetected, the check is worthless.
 */
export function judge(png: PNG, viewpoint: Viewpoint): ViewpointVerdict {
  const results = viewpoint.checks.map((check) => runCheck(png, check));
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
