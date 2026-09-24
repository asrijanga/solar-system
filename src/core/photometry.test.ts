import { describe, expect, it } from 'vitest';
import {
  AU_KM,
  displayValue,
  EXPOSURE,
  lambert,
  linearToSrgb,
  lommelSeeliger,
  lommelSeeligerAlbedoFor,
  MOON_GEOMETRIC_ALBEDO,
  MOON_OPPOSITION_DISTANCE_KM,
  MOON_OPPOSITION_MAGNITUDE,
  physicalStarExposure,
  pixelSolidAngle,
  SUN_V_MAGNITUDE,
  zeroPhaseMagnitude,
} from './photometry';

const MOON_RADIUS_KM = 1737.4;

describe('Lommel–Seeliger', () => {
  it('is flat across the disc at zero phase, where Lambert darkens to the limb', () => {
    const centre = lommelSeeliger(1, 1, 1);
    for (const mu of [0.9, 0.5, 0.1, 0.01]) {
      expect(lommelSeeliger(1, mu, mu)).toBeCloseTo(centre, 12);
    }
    expect(lambert(1, 0.1, 0.1) / lambert(1, 1, 1)).toBeCloseTo(0.1, 12);
  });

  it('is ϖ/8 at zero phase, so ϖ = 8p gives geometric albedo p', () => {
    const albedo = lommelSeeligerAlbedoFor(MOON_GEOMETRIC_ALBEDO);
    expect(albedo).toBeCloseTo(0.96, 12);
    expect(lommelSeeliger(albedo, 0.7, 0.7)).toBeCloseTo(MOON_GEOMETRIC_ALBEDO, 12);
  });

  it('is zero on the night side and on the far side', () => {
    expect(lommelSeeliger(1, -0.1, 0.5)).toBe(0);
    expect(lommelSeeliger(1, 0, 0.5)).toBe(0);
    expect(lommelSeeliger(1, 0.5, -0.2)).toBe(0);
  });

  it('never exceeds ϖ/4, reached only at grazing emission', () => {
    expect(lommelSeeliger(1, 1, 1e-9)).toBeCloseTo(0.25, 6);
    expect(lommelSeeliger(1, 0.3, 0.2)).toBeLessThan(0.25);
  });
});

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

  it('keep the brightest Lommel–Seeliger point of a full Moon below display white', () => {
    // Twice the disc-mean albedo is brighter than any large lunar region; grazing emission
    // doubles I/F. At perihelion distance (0.983 AU) that is still under 1.
    const albedo = 2 * lommelSeeligerAlbedoFor(MOON_GEOMETRIC_ALBEDO);
    expect(displayValue(lommelSeeliger(albedo, 1, 1), 0.983 * AU_KM)).toBeLessThan(1);
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
