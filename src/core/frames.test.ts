import { describe, expect, it } from 'vitest';
import { angularSeparationDeg, ICRF_TO_SCENE, raDecToScene } from './frames';

const det3 = (m: readonly number[]): number =>
  m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
  m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
  m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);

describe('ICRF to scene', () => {
  it('is a rotation, not a mirror: determinant +1', () => {
    expect(det3(ICRF_TO_SCENE)).toBe(1);
  });

  it('is orthonormal', () => {
    const m = ICRF_TO_SCENE;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const dot =
          m[i * 3]! * m[j * 3]! + m[i * 3 + 1]! * m[j * 3 + 1]! + m[i * 3 + 2]! * m[j * 3 + 2]!;
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 12);
      }
    }
  });

  it('sends the north celestial pole up, the equinox to +X and RA 6h to -Z', () => {
    const near = (v: number[], e: number[]): void =>
      v.forEach((c, i) => expect(c).toBeCloseTo(e[i]!, 12));
    near(raDecToScene(0, 90), [0, 1, 0]);
    near(raDecToScene(0, 0), [1, 0, 0]);
    near(raDecToScene(90, 0), [0, 0, -1]);
  });
});

describe('angularSeparationDeg', () => {
  it('measures right angles and tiny angles', () => {
    expect(angularSeparationDeg([1, 0, 0], [0, 1, 0])).toBeCloseTo(90, 12);
    const a = raDecToScene(10, 20);
    const b = raDecToScene(10, 20 + 1 / 3600);
    expect(angularSeparationDeg(a, b) * 3600).toBeCloseTo(1, 6);
  });
});
