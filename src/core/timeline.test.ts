import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Mat3Rows, MoonEphemeris, Vec3 } from './moon';
import { epochAt, iauRotation, type TimelineManifest } from './timeline';

const data = (path: string): string => join(import.meta.dirname, '../../', path);
const MANIFEST = JSON.parse(
  readFileSync(data('public/data/moon/timeline.json'), 'utf8'),
) as TimelineManifest;
const bytes = readFileSync(data('public/data/moon/timeline.bin'));
const SAMPLES = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
interface Truth {
  readonly utc: string;
  readonly tdbSecondsPastJ2000: number;
  readonly sunDirectionJ2000: Vec3;
  readonly sunDistanceKm: number;
  readonly earthDirectionJ2000: Vec3;
  readonly earthDistanceKm: number;
  readonly j2000ToBodyFixed: Mat3Rows;
  readonly earthSunDistanceKm: number;
  readonly phaseAngleDeg: number;
  readonly j2000ToEarthFixed: Mat3Rows;
}
const TRUTHS = (
  JSON.parse(readFileSync(data('test/fixtures/moon-timeline-truth.json'), 'utf8')) as {
    moments: Truth[];
  }
).moments;
const EPHEMERIS = JSON.parse(
  readFileSync(data('public/data/moon/ephemeris.json'), 'utf8'),
) as MoonEphemeris & {
  epochs: (MoonEphemeris['epochs'][number] & { tdbSecondsPastJ2000: number })[];
};

const angleDeg = (a: Vec3, b: Vec3): number => {
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};
const worstAxisDeg = (a: Mat3Rows, b: Mat3Rows): number =>
  Math.max(angleDeg(a[0], b[0]), angleDeg(a[1], b[1]), angleDeg(a[2], b[2]));

// The pipeline measured 3.4e-4 deg (Earth's direction) as the worst over 2000 moments; these
// tolerances are a few times that, and far below a pixel. Distances: 0.34 km measured.
const DIRECTION_DEG = 0.002;
const DISTANCE_KM = 1;
// Earth's turn uses the app's clock-to-TDB step (no leap second, TDB-TT ignored: under 2 ms).
const EARTH_TURN_DEG = 0.001;

describe('the Moon at any moment (timeline)', () => {
  it('matches SPICE at moments between samples', () => {
    expect(TRUTHS.length).toBeGreaterThan(20);
    for (const t of TRUTHS) {
      const e = epochAt(MANIFEST, SAMPLES, Date.parse(t.utc));
      expect(e, t.utc).not.toBeNull();
      if (e === null) continue;
      expect(angleDeg(e.sunDirectionJ2000, t.sunDirectionJ2000), t.utc).toBeLessThan(DIRECTION_DEG);
      expect(angleDeg(e.earthDirectionJ2000, t.earthDirectionJ2000), t.utc).toBeLessThan(
        DIRECTION_DEG,
      );
      expect(Math.abs(e.earthDistanceKm - t.earthDistanceKm), t.utc).toBeLessThan(DISTANCE_KM);
      // float32 at 1.5e8 km is about 10 km; the Sun's distance only scales brightness.
      expect(Math.abs(e.sunDistanceKm / t.sunDistanceKm - 1), t.utc).toBeLessThan(1e-6);
      expect(Math.abs(e.earthSunDistanceKm / t.earthSunDistanceKm - 1), t.utc).toBeLessThan(1e-6);
      expect(worstAxisDeg(e.j2000ToBodyFixed, t.j2000ToBodyFixed), t.utc).toBeLessThan(
        DIRECTION_DEG,
      );
      expect(Math.abs(e.phaseAngleDeg - t.phaseAngleDeg), t.utc).toBeLessThan(DIRECTION_DEG);
      expect(worstAxisDeg(e.j2000ToEarthFixed, t.j2000ToEarthFixed), t.utc).toBeLessThan(
        EARTH_TURN_DEG,
      );
    }
  });

  it('agrees with the fixed epochs the rest of the app uses', () => {
    for (const fixed of EPHEMERIS.epochs) {
      const e = epochAt(MANIFEST, SAMPLES, Date.parse(`${fixed.utc}Z`));
      expect(e).not.toBeNull();
      if (e === null) continue;
      expect(angleDeg(e.earthDirectionJ2000, fixed.earthDirectionJ2000)).toBeLessThan(
        DIRECTION_DEG,
      );
      expect(angleDeg(e.sunDirectionJ2000, fixed.sunDirectionJ2000)).toBeLessThan(DIRECTION_DEG);
      expect(worstAxisDeg(e.j2000ToBodyFixed, fixed.j2000ToBodyFixed)).toBeLessThan(DIRECTION_DEG);
    }
  });

  it("evaluates Earth's IAU rotation exactly as SPICE does", () => {
    // A wrong sign or axis order would be off by tens of degrees. Measured: 1.2e-6 deg, the
    // light time taken as distance / c instead of SPICE's own (Earth turns 1e-6 deg in 0.3 ms).
    for (const t of TRUTHS.slice(0, 4)) {
      const m = iauRotation(
        MANIFEST.earthRotation,
        t.tdbSecondsPastJ2000 - t.earthDistanceKm / 299792.458,
      );
      expect(worstAxisDeg(m, t.j2000ToEarthFixed)).toBeLessThan(1e-5);
    }
  });

  it('is null outside its span, so the page falls back to a fixed date', () => {
    expect(epochAt(MANIFEST, SAMPLES, Date.parse('2025-12-31T23:00:00Z'))).toBeNull();
    expect(epochAt(MANIFEST, SAMPLES, Date.parse('2031-01-01T00:00:01Z'))).toBeNull();
  });
});
