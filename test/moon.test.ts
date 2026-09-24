// Ties the Moon viewpoints to their sources: Gazetteer coordinates to the fixture, the
// uniform albedo to the geometric albedo, and the calibration to the manifest.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findViewpoint, viewpoints } from '../src/capture/viewpoints';
import { lommelSeeligerAlbedoFor, MOON_GEOMETRIC_ALBEDO } from '../src/core/photometry';

const root = join(import.meta.dirname, '..');
const gazetteer = JSON.parse(
  readFileSync(join(root, 'test/fixtures/iau-gazetteer-moon.json'), 'utf8'),
) as { features: { name: string; lonDeg: number; latDeg: number }[] };
const albedo = JSON.parse(readFileSync(join(root, 'public/data/moon/albedo.json'), 'utf8')) as {
  calibration: { geometricAlbedo: number; albedoScale: number; discMeanTextureValue: number };
};

describe('Moon viewpoint checks', () => {
  it('use exactly the Gazetteer fixture coordinates', () => {
    const checks = findViewpoint('moon-full')?.moonChecks ?? [];
    const features = checks.filter((c) => c.kind === 'feature');
    expect(features.map((f) => f.name).sort()).toEqual(
      ['Aristarchus', 'Copernicus', 'Mare Crisium', 'Statio Tranquillitatis', 'Tycho'].sort(),
    );
    for (const check of features) {
      const f = gazetteer.features.find((x) => x.name === check.name);
      expect(f, check.name).toBeDefined();
      expect(check.lonDeg).toBe(f!.lonDeg);
      expect(check.latDeg).toBe(f!.latDeg);
    }
  });

  it('give the uniform Moon the real Moon’s geometric albedo', () => {
    for (const v of viewpoints) {
      for (const c of v.moonChecks) {
        if (c.kind === 'photometry') {
          expect(c.albedo).toBeCloseTo(lommelSeeligerAlbedoFor(MOON_GEOMETRIC_ALBEDO), 12);
        }
      }
      if (v.moon !== null && v.moon.albedo !== 'map') {
        expect(v.moon.albedo.uniform).toBeCloseTo(0.96, 12);
      }
    }
  });

  it('pair every Moon negative control with a viewpoint that runs the same checks', () => {
    for (const control of viewpoints.filter((v) => v.negativeControl && v.moon !== null)) {
      const twin = viewpoints.find(
        (v) =>
          !v.negativeControl && JSON.stringify(v.moonChecks) === JSON.stringify(control.moonChecks),
      );
      expect(twin, control.id).toBeDefined();
    }
  });
});

describe('albedo calibration', () => {
  it('is to the fact sheet’s geometric albedo', () => {
    expect(albedo.calibration.geometricAlbedo).toBe(MOON_GEOMETRIC_ALBEDO);
  });

  it('makes the disc-mean ϖ at zero phase exactly 8p', () => {
    const { albedoScale, discMeanTextureValue } = albedo.calibration;
    expect(albedoScale * discMeanTextureValue).toBeCloseTo(8 * MOON_GEOMETRIC_ALBEDO, 5);
  });
});
