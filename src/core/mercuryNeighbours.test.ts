import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from './moon';
import {
  mercuryNeighboursAt,
  venusMagnitudeV,
  type MercuryNeighboursManifest,
} from './mercuryNeighbours';

const read = (path: string): string =>
  readFileSync(join(import.meta.dirname, '../..', path), 'utf8');

describe("Venus's magnitude (Mallama & Hilton 2018, Eq. 3 and 4)", () => {
  it('is Eq. 3 up to 163.7 deg', () => {
    const a = 90;
    const want =
      5 * Math.log10(0.72 * 0.5) -
      4.384 -
      1.044e-3 * a +
      3.687e-4 * a ** 2 -
      2.814e-6 * a ** 3 +
      8.938e-9 * a ** 4;
    expect(venusMagnitudeV(0.72, 0.5, a)).toBeCloseTo(want, 12);
  });

  it('is Eq. 4 beyond 163.7 deg, and Eq. 4 at 179 deg beyond that', () => {
    const eq4 = (a: number): number => 236.05828 - 2.81914 * a + 8.39034e-3 * a * a;
    expect(venusMagnitudeV(1, 1, 170)).toBeCloseTo(eq4(170), 12);
    expect(venusMagnitudeV(1, 1, 179.9)).toBeCloseTo(eq4(179), 12);
  });

  it('gives the familiar greatest brilliancy from Earth (about -4.7)', () => {
    // Mallama & Hilton: greatest brilliancy near alpha 123.5 deg; then r 0.72, d about 0.39 AU.
    expect(venusMagnitudeV(0.723, 0.39, 123.5)).toBeGreaterThan(-5);
    expect(venusMagnitudeV(0.723, 0.39, 123.5)).toBeLessThan(-4.4);
  });
});

describe('Venus and the Moon from Mercury (neighbours timeline)', () => {
  const manifest = JSON.parse(
    read('public/data/mercury/neighbours.json'),
  ) as MercuryNeighboursManifest & {
    measuredWorstError: Record<string, number>;
  };
  const bytes = readFileSync(join(import.meta.dirname, '../../public/data/mercury/neighbours.bin'));
  const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const truths = (
    JSON.parse(read('test/fixtures/mercury-neighbours-truth.json')) as {
      moments: {
        utc: string;
        venusDirectionJ2000: Vec3;
        venusDistanceKm: number;
        moonDirectionJ2000: Vec3;
        moonDistanceKm: number;
        moonDiscKm2: number;
      }[];
    }
  ).moments;
  const angleDeg = (a: Vec3, b: Vec3): number =>
    (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

  // The pipeline measured 2.8e-5 deg, 22 km and 0.64% (the Moon's brightness) as the worst over
  // 2000 moments: these tolerances hold with room.
  it('matches SPICE at moments between samples', () => {
    expect(truths.length).toBeGreaterThan(20);
    for (const t of truths) {
      const n = mercuryNeighboursAt(manifest, data, Date.parse(t.utc));
      expect(n, t.utc).not.toBeNull();
      if (n === null) continue;
      expect(angleDeg(n.venusDirectionJ2000, t.venusDirectionJ2000), t.utc).toBeLessThan(0.002);
      expect(angleDeg(n.moonDirectionJ2000, t.moonDirectionJ2000), t.utc).toBeLessThan(0.002);
      expect(Math.abs(n.venusDistanceKm - t.venusDistanceKm), t.utc).toBeLessThan(50);
      expect(Math.abs(n.moonDistanceKm - t.moonDistanceKm), t.utc).toBeLessThan(50);
      expect(Math.abs(n.moonDiscKm2 / t.moonDiscKm2 - 1), t.utc).toBeLessThan(0.01);
    }
  });
});
