import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bodyFixedToJ2000,
  bodyFixedToSceneMatrix,
  findEpoch,
  lonLatToBodyFixed,
  moonViewPose,
  type MoonEphemeris,
  type Vec3,
} from './moon';

const root = join(import.meta.dirname, '..', '..');
const ephemeris = JSON.parse(
  readFileSync(join(root, 'public/data/moon/ephemeris.json'), 'utf8'),
) as MoonEphemeris & {
  epochs: (MoonEphemeris['epochs'][number] & {
    subSolarFromEarth: { lonDeg: number; latDeg: number };
  })[];
};
const gazetteer = JSON.parse(
  readFileSync(join(root, 'test/fixtures/iau-gazetteer-moon.json'), 'utf8'),
) as { features: { name: string; lonDeg: number; latDeg: number }[] };

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lonLatOf = (v: Vec3): [number, number] => [
  (Math.atan2(v[1], v[0]) * 180) / Math.PI,
  (Math.asin(v[2]) * 180) / Math.PI,
];
const feature = (name: string): [number, number] => {
  const f = gazetteer.features.find((x) => x.name === name);
  if (f === undefined) throw new Error(name);
  return [f.lonDeg, f.latDeg]; // -180 to 180 east, as the body frame
};

describe('Moon body frame', () => {
  for (const epoch of ephemeris.epochs) {
    it(`${epoch.id}: model matrix is a rotation (determinant +1, orthonormal)`, () => {
      const m = bodyFixedToSceneMatrix(epoch);
      const det =
        m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
        m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
        m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
      expect(det).toBeCloseTo(1, 12);
      for (let i = 0; i < 3; i++) {
        const column: Vec3 = [m[i]!, m[3 + i]!, m[6 + i]!];
        expect(dot(column, column)).toBeCloseTo(1, 12);
      }
    });

    it(`${epoch.id}: the sun in the body frame lands on the manifest's sub-solar point`, () => {
      // Transposing Mᵀ back gives M · sun. Only the direction from the Moon's centre is used
      // here; the manifest's point is SPICE's surface intercept, which agrees to far better
      // than a degree at the Sun's distance.
      const m = epoch.j2000ToBodyFixed;
      const s = epoch.sunDirectionJ2000;
      const body: Vec3 = [dot(m[0], s), dot(m[1], s), dot(m[2], s)];
      const [lon, lat] = lonLatOf(body);
      const expected = epoch.subSolarFromEarth;
      expect(Math.abs(lon - expected.lonDeg)).toBeLessThan(0.1);
      expect(Math.abs(lat - expected.latDeg)).toBeLessThan(0.1);
    });

    it(`${epoch.id}: Earth stays within libration of longitude 0, latitude 0`, () => {
      const m = epoch.j2000ToBodyFixed;
      const e = epoch.earthDirectionJ2000;
      const [lon, lat] = lonLatOf([dot(m[0], e), dot(m[1], e), dot(m[2], e)]);
      expect(Math.abs(lon)).toBeLessThan(8.2);
      expect(Math.abs(lat)).toBeLessThan(6.9);
    });
  }
});

describe('seen from Earth with lunar north up', () => {
  const epoch = findEpoch(ephemeris, 'full-2026-01');
  const pose = moonViewPose(epoch, { kind: 'earth' }, 10_000);
  // Screen axes in J2000, built from the pose the way a camera builds them: forward from the
  // camera to the Moon's centre, right = forward × up.
  const forwardScene: Vec3 = [-pose.position[0], -pose.position[1], -pose.position[2]];
  const right = cross(forwardScene, pose.up);
  const screen = (name: string): { x: number; y: number } => {
    const [lon, lat] = feature(name);
    const j = bodyFixedToJ2000(epoch, lonLatToBodyFixed(lon, lat));
    // Scene = S · j2000, a rotation, so dot products can be taken in the scene frame.
    const p: Vec3 = [j[0], j[2], -j[1]];
    return { x: dot(p, right), y: dot(p, pose.up) };
  };

  it('puts Mare Crisium near the right-hand limb', () => {
    expect(screen('Mare Crisium').x).toBeGreaterThan(0.1);
  });

  it('puts Tycho in the south, and Aristarchus in the north-west', () => {
    expect(screen('Tycho').y).toBeLessThan(-0.5);
    const a = screen('Aristarchus');
    expect(a.x).toBeLessThan(0);
    expect(a.y).toBeGreaterThan(0);
  });
});
