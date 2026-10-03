import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { labelNumber, molaPolar, parseLabel, projectionOf } from './marsProjection';

interface Case {
  readonly label: Record<string, string>;
  readonly points: { latDeg: number; lonDeg: number; row: number; col: number }[];
}
const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../test/fixtures/mars-local-projections.json'),
    'utf8',
  ),
) as { cases: Record<string, Case> };

describe('Mars projected products', () => {
  for (const [name, c] of Object.entries(fixture.cases)) {
    it(`places points where GDAL does: ${name}`, () => {
      const projection = projectionOf(new Map(Object.entries(c.label)));
      for (const p of c.points) {
        const got = projectionOf(new Map(Object.entries(c.label))).toPixel(p.latDeg, p.lonDeg);
        expect(got).not.toBeNull();
        // Within a hundredth of a pixel: GDAL's PROJ and these formulas, on the same sphere.
        expect(Math.abs((got?.row ?? 0) - p.row)).toBeLessThan(0.01);
        expect(Math.abs((got?.col ?? 0) - p.col)).toBeLessThan(0.01);
        const wrapped = projection.toPixel(p.latDeg, p.lonDeg + 360);
        expect(wrapped?.row).toBeCloseTo(got?.row ?? 0, 6);
        expect(wrapped?.col).toBeCloseTo(got?.col ?? 0, 6);
      }
    });
  }

  it('reads label numbers in the unit asked for', () => {
    const label = parseLabel(
      'MAP_SCALE = 0.05 <km/pixel>\nA_AXIS_RADIUS = 3393.8 <KM>\nX = "EQUIRECTANGULAR"\nEND\nMAP_SCALE = 9\n',
    );
    expect(labelNumber(label, 'MAP_SCALE', 'm')).toBeCloseTo(50, 9);
    expect(labelNumber(label, 'A_AXIS_RADIUS', 'm')).toBeCloseTo(3393800, 6);
    expect(label.get('X')).toBe('"EQUIRECTANGULAR"');
  });

  it("puts MOLA's polar grids' longitude 0 down in the north and up in the south", () => {
    const n = 10240;
    const north = molaPolar(true, n, 128).toPixel(85, 0);
    const south = molaPolar(false, n, 128).toPixel(-85, 0);
    expect(north?.row ?? 0).toBeGreaterThan(n / 2);
    expect(south?.row ?? n).toBeLessThan(n / 2);
    expect(north?.col).toBeCloseTo(n / 2 - 0.5, 9);
  });
});
