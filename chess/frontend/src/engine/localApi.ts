import { createGameSession, deriveStatus, getGameSession, type GameSession } from './store';
import { toMoveInfo } from './moveInfo';
import { requestEngineMove } from './workerClient';
import type { Color, Difficulty, GameStateResponse, MoveInfo } from '../types';

function isColor(v: unknown): v is Color {
  return v === 'w' || v === 'b';
}

function legalMoves(session: GameSession): MoveInfo[] {
  if (deriveStatus(session.chess) !== 'active') return [];
  return session.chess.moves({ verbose: true }).map(toMoveInfo);
}

function winnerOf(session: GameSession): Color | null {
  if (session.status === 'checkmate') {
    return session.chess.turn() === 'w' ? 'b' : 'w';
  }
  return null;
}

function buildState(
  session: GameSession,
  extra?: { playerMove?: MoveInfo; engineMove?: MoveInfo; engineThinkMs?: number },
): GameStateResponse {
  return {
    gameId: session.id,
    fen: session.chess.fen(),
    turn: session.chess.turn(),
    playerColor: session.playerColor,
    difficulty: session.difficulty,
    status: session.status,
    isCheck: session.chess.isCheck(),
    winner: winnerOf(session),
    legalMoves: legalMoves(session),
    ...extra,
  };
}

async function runEngineTurn(session: GameSession): Promise<MoveInfo | undefined> {
  session.status = deriveStatus(session.chess);
  if (session.status !== 'active') return undefined;
  if (session.chess.turn() === session.playerColor) return undefined;

  const result = await requestEngineMove(session.chess.fen(), session.difficulty);
  const move = session.chess.move({ from: result.from, to: result.to, promotion: result.promotion });
  session.status = deriveStatus(session.chess);
  return toMoveInfo(move);
}

function requireSession(gameId: string): GameSession {
  const session = getGameSession(gameId);
  if (!session) throw new Error('Game not found');
  return session;
}

export async function createGame(color: unknown, difficulty: Difficulty): Promise<GameStateResponse> {
  const playerColor: Color = isColor(color) ? color : 'w';
  const session = createGameSession(playerColor, difficulty);

  let engineMove: MoveInfo | undefined;
  let engineThinkMs: number | undefined;
  if (session.chess.turn() !== session.playerColor) {
    const started = performance.now();
    engineMove = await runEngineTurn(session);
    engineThinkMs = performance.now() - started;
  }

  return buildState(session, { engineMove, engineThinkMs });
}

export async function submitMove(
  gameId: string,
  from: string,
  to: string,
  promotion?: string,
): Promise<GameStateResponse> {
  const session = requireSession(gameId);
  if (session.status !== 'active') throw new Error('Game is already over');
  if (session.chess.turn() !== session.playerColor) throw new Error('Not your turn');

  let playerMoveResult;
  try {
    playerMoveResult = session.chess.move({ from, to, promotion });
  } catch {
    throw new Error('Illegal move');
  }

  const playerMove = toMoveInfo(playerMoveResult);
  session.status = deriveStatus(session.chess);

  const started = performance.now();
  const engineMove = await runEngineTurn(session);
  const engineThinkMs = engineMove ? performance.now() - started : undefined;

  return buildState(session, { playerMove, engineMove, engineThinkMs });
}

export async function resignGame(gameId: string): Promise<GameStateResponse> {
  const session = requireSession(gameId);
  session.status = 'resigned';
  return buildState(session);
}

export async function fetchGame(gameId: string): Promise<GameStateResponse> {
  return buildState(requireSession(gameId));
}
