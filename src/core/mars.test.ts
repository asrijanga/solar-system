import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Mat3Rows, Vec3 } from './moon';
import {
  marsEpoch,
  marsEpochAt,
  marsRotation,
  type MarsEphemeris,
  type MarsTimelineManifest,
} from './mars';

const data = (path: string): string => join(import.meta.dirname, '../../', path);
const MANIFEST = JSON.parse(
  readFileSync(data('public/data/mars/timeline.json'), 'utf8'),
) as MarsTimelineManifest;
const bytes = readFileSync(data('public/data/mars/timeline.bin'));
const SAMPLES = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
interface Truth {
  readonly utc: string;
  readonly tdbSecondsPastJ2000: number;
  readonly sunDirectionJ2000: Vec3;
  readonly sunDistanceKm: number;
  readonly earthDirectionJ2000: Vec3;
  readonly earthDistanceKm: number;
  readonly solarLongitudeLsDeg: number;
  readonly phaseAngleDeg: number;
  readonly j2000ToBodyFixed: Mat3Rows;
}
const TRUTHS = (
  JSON.parse(readFileSync(data('test/fixtures/mars-timeline-truth.json'), 'utf8')) as {
    moments: Truth[];
  }
).moments;
const EPHEMERIS = JSON.parse(
  readFileSync(data('public/data/mars/ephemeris.json'), 'utf8'),
) as MarsEphemeris;

const angleDeg = (a: Vec3, b: Vec3): number => {
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};
const worstAxisDeg = (a: Mat3Rows, b: Mat3Rows): number =>
  Math.max(angleDeg(a[0], b[0]), angleDeg(a[1], b[1]), angleDeg(a[2], b[2]));

// The pipeline measured 2.3e-6 deg (directions) and 18 km (Earth's distance, float32 at
// 1e8 km) as the worst over 2000 moments: the Moon's tolerances hold with room.
const DIRECTION_DEG = 0.002;
const DISTANCE_KM = 50;
// Mars turns 0.0042 deg per second; the app's clock-to-TDB step is exact to the TDB-TT term,
// under 2 ms. The rotation itself is evaluated, not interpolated.
const TURN_DEG = 0.001;

describe('Mars at any moment (timeline)', () => {
  it('matches SPICE at moments between samples, rotation included', () => {
    expect(TRUTHS.length).toBeGreaterThan(20);
    for (const t of TRUTHS) {
      const e = marsEpochAt(MANIFEST, SAMPLES, Date.parse(t.utc));
      expect(e, t.utc).not.toBeNull();
      if (e === null) continue;
      expect(angleDeg(e.sunDirectionJ2000, t.sunDirectionJ2000), t.utc).toBeLessThan(DIRECTION_DEG);
      expect(angleDeg(e.earthDirectionJ2000, t.earthDirectionJ2000), t.utc).toBeLessThan(
        DIRECTION_DEG,
      );
      expect(Math.abs(e.sunDistanceKm - t.sunDistanceKm), t.utc).toBeLessThan(DISTANCE_KM);
      expect(Math.abs(e.earthDistanceKm - t.earthDistanceKm), t.utc).toBeLessThan(DISTANCE_KM);
      // The angle at Mars between the Sun and Earth as Mars's own light-time-corrected vectors
      // give it. SPICE's phaseq corrects for the observer, Earth, instead, and differs by up to
      // 0.005 deg; both are recorded in the fixture.
      const phase = angleDeg(t.sunDirectionJ2000, t.earthDirectionJ2000);
      expect(Math.abs(e.phaseAngleDeg - phase), t.utc).toBeLessThan(DIRECTION_DEG);
      expect(Math.abs(e.phaseAngleDeg - t.phaseAngleDeg), t.utc).toBeLessThan(0.01);
      const dLs = Math.abs(((e.solarLongitudeLsDeg - t.solarLongitudeLsDeg + 540) % 360) - 180);
      expect(dLs, t.utc).toBeLessThan(DIRECTION_DEG);
      expect(worstAxisDeg(e.j2000ToBodyFixed, t.j2000ToBodyFixed), t.utc).toBeLessThan(TURN_DEG);
    }
  });

  it('evaluates IAU_MARS exactly as SPICE does at the fixed epochs', () => {
    for (const e of EPHEMERIS.epochs) {
      const r = marsRotation(MANIFEST.rotation, e.tdbSecondsPastJ2000);
      // 1e-5 deg is 0.6 m on Mars's surface; measured 1.2e-6.
      expect(worstAxisDeg(r, e.j2000ToBodyFixed), e.id).toBeLessThan(1e-5);
    }
  });

  it('is null outside the span', () => {
    expect(marsEpochAt(MANIFEST, SAMPLES, Date.parse('2025-06-01T00:00:00Z'))).toBeNull();
    expect(marsEpochAt(MANIFEST, SAMPLES, Date.parse('2031-06-01T00:00:00Z'))).toBeNull();
  });

  it('gives the fixed epochs their phase angle', () => {
    const e = marsEpoch(EPHEMERIS, 'first-quarter-2026-01');
    expect(e.phaseAngleDeg).toBeGreaterThan(0);
    expect(e.phaseAngleDeg).toBeLessThan(48);
  });
});
