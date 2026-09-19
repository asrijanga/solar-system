import { Chess, type Move } from 'chess.js';
import { evaluate, PIECE_VALUE, MATE_SCORE } from './evaluate';
import type { Difficulty } from '../types';

interface SearchBudget {
  maxDepth: number;
  timeMs: number;
}

const BUDGETS: Record<Difficulty, SearchBudget> = {
  squire: { maxDepth: 2, timeMs: 450 },
  knight: { maxDepth: 3, timeMs: 1100 },
  warlord: { maxDepth: 4, timeMs: 2400 },
};

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a));
}

function scoreMoveForOrdering(move: Move): number {
  let score = 0;
  if (move.captured) {
    // MVV-LVA: most valuable victim, least valuable attacker.
    score += PIECE_VALUE[move.captured] * 10 - PIECE_VALUE[move.piece];
  }
  if (move.promotion) score += PIECE_VALUE[move.promotion];
  return score;
}

class TimeUp extends Error {}

function negamax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  perspective: 1 | -1,
  deadline: number,
): number {
  if (Date.now() > deadline) throw new TimeUp();

  if (depth === 0 || chess.isGameOver()) {
    return perspective * evaluate(chess);
  }

  const moves = orderMoves(chess.moves({ verbose: true }));
  let best = -Infinity;
  for (const move of moves) {
    chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    let score: number;
    try {
      score = -negamax(chess, depth - 1, -beta, -alpha, (-perspective) as 1 | -1, deadline);
    } finally {
      chess.undo();
    }
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export interface EngineResult {
  move: Move;
  depthReached: number;
  thinkMs: number;
  scoreCp: number;
}

/** Picks the engine's move via iterative-deepening negamax alpha-beta within a time budget. */
export function chooseEngineMove(chess: Chess, difficulty: Difficulty): EngineResult {
  const budget = BUDGETS[difficulty];
  const started = Date.now();
  const deadline = started + budget.timeMs;
  const perspective: 1 | -1 = chess.turn() === 'w' ? 1 : -1;

  const rootMoves = orderMoves(chess.moves({ verbose: true }));
  if (rootMoves.length === 0) {
    throw new Error('No legal moves available for engine');
  }

  let bestMove = rootMoves[0];
  let bestScore = -Infinity;
  let depthReached = 0;

  for (let depth = 1; depth <= budget.maxDepth; depth++) {
    let iterationBest = rootMoves[0];
    let iterationBestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;
    try {
      for (const move of rootMoves) {
        chess.move({ from: move.from, to: move.to, promotion: move.promotion });
        let score: number;
        try {
          score = -negamax(chess, depth - 1, -beta, -alpha, (-perspective) as 1 | -1, deadline);
        } finally {
          chess.undo();
        }
        if (score > iterationBestScore) {
          iterationBestScore = score;
          iterationBest = move;
        }
        if (score > alpha) alpha = score;
      }
    } catch (err) {
      if (err instanceof TimeUp) break;
      throw err;
    }

    bestMove = iterationBest;
    bestScore = iterationBestScore;
    depthReached = depth;

    // Found a forced mate, no need to search deeper.
    if (bestScore > MATE_SCORE - 1000) break;
    if (Date.now() > deadline) break;
  }

  return {
    move: bestMove,
    depthReached,
    thinkMs: Date.now() - started,
    scoreCp: bestScore,
  };
}
