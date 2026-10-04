// Hapke's radiance factor in TSL: core/hapke.ts, line for line, for the Moon's shader
// (docs/stories/SS-8b.md). The photometry captures check this against core/hapke.ts pixel by
// pixel.
//
// Branch-free: both of Hapke's roughness cases are evaluated and one kept with mix/step, and
// every division that could meet zero at a grazing angle is floored, as in core/hapke.ts. No
// derivatives are taken here.

import { acos, clamp, exp, float, log, max, min, mix, pow, sin, sqrt, step, tan } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { HAPKE_ROUGHNESS_DEG } from '../core/hapke';

type FloatNode = Node<'float'>;

/** Per-fragment Hapke parameters (core/hapke.ts HapkeParameters). */
export interface HapkeNodes {
  readonly w: FloatNode;
  readonly b: FloatNode;
  readonly c: FloatNode;
  readonly bs0: FloatNode;
  readonly hs: FloatNode;
}

const TINY = 1e-6;

function hapkeH(x: FloatNode, w: FloatNode): FloatNode {
  const xs = max(x, TINY);
  const gamma = sqrt(float(1).sub(w));
  const r0 = float(1).sub(gamma).div(float(1).add(gamma));
  const inner = r0.add(
    float(1)
      .sub(r0.mul(2).mul(xs))
      .div(2)
      .mul(log(float(1).add(xs).div(xs))),
  );
  return float(1).div(float(1).sub(w.mul(xs).mul(inner)));
}

/**
 * I/F for cosines μ0 and μ and cos g, where μ0 > 0 and μ > 0; the caller zeroes it elsewhere
 * (core/hapke.ts returns 0 there).
 */
export function hapkeNode(
  mu0In: FloatNode,
  muIn: FloatNode,
  cosGIn: FloatNode,
  p: HapkeNodes,
  thetaBarDeg = HAPKE_ROUGHNESS_DEG,
  porosityK = 1,
): FloatNode {
  // The mean slope is a constant of the world (the Moon's, or Mars's fitted one), not per texel.
  const TAN_T = Math.tan((thetaBarDeg * Math.PI) / 180);
  const CHI = 1 / Math.sqrt(1 + Math.PI * TAN_T * TAN_T);
  // Clamped into the lit, visible range so nothing below is undefined; the caller's zero
  // handles the rest.
  const mu0 = clamp(mu0In, TINY, 1);
  const mu = clamp(muIn, TINY, 1);
  const cosG = clamp(cosGIn, -1, 1);

  // cos ψ from the three cosines; 1 where either plane is undefined.
  const sinI = sqrt(max(float(1).sub(mu0.mul(mu0)), 0));
  const sinE = sqrt(max(float(1).sub(mu.mul(mu)), 0));
  const sinProduct = sinI.mul(sinE);
  const cosPsiRaw = clamp(cosG.sub(mu0.mul(mu)).div(max(sinProduct, TINY)), -1, 1);
  const cosPsi = mix(float(1), cosPsiRaw, step(TINY, sinProduct));

  // Roughness (Hapke 1984).
  const tanI = max(sinI.div(mu0), TINY);
  const tanE = max(sinE.div(mu), TINY);
  const e1i = exp(float(-2 / (Math.PI * TAN_T)).div(tanI));
  const e1e = exp(float(-2 / (Math.PI * TAN_T)).div(tanE));
  const e2i = exp(float(-1 / (Math.PI * TAN_T * TAN_T)).div(tanI.mul(tanI)));
  const e2e = exp(float(-1 / (Math.PI * TAN_T * TAN_T)).div(tanE.mul(tanE)));
  const etaI = mu0.add(sinI.mul(TAN_T).mul(e2i.div(float(2).sub(e1i)))).mul(CHI);
  const etaE = mu.add(sinE.mul(TAN_T).mul(e2e.div(float(2).sub(e1e)))).mul(CHI);
  const psi = acos(cosPsi);
  const sinHalfPsi = sin(psi.div(2));
  const sinHalfPsi2 = sinHalfPsi.mul(sinHalfPsi);
  const f = exp(tan(min(psi, Math.PI - TINY).div(2)).mul(-2));
  const psiOverPi = psi.div(Math.PI);

  // i <= e
  const dA = float(2).sub(e1e).sub(psiOverPi.mul(e1i));
  const mu0eA = mu0
    .add(sinI.mul(TAN_T).mul(cosPsi.mul(e2e).add(sinHalfPsi2.mul(e2i)).div(dA)))
    .mul(CHI);
  const mueA = mu.add(sinE.mul(TAN_T).mul(e2e.sub(sinHalfPsi2.mul(e2i)).div(dA))).mul(CHI);
  const sA = mueA
    .div(etaE)
    .mul(mu0.div(etaI))
    .mul(
      float(CHI).div(
        float(1)
          .sub(f)
          .add(f.mul(CHI).mul(mu0.div(etaI))),
      ),
    );
  // e <= i
  const dB = float(2).sub(e1i).sub(psiOverPi.mul(e1e));
  const mu0eB = mu0.add(sinI.mul(TAN_T).mul(e2i.sub(sinHalfPsi2.mul(e2e)).div(dB))).mul(CHI);
  const mueB = mu
    .add(sinE.mul(TAN_T).mul(cosPsi.mul(e2i).add(sinHalfPsi2.mul(e2e)).div(dB)))
    .mul(CHI);
  const sB = mueB
    .div(etaE)
    .mul(mu0.div(etaI))
    .mul(
      float(CHI).div(
        float(1)
          .sub(f)
          .add(f.mul(CHI).mul(mu.div(etaE))),
      ),
    );
  // i <= e exactly when μ0 >= μ: step(μ, μ0) is 1 then.
  const caseA = step(mu, mu0);
  const mu0e = mix(mu0eB, mu0eA, caseA);
  const mue = mix(mueB, mueA, caseA);
  const s = mix(sB, sA, caseA);

  // Double Henyey-Greenstein and the shadow-hiding surge.
  const b2 = p.b.mul(p.b);
  const oneMinusB2 = float(1).sub(b2);
  const back = oneMinusB2.div(pow(float(1).sub(p.b.mul(2).mul(cosG)).add(b2), 1.5));
  const forward = oneMinusB2.div(pow(float(1).add(p.b.mul(2).mul(cosG)).add(b2), 1.5));
  const phase = float(1).add(p.c).div(2).mul(back).add(float(1).sub(p.c).div(2).mul(forward));
  const sinG = sqrt(max(float(1).sub(cosG.mul(cosG)), 0));
  const tanHalfG = sinG.div(max(float(1).add(cosG), TINY));
  const surge = float(1).add(p.bs0.div(float(1).add(tanHalfG.div(max(p.hs, TINY)))));

  // Hapke's porosity factor K (core/hapke.ts). At 1, the Moon's and Mars's, no node is added,
  // so their shaders are unchanged.
  if (porosityK !== 1) {
    const multipleK = hapkeH(mu0e.div(porosityK), p.w)
      .mul(hapkeH(mue.div(porosityK), p.w))
      .sub(1);
    return p.w
      .mul(porosityK / 4)
      .mul(mu0e.div(mu0e.add(mue)))
      .mul(phase.mul(surge).add(multipleK))
      .mul(s);
  }
  const multiple = hapkeH(mu0e, p.w).mul(hapkeH(mue, p.w)).sub(1);
  return p.w
    .div(4)
    .mul(mu0e.div(mu0e.add(mue)))
    .mul(phase.mul(surge).add(multiple))
    .mul(s);
}
