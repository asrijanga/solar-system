import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { PixelCheck, Viewpoint } from '../../src/capture/viewpoints.ts';
import { findPeak, judge, projectStar, runCheck } from './checks.ts';

const RED = [0xd0, 0x40, 0x40] as const;
const BLUE = [0x40, 0xa0, 0xd0] as const;

function image(size: number, fill: readonly number[], redStripeEvery = 0): PNG {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = redStripeEvery > 0 && y % redStripeEvery === 0 ? RED : fill;
      const i = (y * size + x) * 4;
      png.data[i] = c[0] ?? 0;
      png.data[i + 1] = c[1] ?? 0;
      png.data[i + 2] = c[2] ?? 0;
      png.data[i + 3] = 255;
    }
  }
  return png;
}

const check: PixelCheck = {
  name: 'red wins',
  region: { x: 2, y: 2, width: 4, height: 4 },
  colour: RED,
  tolerance: 2,
  minFraction: 0.999,
};

const viewpoint = (negativeControl: boolean, checks = [check]): Viewpoint => ({
  id: 'test',
  description: '',
  scene: 'empty',
  width: 8,
  height: 8,
  epoch: null,
  camera: null,
  reversedDepthBuffer: true,
  background: 'scaffold',
  sky: null,
  checks,
  starChecks: [],
  negativeControl,
});

describe('runCheck', () => {
  it('passes a region entirely of the expected colour', () => {
    expect(runCheck(image(8, RED), check)).toEqual({ name: 'red wins', pass: true, fraction: 1 });
  });

  it('fails a region of z-fighting stripes', () => {
    const result = runCheck(image(8, BLUE, 2), check);
    expect(result.pass).toBe(false);
    expect(result.fraction).toBe(0.5);
  });

  it('refuses a region outside the image rather than checking nothing', () => {
    expect(() => runCheck(image(4, RED), check)).toThrow(/outside/);
  });
});

describe('judge', () => {
  it('fails a normal viewpoint whose check fails', () => {
    expect(judge(image(8, BLUE), viewpoint(false)).ok).toBe(false);
  });

  it('accepts a negative control whose check fails', () => {
    expect(judge(image(8, BLUE), viewpoint(true)).ok).toBe(true);
  });

  it('rejects a negative control whose check passes: the check cannot see the fault', () => {
    const verdict = judge(image(8, RED), viewpoint(true));
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/cannot detect/);
  });

  it('rejects a negative control with no checks', () => {
    expect(judge(image(8, RED), viewpoint(true, [])).ok).toBe(false);
  });
});

describe('projectStar (gnomonic, north up, east left)', () => {
  const sky = { raDeg: 83.8, decDeg: -1, fovDeg: 40 };

  it('puts the pointing at the image centre', () => {
    expect(projectStar(sky, 1024, 1024, 83.8, -1)).toEqual({ x: 511.5, y: 511.5 });
  });

  it('puts a star east of centre (larger RA) on the left, and north of centre above', () => {
    const east = projectStar(sky, 1024, 1024, 88.8, -1)!;
    const north = projectStar(sky, 1024, 1024, 83.8, 4)!;
    expect(east.x).toBeLessThan(511.5);
    expect(north.y).toBeLessThan(511.5);
  });

  it('puts a star at the top edge of a 40° field 20° north of centre', () => {
    const top = projectStar({ raDeg: 0, decDeg: 0, fovDeg: 40 }, 1024, 1024, 0, 20)!;
    expect(top.y).toBeCloseTo(-0.5, 6);
  });

  it('rejects a star behind the camera', () => {
    expect(projectStar(sky, 1024, 1024, 83.8 + 180, 1)).toBeNull();
  });
});

describe('findPeak', () => {
  it('finds the brightest pixel in the window', () => {
    const png = image(8, BLUE);
    const i = (5 * 8 + 6) * 4;
    png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
    expect(findPeak(png, 5, 5, 2)).toEqual({ x: 6, y: 5, value: 255 });
  });
});
