import { describe, expect, it } from 'vitest';
import {
  cosAzimuth,
  doubleHenyeyGreenstein,
  hapke,
  hapkeH,
  moonPhaseMagnitude,
  shadowHiding,
  type HapkeParameters,
} from './hapke';

/** The median tile at 566 nm (public/data/moon/hapke.json). */
const MOON: HapkeParameters = { w: 0.33778, b: 0.233157, c: 0.369601, bs0: 1.715581, hs: 0.059936 };
const RAD = Math.PI / 180;

/** Cosines for incidence i, emission e and azimuth ψ, in degrees. */
function geometry(i: number, e: number, psi: number): [number, number, number] {
  const mu0 = Math.cos(i * RAD);
  const mu = Math.cos(e * RAD);
  return [mu0, mu, mu0 * mu + Math.sin(i * RAD) * Math.sin(e * RAD) * Math.cos(psi * RAD)];
}

describe('Hapke', () => {
  it('is reciprocal: the reflectance r/μ0 is unchanged when Sun and viewer swap', () => {
    for (const [i, e, psi] of [
      [30, 60, 40],
      [70, 10, 120],
      [45, 45, 90],
      [20, 80, 0],
      [5, 85, 170],
    ] as const) {
      const [mu0, mu, cosG] = geometry(i, e, psi);
      expect(hapke(mu0, mu, cosG, MOON) / mu0).toBeCloseTo(hapke(mu, mu0, cosG, MOON) / mu, 12);
    }
  });

  it("approximates Chandrasekhar's H to 1%, as Hapke (2002) states", () => {
    // Chandrasekhar (1960), conservative scattering: H(1) = 2.90781.
    expect(Math.abs(hapkeH(1, 1) / 2.90781 - 1)).toBeLessThan(0.01);
    expect(hapkeH(0.5, 0)).toBe(1);
  });

  it('normalises the double Henyey-Greenstein function over the sphere', () => {
    // ∫ p(g) dΩ / 4π = 1: integrate over cos g.
    let sum = 0;
    const n = 20000;
    for (let k = 0; k < n; k++) sum += doubleHenyeyGreenstein(-1 + (2 * (k + 0.5)) / n, 0.23, 0.37);
    expect((sum * 2) / n / 2).toBeCloseTo(1, 4);
  });

  it('surges by 1 + Bs0 at zero phase and falls off over hs', () => {
    expect(shadowHiding(1, 1.7, 0.06)).toBeCloseTo(2.7, 12);
    const halfWidth = 2 * Math.atan(0.06);
    expect(shadowHiding(Math.cos(halfWidth), 1.7, 0.06)).toBeCloseTo(1.85, 10);
  });

  it('is zero where the Sun is down or the surface faces away', () => {
    expect(hapke(-0.1, 0.5, 0.3, MOON)).toBe(0);
    expect(hapke(0, 0.5, 0.3, MOON)).toBe(0);
    expect(hapke(0.5, -0.2, 0.3, MOON)).toBe(0);
  });

  it('recovers the azimuth from the three cosines', () => {
    const [mu0, mu, cosG] = geometry(40, 25, 70);
    expect(cosAzimuth(mu0, mu, cosG)).toBeCloseTo(Math.cos(70 * RAD), 12);
    expect(cosAzimuth(1, 0.5, 0.5)).toBe(1);
  });

  it('brightens towards zero phase, the opposition surge Lommel–Seeliger lacks', () => {
    const [mu0, mu] = geometry(5, 5, 0);
    const surge = hapke(mu0, mu, 1, MOON) / hapke(mu0, mu, Math.cos(10 * RAD), MOON);
    expect(surge).toBeGreaterThan(1.3);
  });

  it('keeps the phase magnitude formula of Allen’s Astrophysical Quantities', () => {
    expect(moonPhaseMagnitude(0)).toBe(0);
    expect(moonPhaseMagnitude(90)).toBeCloseTo(2.6024, 4);
    expect(moonPhaseMagnitude(-90)).toBe(moonPhaseMagnitude(90));
  });
});
