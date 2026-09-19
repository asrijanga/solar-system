import { Chess } from 'chess.js';
import type { Color, Difficulty, GameStatus } from '../types';

export interface GameSession {
  id: string;
  chess: Chess;
  playerColor: Color;
  difficulty: Difficulty;
  status: GameStatus;
}

const games = new Map<string, GameSession>();

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `game-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createGameSession(playerColor: Color, difficulty: Difficulty): GameSession {
  const session: GameSession = {
    id: makeId(),
    chess: new Chess(),
    playerColor,
    difficulty,
    status: 'active',
  };
  games.set(session.id, session);
  return session;
}

export function getGameSession(id: string): GameSession | undefined {
  return games.get(id);
}

export function deriveStatus(chess: Chess): GameStatus {
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isDraw()) return 'draw';
  return 'active';
}
