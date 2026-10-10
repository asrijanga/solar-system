import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { marsRotation, type MarsRotation } from './mars';
import type { Mat3Rows, Vec3 } from './moon';
import { mercuryEpochAt, type MercuryTimelineManifest } from './mercury';

// Mercury's IAU rotation (pck00011, public/data/mercury/ephemeris.json, SS-16 W2) is evaluated by
// the same code as Mars's: the app will turn Mercury from these constants at any moment, so they
// must reproduce SPICE's pxform at the epochs it wrote.
const EPHEMERIS = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../public/data/mercury/ephemeris.json'), 'utf8'),
) as {
  body: { rotation: MarsRotation };
  epochs: { id: string; tdbSecondsPastJ2000: number; j2000ToBodyFixed: Mat3Rows }[];
};

describe("Mercury's rotation", () => {
  it.each(EPHEMERIS.epochs.map((e) => [e.id, e] as const))(
    'matches SPICE at %s to 1e-9',
    (_, epoch) => {
      const m = marsRotation(EPHEMERIS.body.rotation, epoch.tdbSecondsPastJ2000);
      m.forEach((row, r) =>
        row.forEach((value, c) =>
          expect(Math.abs(value - (epoch.j2000ToBodyFixed[r]?.[c] ?? NaN))).toBeLessThan(1e-9),
        ),
      );
    },
  );
});

// The timeline (docs/stories/SS-16.md, W7): the app's interpolation against SPICE at moments
// between samples. The pipeline measured 1.8e-5 deg (directions) and 20 km (Earth's distance) as
// the worst over 2000 moments: Mars's tolerances hold with room.
describe('Mercury at any moment (timeline)', () => {
  const read = (path: string): string =>
    readFileSync(join(import.meta.dirname, '../..', path), 'utf8');
  const manifest = JSON.parse(read('public/data/mercury/timeline.json')) as MercuryTimelineManifest;
  const bytes = readFileSync(join(import.meta.dirname, '../../public/data/mercury/timeline.bin'));
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const truths = (
    JSON.parse(read('test/fixtures/mercury-timeline-truth.json')) as {
      moments: {
        utc: string;
        sunDirectionJ2000: Vec3;
        sunDistanceKm: number;
        earthDirectionJ2000: Vec3;
        earthDistanceKm: number;
        phaseAngleDeg: number;
        j2000ToBodyFixed: Mat3Rows;
      }[];
    }
  ).moments;
  const angleDeg = (a: Vec3, b: Vec3): number =>
    (Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)),
        ),
      ),
    ) *
      180) /
    Math.PI;

  it('matches SPICE at moments between samples, rotation included', () => {
    expect(truths.length).toBeGreaterThan(20);
    for (const t of truths) {
      const e = mercuryEpochAt(manifest, samples, Date.parse(t.utc));
      expect(e, t.utc).not.toBeNull();
      if (e === null) continue;
      expect(angleDeg(e.sunDirectionJ2000, t.sunDirectionJ2000), t.utc).toBeLessThan(0.002);
      expect(angleDeg(e.earthDirectionJ2000, t.earthDirectionJ2000), t.utc).toBeLessThan(0.002);
      expect(Math.abs(e.sunDistanceKm - t.sunDistanceKm), t.utc).toBeLessThan(50);
      expect(Math.abs(e.earthDistanceKm - t.earthDistanceKm), t.utc).toBeLessThan(50);
      // The angle between Mercury's own light-time-corrected vectors (as for Mars).
      expect(
        Math.abs(e.phaseAngleDeg - angleDeg(t.sunDirectionJ2000, t.earthDirectionJ2000)),
        t.utc,
      ).toBeLessThan(0.002);
      for (let r = 0; r < 3; r++) {
        const got = e.j2000ToBodyFixed[r] as Vec3;
        const want = t.j2000ToBodyFixed[r] as Vec3;
        expect(angleDeg(got, want), t.utc).toBeLessThan(0.001);
      }
    }
  });

  it('is null outside its span', () => {
    expect(mercuryEpochAt(manifest, samples, Date.parse('2040-01-01T00:00:00Z'))).toBeNull();
  });
});
