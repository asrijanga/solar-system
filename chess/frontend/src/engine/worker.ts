import { Chess } from 'chess.js';
import { chooseEngineMove } from './search';
import type { Difficulty } from '../types';

export interface EngineWorkerRequest {
  id: number;
  fen: string;
  difficulty: Difficulty;
}

export interface EngineWorkerResponse {
  id: number;
  from: string;
  to: string;
  promotion?: string;
  thinkMs: number;
}

// Cast rather than pull in the "webworker" lib: this file's tsconfig also covers
// main-thread DOM code, and the two lib sets declare conflicting globals.
const ctx = self as unknown as {
  postMessage: (message: EngineWorkerResponse) => void;
  onmessage: ((event: MessageEvent<EngineWorkerRequest>) => void) | null;
};

ctx.onmessage = (event: MessageEvent<EngineWorkerRequest>) => {
  const { id, fen, difficulty } = event.data;
  const chess = new Chess(fen);
  const result = chooseEngineMove(chess, difficulty);
  ctx.postMessage({
    id,
    from: result.move.from,
    to: result.move.to,
    promotion: result.move.promotion,
    thinkMs: result.thinkMs,
  });
};
