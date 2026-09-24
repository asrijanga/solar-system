import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface Tolerance {
  readonly threshold: number;
  readonly maxDiffRatio: number;
  readonly maxMeanChannelDelta: number;
}

/**
 * How different a capture may be from its baseline and still pass. Two independent checks,
 * because each is blind to what the other catches. Changing any number needs the owner's
 * approval in the PR description (CLAUDE.md, "Never tune a check to pass").
 */
export const TOLERANCE: Tolerance = {
  /**
   * Local differences. Per-pixel colour distance in pixelmatch's perceptual YIQ space,
   * 0 to 1 (its default). Pixels it classifies as anti-aliasing never count as differing.
   */
  threshold: 0.1,
  /**
   * Fraction of pixels allowed to differ locally: 0.05%, about 520 pixels of a 1024 x 1024
   * capture. Room for rasteriser noise; a mirrored map or misplaced feature changes far more.
   */
  maxDiffRatio: 0.0005,
  /**
   * Global differences. The mean absolute difference per RGB channel over the whole image,
   * in 8-bit units. pixelmatch's threshold lets a uniform shift pass (SS-2 measured #1b3a5c
   * against #22466e: 0 pixels flagged), and a uniform shift is exactly what an exposure or
   * radiometry bug looks like. 0.5 fails any uniform shift of 2 or more levels in one channel.
   */
  maxMeanChannelDelta: 0.5,
};

export interface Comparison {
  readonly pass: boolean;
  readonly differingPixels: number;
  readonly totalPixels: number;
  readonly ratio: number;
  /** Mean absolute RGB channel difference over all pixels, in 8-bit units. */
  readonly meanChannelDelta: number;
  /** Differing pixels in red over a faded copy of the baseline. null when sizes differ. */
  readonly diff: PNG | null;
  readonly reasons: readonly string[];
}

function meanChannelDelta(a: PNG, b: PNG): number {
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = i; c < i + 3; c++) sum += Math.abs((a.data[c] ?? 0) - (b.data[c] ?? 0));
  }
  return sum / ((a.data.length / 4) * 3);
}

export function compareImages(
  baseline: PNG,
  capture: PNG,
  tolerance: Tolerance = TOLERANCE,
): Comparison {
  const totalPixels = baseline.width * baseline.height;
  if (baseline.width !== capture.width || baseline.height !== capture.height) {
    return {
      pass: false,
      differingPixels: totalPixels,
      totalPixels,
      ratio: 1,
      meanChannelDelta: Number.NaN,
      diff: null,
      reasons: [
        `size changed: baseline ${baseline.width}x${baseline.height}, capture ${capture.width}x${capture.height}`,
      ],
    };
  }
  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const differingPixels = pixelmatch(
    baseline.data,
    capture.data,
    diff.data,
    baseline.width,
    baseline.height,
    { threshold: tolerance.threshold },
  );
  const ratio = differingPixels / totalPixels;
  const mean = meanChannelDelta(baseline, capture);

  const reasons: string[] = [];
  if (ratio > tolerance.maxDiffRatio) {
    reasons.push(
      `${differingPixels} pixels differ (${(ratio * 100).toFixed(3)}%), over the ${(tolerance.maxDiffRatio * 100).toFixed(3)}% tolerance`,
    );
  }
  if (mean > tolerance.maxMeanChannelDelta) {
    reasons.push(
      `mean colour shifted by ${mean.toFixed(2)} levels per channel, over the ${tolerance.maxMeanChannelDelta} tolerance`,
    );
  }
  return {
    pass: reasons.length === 0,
    differingPixels,
    totalPixels,
    ratio,
    meanChannelDelta: mean,
    diff,
    reasons,
  };
}

/** Exact equality of decoded pixels, for the determinism check. */
export function identicalPixels(a: PNG, b: PNG): boolean {
  return a.width === b.width && a.height === b.height && a.data.equals(b.data);
}
