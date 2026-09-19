import * as THREE from 'three';
import type { PieceType } from '../../types';
import { Easing, delay, tween } from './tween';

export interface Point {
  x: number;
  z: number;
}

type AttackFn = (piece: THREE.Group, from: Point, to: Point) => Promise<void>;

/** How far into its own motion each attacker "lands the blow" — this is when the
 * defender's death animation is triggered, so a slow, coiling wind-up (queen) lets
 * the defender react later than an instant pawn stab. */
export const IMPACT_FRACTION: Record<PieceType, number> = {
  p: 0.55,
  n: 0.62,
  b: 0.6,
  r: 0.5,
  q: 0.65,
  k: 0.7,
};

export const ATTACK_DURATION_MS: Record<PieceType, number> = {
  p: 360,
  n: 560,
  b: 520,
  r: 480,
  q: 640,
  k: 520,
};

/** Pawn: a short, quick lunge — a stiff forward stab with a small hop. */
const pawnLunge: AttackFn = async (piece, from, to) => {
  const duration = ATTACK_DURATION_MS.p;
  await tween(duration, (t) => {
    const e = Easing.easeInOutQuad(t);
    piece.position.x = THREE.MathUtils.lerp(from.x, to.x, e);
    piece.position.z = THREE.MathUtils.lerp(from.z, to.z, e);
    piece.position.y = Math.sin(t * Math.PI) * 0.14;
    piece.rotation.x = Math.sin(t * Math.PI) * -0.18;
  });
  piece.rotation.x = 0;
};

/** Knight: the signature L-shaped leap — a high arcing jump with a mid-air spin. */
const knightLeap: AttackFn = async (piece, from, to) => {
  const duration = ATTACK_DURATION_MS.n;
  const spinDir = Math.random() > 0.5 ? 1 : -1;
  await tween(duration, (t) => {
    const e = Easing.easeInOutQuad(t);
    piece.position.x = THREE.MathUtils.lerp(from.x, to.x, e);
    piece.position.z = THREE.MathUtils.lerp(from.z, to.z, e);
    piece.position.y = Math.sin(t * Math.PI) * 0.85;
    piece.rotation.y = spinDir * t * Math.PI * 2;
    piece.rotation.z = Math.sin(t * Math.PI) * 0.22;
  });
  await tween(120, (t) => {
    const e = Easing.easeOutQuad(t);
    piece.scale.y = 1 - Math.sin(e * Math.PI) * 0.2;
    piece.scale.x = 1 + Math.sin(e * Math.PI) * 0.1;
    piece.scale.z = 1 + Math.sin(e * Math.PI) * 0.1;
  });
  piece.rotation.set(0, 0, 0);
  piece.scale.set(1, 1, 1);
};

/** Bishop: a smooth diagonal glide, leaning into the line of travel like a blade drawn across the board. */
const bishopGlide: AttackFn = async (piece, from, to) => {
  const duration = ATTACK_DURATION_MS.b;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lean = Math.atan2(dx, dz);
  await tween(duration, (t) => {
    const e = Easing.easeInOutQuad(t);
    piece.position.x = THREE.MathUtils.lerp(from.x, to.x, e);
    piece.position.z = THREE.MathUtils.lerp(from.z, to.z, e);
    piece.position.y = 0.05 + Math.sin(t * Math.PI) * 0.1;
    const tilt = Math.sin(t * Math.PI) * 0.28;
    piece.rotation.x = Math.cos(lean) * tilt;
    piece.rotation.z = -Math.sin(lean) * tilt;
  });
  piece.rotation.set(0, 0, 0);
  piece.position.y = 0;
};

/** Rook: a heavy, rumbling straight-line charge, gathering speed and shaking the ground. */
const rookCharge: AttackFn = async (piece, from, to) => {
  const duration = ATTACK_DURATION_MS.r;
  await tween(duration, (t) => {
    const e = Easing.easeInCubic(t);
    piece.position.x = THREE.MathUtils.lerp(from.x, to.x, e);
    piece.position.z = THREE.MathUtils.lerp(from.z, to.z, e);
    const jitter = t > 0.15 ? (Math.random() - 0.5) * 0.03 * t : 0;
    piece.position.y = jitter;
    piece.rotation.z = jitter * 0.6;
  });
  piece.position.y = 0;
  piece.rotation.z = 0;
};

/** Queen: an elegant sweeping curve, arcing off the direct line, trailing light. */
const queenSweep: AttackFn = async (piece, from, to) => {
  const duration = ATTACK_DURATION_MS.q;
  const mx = (from.x + to.x) / 2;
  const mz = (from.z + to.z) / 2;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const bow = 0.55;
  const cx = mx + (-dz / len) * bow;
  const cz = mz + (dx / len) * bow;
  await tween(duration, (t) => {
    const e = Easing.easeInOutQuad(t);
    const u = 1 - e;
    piece.position.x = u * u * from.x + 2 * u * e * cx + e * e * to.x;
    piece.position.z = u * u * from.z + 2 * u * e * cz + e * e * to.z;
    piece.position.y = Math.sin(t * Math.PI) * 0.3;
    piece.rotation.y = Math.sin(t * Math.PI * 2) * 0.15;
  });
  piece.position.y = 0;
  piece.rotation.y = 0;
};

/** King: cautious and deliberate — a brief hesitation, then a measured single step. */
const kingStep: AttackFn = async (piece, from, to) => {
  await delay(140);
  const duration = ATTACK_DURATION_MS.k - 140;
  await tween(duration, (t) => {
    const e = Easing.easeInOutQuad(t);
    piece.position.x = THREE.MathUtils.lerp(from.x, to.x, e);
    piece.position.z = THREE.MathUtils.lerp(from.z, to.z, e);
    piece.position.y = Math.sin(t * Math.PI) * 0.1;
  });
  piece.position.y = 0;
};

const ATTACKS: Record<PieceType, AttackFn> = {
  p: pawnLunge,
  n: knightLeap,
  b: bishopGlide,
  r: rookCharge,
  q: queenSweep,
  k: kingStep,
};

export function playAttackerMotion(piece: THREE.Group, type: PieceType, from: Point, to: Point): Promise<void> {
  return ATTACKS[type](piece, from, to);
}
