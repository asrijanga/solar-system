import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { compareImages, identicalPixels, TOLERANCE } from './compare.ts';

function solid(width: number, height: number, [r, g, b]: [number, number, number]): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  return png;
}

function paint(png: PNG, count: number, [r, g, b]: [number, number, number]): PNG {
  // Scatter isolated pixels so none of them look like anti-aliased edges.
  for (let n = 0; n < count; n++) {
    const x = (n * 7) % png.width;
    const y = Math.floor((n * 7) / png.width) * 3;
    const i = (y * png.width + x) * 4;
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
  }
  return png;
}

const CLEAR: [number, number, number] = [0x1b, 0x3a, 0x5c];

describe('compareImages', () => {
  it('passes identical images with zero differing pixels', () => {
    const result = compareImages(solid(64, 64, CLEAR), solid(64, 64, CLEAR));
    expect(result.pass).toBe(true);
    expect(result.differingPixels).toBe(0);
  });

  it('fails a whole-frame colour change, which is what a broken clear looks like', () => {
    const result = compareImages(solid(64, 64, CLEAR), solid(64, 64, [0, 0, 0]));
    expect(result.pass).toBe(false);
    expect(result.differingPixels).toBe(64 * 64);
  });

  it('passes a uniform one-level shift, below anything visible', () => {
    const result = compareImages(solid(64, 64, CLEAR), solid(64, 64, [0x1b, 0x3a, 0x5d]));
    expect(result.pass).toBe(true);
  });

  it('fails a visible uniform shift that pixelmatch alone lets through', () => {
    // Measured in SS-2: this pair flags 0 pixels in pixelmatch at threshold 0.1.
    const result = compareImages(solid(64, 64, CLEAR), solid(64, 64, [0x22, 0x46, 0x6e]));
    expect(result.differingPixels).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.reasons.join()).toMatch(/mean colour shifted/);
  });

  it('fails a two-level shift in a single channel', () => {
    const result = compareImages(solid(64, 64, CLEAR), solid(64, 64, [0x1b, 0x3a, 0x5e]));
    expect(result.pass).toBe(false);
  });

  it('passes a difference at the tolerance and fails one pixel beyond it', () => {
    const size = 1024;
    const allowed = Math.floor(size * size * TOLERANCE.maxDiffRatio);
    const at = compareImages(
      solid(size, size, CLEAR),
      paint(solid(size, size, CLEAR), allowed, [255, 255, 255]),
    );
    expect(at.differingPixels).toBe(allowed);
    expect(at.pass).toBe(true);
    const over = compareImages(
      solid(size, size, CLEAR),
      paint(solid(size, size, CLEAR), allowed + 1, [255, 255, 255]),
    );
    expect(over.pass).toBe(false);
  });

  it('fails on a size change without trying to diff', () => {
    const result = compareImages(solid(64, 64, CLEAR), solid(64, 32, CLEAR));
    expect(result.pass).toBe(false);
    expect(result.diff).toBeNull();
    expect(result.reasons.join()).toMatch(/size changed/);
  });
});

describe('identicalPixels', () => {
  it('distinguishes a single-channel, single-pixel change', () => {
    const a = solid(8, 8, CLEAR);
    const b = solid(8, 8, CLEAR);
    expect(identicalPixels(a, b)).toBe(true);
    b.data[0] = 0x1c;
    expect(identicalPixels(a, b)).toBe(false);
  });
});
