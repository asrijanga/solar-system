import * as THREE from 'three';
import type { Color, MoveInfo, PieceType } from '../../types';
import { squareToWorld } from '../coords';
import type { PieceManager } from '../pieces/pieceManager';
import { buildPiece } from '../pieces/factory';
import { ATTACK_DURATION_MS, IMPACT_FRACTION, playAttackerMotion } from './attackerMotion';
import { playDefenderDeath } from './defenderDeath';
import { delay, Easing, tween } from './tween';

export interface MoveAnimatorCtx {
  scene: THREE.Scene;
  pieceLayer: THREE.Group;
  pieces: PieceManager;
}

function castleRookSquares(color: Color, side: 'king' | 'queen'): { from: string; to: string } {
  const rank = color === 'w' ? '1' : '8';
  return side === 'king' ? { from: `h${rank}`, to: `f${rank}` } : { from: `a${rank}`, to: `d${rank}` };
}

async function playCapture(
  ctx: MoveAnimatorCtx,
  attacker: THREE.Group,
  attackerType: PieceType,
  from: string,
  to: string,
  defender: THREE.Group | undefined,
  capturedType: PieceType,
  capturedColor: Color,
): Promise<void> {
  const fromPt = squareToWorld(from);
  const toPt = squareToWorld(to);

  const attackDone = playAttackerMotion(attacker, attackerType, fromPt, toPt);
  const impactDelay = ATTACK_DURATION_MS[attackerType] * IMPACT_FRACTION[attackerType];
  const deathDone = defender
    ? delay(impactDelay).then(() => playDefenderDeath(ctx.scene, defender, capturedType, capturedColor))
    : Promise.resolve();

  await Promise.all([attackDone, deathDone]);
  if (defender) ctx.pieces.destroy(defender);
}

async function playPromotionFlourish(ctx: MoveAnimatorCtx, square: string, type: PieceType, color: Color): Promise<void> {
  const old = ctx.pieces.take(square);
  if (old) ctx.pieces.destroy(old);

  const group = buildPiece(type, color);
  const { x, z } = squareToWorld(square);
  group.position.set(x, 0, z);
  group.scale.setScalar(0.001);
  ctx.pieceLayer.add(group);
  ctx.pieces.place(square, group);

  await tween(360, (t) => {
    const e = Easing.easeOutBack(t);
    group.scale.setScalar(Math.max(0.001, e));
  });
  group.scale.setScalar(1);
}

/** Animates one applied chess move end-to-end: the mover's motion, any capture's
 * death sequence, the second rook hop on castling, and a promotion flourish. */
export async function animateMove(ctx: MoveAnimatorCtx, move: MoveInfo): Promise<void> {
  const mover = ctx.pieces.get(move.from);
  if (!mover) return;

  // Pull the captured piece out of the board map *before* relocating the mover —
  // on an ordinary capture both moves target the same square, and relocate()
  // would otherwise silently overwrite the defender's map entry with the attacker's.
  const capturedSquare = move.isEnPassant ? `${move.to[0]}${move.from[1]}` : move.to;
  const defender = move.captured ? ctx.pieces.take(capturedSquare) : undefined;

  ctx.pieces.relocate(move.from, move.to);

  const rook = move.isCastle ? castleRookSquares(move.color, move.isCastle) : null;
  if (rook) ctx.pieces.relocate(rook.from, rook.to);

  const moveDone = move.captured
    ? playCapture(ctx, mover, move.piece, move.from, move.to, defender, move.captured, move.color === 'w' ? 'b' : 'w')
    : (() => {
        const fromPt = squareToWorld(move.from);
        const toPt = squareToWorld(move.to);
        return playAttackerMotion(mover, move.piece, fromPt, toPt);
      })();

  const rookMover = rook ? ctx.pieces.get(rook.to) : null;
  const rookDone = rookMover
    ? playAttackerMotion(rookMover, 'r', squareToWorld(rook!.from), squareToWorld(rook!.to))
    : Promise.resolve();

  await Promise.all([moveDone, rookDone]);

  if (move.promotion) {
    await playPromotionFlourish(ctx, move.to, move.promotion, move.color);
  }
}
