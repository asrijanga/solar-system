import { describe, expect, it } from 'vitest';
import {
  circularSpeedKmS,
  groundDistance,
  horizonDip,
  orbitFrom,
  orbitHeading,
  randomOrbit,
  seededRandom,
  sharpHeightKm,
  upAndNorth,
  viewDepression,
  type Vec3,
} from './orbit';

const R = 1737.4;
const GM = 4902.800118457549; // gm_de440.tpc BODY301_GM
const fov = (50 * Math.PI) / 180;

describe('orbit maths', () => {
  it('gives the textbook circular speed: about 1.63 km/s at 100 km, 1.34 at 1000 km', () => {
    expect(circularSpeedKmS(GM, R + 100)).toBeCloseTo(1.6335, 4);
    expect(circularSpeedKmS(GM, R + 1000)).toBeCloseTo(1.3383, 4);
  });

  it('puts the horizon 50.6 degrees down from 1000 km', () => {
    expect((horizonDip(R, 1000) * 180) / Math.PI).toBeCloseTo(50.61, 1);
  });

  it('finds the ground straight down at the height, and misses above the horizon', () => {
    expect(groundDistance(R, 500, Math.PI / 2)).toBeCloseTo(500, 6);
    expect(groundDistance(R, 500, horizonDip(R, 500) - 0.01)).toBe(Infinity);
    // Just below the horizon the ground is nearly the tangent distance away (within 0.1%).
    const tangent = Math.sqrt((R + 500) ** 2 - R * R);
    expect(groundDistance(R, 500, horizonDip(R, 500) + 1e-9) / tangent).toBeCloseTo(1, 3);
  });

  it('frames the horizon above the centre of the view', () => {
    expect(viewDepression(R, 800, fov)).toBeGreaterThan(horizonDip(R, 800));
  });

  it('chooses a height where the nearest ground keeps each sample within the pixel limit', () => {
    const pixel = fov / 1024;
    const h = sharpHeightKm(R, 2.66, pixel, fov, 3);
    const depression = viewDepression(R, h, fov) + fov / 2;
    const nearest = groundDistance(R, h, depression);
    expect(2.66 / nearest / pixel).toBeCloseTo(3, 3);
    // Finer data lets the camera come lower.
    expect(sharpHeightKm(R, 0.67, pixel, fov, 3)).toBeLessThan(h / 2);
  });
});

describe('random orbits', () => {
  const sun: Vec3 = [1, 0, 0];

  it('is the same for the same seed', () => {
    const a = randomOrbit(seededRandom(7), R, GM, 500, sun);
    const b = randomOrbit(seededRandom(7), R, GM, 500, sun);
    expect(a).toEqual(b);
  });

  it('starts over ground with the Sun 8 to 35 degrees up, at 1 to 1.5 times the minimum height', () => {
    for (let seed = 1; seed < 50; seed++) {
      const o = randomOrbit(seededRandom(seed), R, GM, 500, sun);
      expect(o.radiusKm - R).toBeGreaterThanOrEqual(500);
      expect(o.radiusKm - R).toBeLessThanOrEqual(750);
      const up = [0, 1, 2].map(
        (i) => Math.cos(o.theta0) * (o.u[i] ?? 0) + Math.sin(o.theta0) * (o.v[i] ?? 0),
      );
      const elevation = (Math.asin(up[0] ?? 0) * 180) / Math.PI;
      expect(elevation).toBeGreaterThanOrEqual(8);
      expect(elevation).toBeLessThanOrEqual(35);
      // u and v span the plane: unit length, perpendicular.
      expect(Math.hypot(...o.u)).toBeCloseTo(1, 12);
      expect(o.u[0] * o.v[0] + o.u[1] * o.v[1] + o.u[2] * o.v[2]).toBeCloseTo(0, 12);
      expect(Math.abs(o.omega * o.radiusKm)).toBeCloseTo(circularSpeedKmS(GM, o.radiusKm), 12);
    }
  });
});

describe('orbits from where you are', () => {
  it('starts over the point below you, at your height, at circular speed, in a random direction', () => {
    const up: Vec3 = [0.6, -0.48, 0.64];
    const headings = new Set<string>();
    for (let seed = 1; seed < 20; seed++) {
      const o = orbitFrom(seededRandom(seed), up, R, GM, 400);
      expect(o.theta0).toBe(0);
      expect(o.u[0]).toBeCloseTo(0.6, 12);
      expect(o.u[2]).toBeCloseTo(0.64, 12);
      expect(o.radiusKm).toBeCloseTo(R + 400, 9);
      expect(o.u[0] * o.v[0] + o.u[1] * o.v[1] + o.u[2] * o.v[2]).toBeCloseTo(0, 12);
      expect(Math.hypot(...o.v)).toBeCloseTo(1, 12);
      expect(o.omega * o.radiusKm).toBeCloseTo(circularSpeedKmS(GM, o.radiusKm), 12);
      headings.add(o.v.map((x) => x.toFixed(3)).join());
    }
    expect(headings.size).toBe(19);
  });
});

describe('an orbit from a known spot', () => {
  it('starts over the point and sets off due north along its meridian', () => {
    const { up, north } = upAndNorth(3.77, -11.3);
    expect(up[0] * north[0] + up[1] * north[1] + up[2] * north[2]).toBeCloseTo(0, 12);
    const o = orbitHeading(up, north, R, GM, 620);
    // A quarter of a turn on, it is 90° further north along the same meridian: 78.7° N.
    const t = Math.PI / 2;
    const p = [0, 1, 2].map((i) => Math.cos(t) * (o.u[i] ?? 0) + Math.sin(t) * (o.v[i] ?? 0));
    const lat = (Math.asin(p[2] ?? 0) * 180) / Math.PI;
    const lon = (Math.atan2(p[1] ?? 0, p[0] ?? 0) * 180) / Math.PI;
    expect(lat).toBeCloseTo(78.7, 9);
    // Still short of the pole, so still on the same meridian.
    expect(lon).toBeCloseTo(3.77, 9);
    expect(o.omega * o.radiusKm).toBeCloseTo(circularSpeedKmS(GM, R + 620), 12);
  });
});
