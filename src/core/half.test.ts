import { describe, expect, it } from 'vitest';
import { floatToHalf, halfToFloat } from './half';

describe('binary16', () => {
  it('encodes the standard reference values', () => {
    expect(floatToHalf(1)).toBe(0x3c00);
    expect(floatToHalf(-2)).toBe(0xc000);
    expect(floatToHalf(65504)).toBe(0x7bff);
    expect(floatToHalf(1e6)).toBe(0x7c00);
    expect(floatToHalf(2 ** -24)).toBe(0x0001);
    expect(floatToHalf(0)).toBe(0);
    expect(floatToHalf(1 / 3)).toBe(0x3555);
  });

  it('round-trips every finite pattern', () => {
    for (let h = 0; h < 0x10000; h++) {
      if ((h & 0x7c00) === 0x7c00) continue;
      const x = halfToFloat(h);
      // -0 encodes back to 0x8000 and compares equal as a number.
      expect(floatToHalf(x)).toBe(h);
    }
  });

  it('rounds to within half a unit in the last place', () => {
    for (const x of [0.3378, 0.2332, 0.3696, 1.7156, 0.0599, 23.6566, 0.08387]) {
      expect(Math.abs(halfToFloat(floatToHalf(x)) - x)).toBeLessThanOrEqual(x * 2 ** -11);
    }
  });
});
