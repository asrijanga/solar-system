import { describe, expect, it } from 'vitest';
import { finestLevelAt, minAltitudeKm, vertexSpacingKm, type TileRange } from './terrain';

const R = 1737.4;
const global = (level: number): TileRange[] => [
  { startX: 0, startY: 0, endX: 2 ** (level + 1) - 1, endY: 2 ** level - 1 },
];
// Levels 0-2 everywhere, level 3 in one tile: x 8 (0 to 22.5°E), y 3 (22.5°S to 0).
const available: TileRange[][] = [
  global(0),
  global(1),
  global(2),
  [{ startX: 8, startY: 3, endX: 8, endY: 3 }],
];

describe('vertexSpacingKm', () => {
  it('matches the pipeline: 2.665 km at level 5 and 41.6 m at level 11', () => {
    expect(vertexSpacingKm(5, R)).toBeCloseTo(2.6649, 3);
    expect(vertexSpacingKm(11, R) * 1000).toBeCloseTo(41.64, 1);
  });
});

describe('finestLevelAt', () => {
  it('finds the deepest covering level, with TMS rows counted from the south', () => {
    expect(finestLevelAt(available, 4, -11)).toBe(3);
    // The same longitude in the north is row 4, not covered at level 3.
    expect(finestLevelAt(available, 4, 11)).toBe(2);
    expect(finestLevelAt(available, -4, -11)).toBe(2);
  });

  it('wraps longitude and keeps the east and north edges inside the grid', () => {
    expect(finestLevelAt(available, 364, -11)).toBe(3);
    expect(finestLevelAt(available, 180, 90)).toBe(2);
  });

  it('is -1 where nothing covers the point', () => {
    expect(finestLevelAt([], 0, 0)).toBe(-1);
  });
});

describe('minAltitudeKm', () => {
  it('lets the camera closer where finer data was measured', () => {
    const fine = minAltitudeKm(available, 4, -11, R, 50);
    const coarse = minAltitudeKm(available, -4, -11, R, 50);
    expect(coarse / fine).toBeCloseTo(2, 10);
    // 40 spacings of level 3 (10.66 km) across 2 tan 25° of view.
    expect(fine).toBeCloseTo(
      (40 * vertexSpacingKm(3, R)) / (2 * Math.tan((25 * Math.PI) / 180)),
      10,
    );
  });
});
