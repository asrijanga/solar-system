// Ties the Moon viewpoints to their sources: Gazetteer coordinates to the fixture, the
// uniform albedo to the median tile, and the calibration to the manifest.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findViewpoint, viewpoints } from '../src/capture/viewpoints';

const root = join(import.meta.dirname, '..');
const gazetteer = JSON.parse(
  readFileSync(join(root, 'test/fixtures/iau-gazetteer-moon.json'), 'utf8'),
) as { features: { name: string; lonDeg: number; latDeg: number }[] };
const albedo = JSON.parse(readFileSync(join(root, 'public/data/moon/albedo.json'), 'utf8')) as {
  calibration: { consistency: { tiles: number; slopeThroughZero: number; r: number } };
};
const hapke = JSON.parse(readFileSync(join(root, 'public/data/moon/hapke.json'), 'utf8')) as {
  medianAtStandard: number;
};

describe('Moon viewpoint checks', () => {
  it('use exactly the Gazetteer fixture coordinates', () => {
    const checks = findViewpoint('moon-full')?.bodyChecks ?? [];
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

  it('give the uniform Moon the median tile’s reflectance', () => {
    for (const v of viewpoints) {
      for (const c of v.bodyChecks) {
        if (c.kind === 'photometry') expect(c.albedo).toBeCloseTo(hapke.medianAtStandard, 3);
      }
      if (v.body !== null && v.body.albedo !== 'map') {
        expect(v.body.albedo.uniform).toBeCloseTo(hapke.medianAtStandard, 3);
      }
    }
  });

  it('pair every Moon negative control with a viewpoint that runs the same checks', () => {
    for (const control of viewpoints.filter((v) => v.negativeControl && v.body !== null)) {
      const twin = viewpoints.find(
        (v) =>
          !v.negativeControl && JSON.stringify(v.bodyChecks) === JSON.stringify(control.bodyChecks),
      );
      expect(twin, control.id).toBeDefined();
    }
  });
});

describe('albedo map against the Hapke parameter maps', () => {
  it('is recorded over every measured tile', () => {
    expect(albedo.calibration.consistency.tiles).toBe(360 * 140);
  });
});
