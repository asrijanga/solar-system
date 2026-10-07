import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { marsRotation, type MarsRotation } from './mars';
import type { Mat3Rows } from './moon';

// Mercury's IAU rotation (pck00011, public/data/mercury/ephemeris.json, SS-16 W2) is evaluated by
// the same code as Mars's: the app will turn Mercury from these constants at any moment, so they
// must reproduce SPICE's pxform at the epochs it wrote.
const EPHEMERIS = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../public/data/mercury/ephemeris.json'), 'utf8'),
) as {
  body: { rotation: MarsRotation };
  epochs: { id: string; tdbSecondsPastJ2000: number; j2000ToBodyFixed: Mat3Rows }[];
};

describe("Mercury's rotation", () => {
  it.each(EPHEMERIS.epochs.map((e) => [e.id, e] as const))(
    'matches SPICE at %s to 1e-9',
    (_, epoch) => {
      const m = marsRotation(EPHEMERIS.body.rotation, epoch.tdbSecondsPastJ2000);
      m.forEach((row, r) =>
        row.forEach((value, c) =>
          expect(Math.abs(value - (epoch.j2000ToBodyFixed[r]?.[c] ?? NaN))).toBeLessThan(1e-9),
        ),
      );
    },
  );
});
