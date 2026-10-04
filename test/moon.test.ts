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

describe('Mars viewpoint checks', () => {
  const landmarks = (
    JSON.parse(
      readFileSync(join(import.meta.dirname, '../public/data/mars/landmarks.json'), 'utf8'),
    ) as {
      landmarks: { name: string; lonDeg: number; latDeg: number; diameterKm: number }[];
    }
  ).landmarks;
  const fixture = (
    JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures/iau-gazetteer-mars.json'), 'utf8'),
    ) as {
      features: { name: string; lonDeg: number; latDeg: number; expect: string }[];
    }
  ).features;

  it('take their features where the Gazetteer puts them', () => {
    for (const v of viewpoints.filter((x) => x.scene === 'mars')) {
      for (const check of v.bodyChecks) {
        if (check.kind === 'feature') {
          const f = fixture.find((x) => x.name === check.name);
          expect(f, check.name).toBeDefined();
          expect(check.lonDeg).toBeCloseTo(f?.lonDeg ?? NaN, 4);
          expect(check.latDeg).toBeCloseTo(f?.latDeg ?? NaN, 4);
          expect(check.expect).toBe(f?.expect === 'dark' ? 'darker' : 'brighter');
        }
        if (check.kind === 'walls') {
          const l = landmarks.find((x) => check.name.startsWith(x.name));
          expect(l, check.name).toBeDefined();
          expect(check.lonDeg).toBeCloseTo(l?.lonDeg ?? NaN, 4);
          expect(check.latDeg).toBeCloseTo(l?.latDeg ?? NaN, 4);
          expect(check.diameterKm).toBeCloseTo(l?.diameterKm ?? NaN, 3);
        }
      }
    }
  });
});
