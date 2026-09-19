import { Chess } from 'chess.js';
import type { Color, Difficulty, GameStatus } from '../types.js';

export interface GameSession {
  id: string;
  chess: Chess;
  playerColor: Color;
  difficulty: Difficulty;
  status: GameStatus;
  createdAt: number;
  lastActive: number;
}

const games = new Map<string, GameSession>();

const MAX_AGE_MS = 1000 * 60 * 60 * 6; // 6 hours

function sweepStale() {
  const now = Date.now();
  for (const [id, session] of games) {
    if (now - session.lastActive > MAX_AGE_MS) games.delete(id);
  }
}

export function createGame(playerColor: Color, difficulty: Difficulty): GameSession {
  sweepStale();
  const id = crypto.randomUUID();
  const session: GameSession = {
    id,
    chess: new Chess(),
    playerColor,
    difficulty,
    status: 'active',
    createdAt: Date.now(),
    lastActive: Date.now(),
  };
  games.set(id, session);
  return session;
}

export function getGame(id: string): GameSession | undefined {
  const session = games.get(id);
  if (session) session.lastActive = Date.now();
  return session;
}

export function deleteGame(id: string): void {
  games.delete(id);
}

export function deriveStatus(chess: Chess): GameStatus {
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isDraw()) return 'draw';
  return 'active';
}
