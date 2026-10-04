// Writes test/fixtures/hapke-values.json when HAPKE_FIXTURE=write, and otherwise checks it: values
// of core/hapke.ts for pipeline/hapke.py's port to match (pipeline/test_hapke.py).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hapke } from './hapke';

const FILE = join(import.meta.dirname, '../../test/fixtures/hapke-values.json');
const LAWS = [
  {
    name: 'moon-median',
    p: { w: 0.29, b: 0.24, c: 0.32, bs0: 1.9, hs: 0.07 },
    thetaBarDeg: 23.6566,
  },
  {
    name: 'mars-fitted',
    p: { w: 0.60653, b: 0.01, c: 1, bs0: 1.27266, hs: 0.13499 },
    thetaBarDeg: 0.233,
  },
  { name: 'rough', p: { w: 0.5, b: 0.4, c: -0.3, bs0: 0.5, hs: 0.2 }, thetaBarDeg: 40 },
];
const GEOMETRIES: [number, number, number][] = [];
for (const i of [0, 15, 30, 45, 60, 75, 89]) {
  for (const e of [0, 20, 45, 70]) {
    for (const g of [Math.abs(i - e), (i + e) / 2, i + e].filter((x) => x <= 180)) {
      GEOMETRIES.push([i, e, g]);
    }
  }
}
const rad = Math.PI / 180;
const values = () =>
  LAWS.map((law) => ({
    ...law,
    cases: GEOMETRIES.map(([i, e, g]) => ({
      i,
      e,
      g,
      value: hapke(Math.cos(i * rad), Math.cos(e * rad), Math.cos(g * rad), law.p, law.thetaBarDeg),
    })),
  }));

describe('Hapke values for the Python port', () => {
  it('are the committed fixture', () => {
    if (process.env['HAPKE_FIXTURE'] === 'write') {
      writeFileSync(
        FILE,
        `${JSON.stringify({ source: 'src/core/hapke.ts', laws: values() }, null, 1)}\n`,
      );
    }
    const fixture = JSON.parse(readFileSync(FILE, 'utf8')) as { laws: ReturnType<typeof values> };
    expect(fixture.laws).toEqual(values());
  });
});
