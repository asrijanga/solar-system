// Checks the committed star binary against the pipeline's manifest and against SIMBAD,
// an independent catalogue (test/fixtures/simbad-stars.json records the query and date).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { angularSeparationDeg, raDecToScene } from '../src/core/frames';
import { decodeStars, fluxOfMagnitude } from '../src/core/stars';

const root = join(import.meta.dirname, '..');
const bytes = readFileSync(join(root, 'public/data/stars/bsc5.bin'));
const manifest = JSON.parse(readFileSync(join(root, 'public/data/stars/bsc5.json'), 'utf8'));
const simbad = JSON.parse(readFileSync(join(root, 'test/fixtures/simbad-stars.json'), 'utf8')) as {
  stars: { name: string; hr: number; raDeg: number; decDeg: number }[];
};
const field = decodeStars(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

type V3 = [number, number, number];
const direction = (hr: number): V3 => {
  const i = field.hr.indexOf(hr);
  if (i < 0) throw new Error(`HR ${hr} not in the binary`);
  return [field.directions[i * 3]!, field.directions[i * 3 + 1]!, field.directions[i * 3 + 2]!];
};
const reference = (name: string): { hr: number; dir: V3 } => {
  const s = simbad.stars.find((x) => x.name === name);
  if (!s) throw new Error(`${name} missing from the SIMBAD fixture`);
  return { hr: s.hr, dir: raDecToScene(s.raDeg, s.decDeg) };
};

describe('star binary', () => {
  it('matches the manifest: checksum and count', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.output.sha256);
    expect(field.count).toBe(manifest.counts.stars);
    expect(manifest.counts.stars + manifest.counts.removedEntries).toBe(manifest.counts.records);
  });

  it('holds unit vectors', () => {
    for (let i = 0; i < field.count; i++) {
      const n = Math.hypot(
        field.directions[i * 3]!,
        field.directions[i * 3 + 1]!,
        field.directions[i * 3 + 2]!,
      );
      expect(Math.abs(n - 1)).toBeLessThan(1e-6);
    }
  });

  it('puts Polaris within one degree of the north celestial pole', () => {
    const polaris = direction(424);
    expect(angularSeparationDeg(polaris, [0, 1, 0])).toBeLessThan(1);
  });
});

describe('agreement with SIMBAD', () => {
  it('places every reference star within 5 arcseconds of SIMBAD', () => {
    for (const s of simbad.stars) {
      const ours = direction(s.hr);
      const theirs = raDecToScene(s.raDeg, s.decDeg);
      expect(angularSeparationDeg(ours, theirs) * 3600, s.name).toBeLessThan(5);
    }
  });

  it('reproduces separations between bright pairs to within 5 arcseconds', () => {
    for (const [a, b] of [
      ['Betelgeuse', 'Rigel'],
      ['Dubhe', 'Merak'],
      ['Sirius', 'Vega'],
    ] as const) {
      const ra = reference(a);
      const rb = reference(b);
      const ours = angularSeparationDeg(direction(ra.hr), direction(rb.hr));
      const theirs = angularSeparationDeg(ra.dir, rb.dir);
      expect(Math.abs(ours - theirs) * 3600, `${a}–${b}`).toBeLessThan(5);
    }
  });
});

describe('brightness', () => {
  it('follows Pogson: 5 magnitudes is a factor of 100', () => {
    expect(fluxOfMagnitude(0) / fluxOfMagnitude(5)).toBeCloseTo(100, 10);
  });

  it('makes Sirius the brightest star in the catalogue', () => {
    const brightest = field.hr[field.vmag.indexOf(Math.min(...field.vmag))];
    expect(brightest).toBe(reference('Sirius').hr);
  });
});

describe('viewpoint star checks', () => {
  it('use exactly the SIMBAD fixture coordinates', async () => {
    const { findViewpoint } = await import('../src/capture/viewpoints');
    const orion = findViewpoint('orion');
    expect(orion?.starChecks.length).toBeGreaterThan(0);
    for (const check of orion?.starChecks ?? []) {
      const s = simbad.stars.find((x) => x.name === check.name);
      expect(s, check.name).toBeDefined();
      expect(check.raDeg).toBe(s!.raDeg);
      expect(check.decDeg).toBe(s!.decDeg);
    }
  });
});
