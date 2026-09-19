import type { Move } from 'chess.js';
import type { MoveInfo } from '../types.js';

export function toMoveInfo(move: Move): MoveInfo {
  return {
    from: move.from,
    to: move.to,
    piece: move.piece,
    color: move.color,
    captured: move.captured,
    promotion: move.promotion,
    isEnPassant: move.isEnPassant(),
    isCastle: move.isKingsideCastle() ? 'king' : move.isQueensideCastle() ? 'queen' : null,
    san: move.san,
  };
}
