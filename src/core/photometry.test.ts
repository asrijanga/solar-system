import { describe, expect, it } from 'vitest';
import {
  AU_KM,
  displayValue,
  earthshineFactor,
  EARTH_GEOMETRIC_ALBEDO,
  EXPOSURE,
  lambert,
  lambertAlbedoFor,
  linearToSrgb,
  MOON_GEOMETRIC_ALBEDO,
  MOON_OPPOSITION_DISTANCE_KM,
  MOON_OPPOSITION_MAGNITUDE,
  physicalStarExposure,
  pixelSolidAngle,
  SUN_V_MAGNITUDE,
  zeroPhaseMagnitude,
} from './photometry';
import { hapke, hapkeAtClementineStandard } from './hapke';

const MOON_RADIUS_KM = 1737.4;

describe('the constants against the fact sheet', () => {
  it('reproduce the full Moon at −12.74 from geometric albedo 0.12', () => {
    const m = zeroPhaseMagnitude(
      MOON_GEOMETRIC_ALBEDO,
      MOON_RADIUS_KM,
      MOON_OPPOSITION_DISTANCE_KM,
    );
    expect(Math.abs(m - MOON_OPPOSITION_MAGNITUDE)).toBeLessThan(0.02);
  });

  it('put the Sun at its own magnitude when it is the reference', () => {
    expect(SUN_V_MAGNITUDE).toBe(-26.74);
    expect(AU_KM).toBe(149_597_870.7);
  });
});

describe('display values', () => {
  it('scale with the inverse square of the sun distance', () => {
    expect(displayValue(0.1, AU_KM)).toBeCloseTo(EXPOSURE * 0.1, 12);
    expect(displayValue(0.1, 2 * AU_KM)).toBeCloseTo((EXPOSURE * 0.1) / 4, 12);
  });

  it('keep the brightest 1° tile of the Moon below display white, even at zero phase', () => {
    // The brightest tile's I/F at Clementine's standard geometry is 0.173 (hapke.json
    // standardRange); at zero phase, seen from above, the median tile is 2.34 times brighter
    // than at that geometry. At perihelion distance (0.983 AU) that is still under 1.
    const median = { w: 0.33778, b: 0.233157, c: 0.369601, bs0: 1.715581, hs: 0.059936 };
    const iOverF = (0.173478 * hapke(1, 1, 1, median)) / hapkeAtClementineStandard(median);
    expect(displayValue(iOverF, 0.983 * AU_KM)).toBeLessThan(1);
  });
});

describe('star exposure', () => {
  it('puts the same light on screen as a disc of the same magnitude', () => {
    // A zero-phase disc of albedo p and angular radius θ covers πθ²/Ω pixels at
    // EXPOSURE · p each. A star of the magnitude the disc has must integrate to the same.
    const omega = pixelSolidAngle(40, 800);
    const p = MOON_GEOMETRIC_ALBEDO;
    const d = MOON_OPPOSITION_DISTANCE_KM;
    const theta = MOON_RADIUS_KM / d;
    const disc = (EXPOSURE * p * Math.PI * theta * theta) / omega;
    const m = zeroPhaseMagnitude(p, MOON_RADIUS_KM, d);
    const star = physicalStarExposure(omega) * 10 ** (-0.4 * m);
    expect(star / disc).toBeCloseTo(1, 9);
  });

  it('makes stars invisible next to a sunlit surface: a magnitude-0 peak far below one 8-bit step', () => {
    const sigma = 0.7;
    const peak = physicalStarExposure(pixelSolidAngle(40, 800)) / (2 * Math.PI * sigma * sigma);
    expect(linearToSrgb(peak) * 255).toBeLessThan(0.5);
  });
});

describe('sRGB encoding', () => {
  it('matches IEC 61966-2-1 at its anchors', () => {
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 12);
    expect(linearToSrgb(0.18) * 255).toBeCloseTo(117.8, 0);
    expect(linearToSrgb(0.002)).toBeCloseTo(0.02584, 5);
  });
});

describe('Earth as a uniform Lambert sphere', () => {
  it('has the fact sheet geometric albedo as its disc mean at zero phase', () => {
    // Mean of I/F = A·μ over the projected disc, by midpoint integration in radius: μ = √(1 − ρ²).
    const albedo = lambertAlbedoFor(EARTH_GEOMETRIC_ALBEDO);
    const n = 20000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const rho = (i + 0.5) / n;
      const mu = Math.sqrt(1 - rho * rho);
      sum += lambert(albedo, mu, mu) * 2 * rho * (1 / n);
    }
    expect(sum).toBeCloseTo(EARTH_GEOMETRIC_ALBEDO, 4);
  });
});

describe('earthshine', () => {
  it('is the disc I/F times (R/d)², the irradiance of a uniform disc integrated over its cone', () => {
    // Integrate L cos(t) dΩ over the cone Earth fills, seen from 60 Earth radii, numerically.
    const discIOverF = 0.3;
    const radius = 6371;
    const distance = 60 * radius;
    const half = Math.asin(radius / distance);
    const steps = 20000;
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      const t = ((i + 0.5) / steps) * half;
      sum += Math.cos(t) * Math.sin(t) * 2 * Math.PI * (half / steps);
    }
    // Radiance L = I/F · F / π, with F = 1.
    const integrated = (discIOverF / Math.PI) * sum;
    expect(earthshineFactor(discIOverF, radius, distance)).toBeCloseTo(integrated, 12);
  });

  it('is tens of thousands of times fainter than sunlight from the Moon', () => {
    // A half-lit Earth (disc I/F 0.07, SS-13c) at the Moon's mean distance.
    const k = earthshineFactor(0.07, 6371, 384_400);
    expect(1 / k).toBeGreaterThan(30_000);
    expect(1 / k).toBeLessThan(100_000);
  });
});
