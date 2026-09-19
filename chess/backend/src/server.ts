import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { chooseEngineMove } from './engine/search.js';
import { createGame, deleteGame, deriveStatus, getGame, type GameSession } from './game/store.js';
import { toMoveInfo } from './game/moveInfo.js';
import type { Color, Difficulty, GameStateResponse, MoveInfo } from './types.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 8787);

function isColor(v: unknown): v is Color {
  return v === 'w' || v === 'b';
}

function isDifficulty(v: unknown): v is Difficulty {
  return v === 'squire' || v === 'knight' || v === 'warlord';
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

function runEngineTurn(session: GameSession): MoveInfo | undefined {
  session.status = deriveStatus(session.chess);
  if (session.status !== 'active') return undefined;
  if (session.chess.turn() === session.playerColor) return undefined;

  const result = chooseEngineMove(session.chess, session.difficulty);
  const move = session.chess.move({
    from: result.move.from,
    to: result.move.to,
    promotion: result.move.promotion,
  });
  session.status = deriveStatus(session.chess);
  return toMoveInfo(move);
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post('/api/games', (req: Request, res: Response) => {
  const { color, difficulty } = req.body ?? {};
  const playerColor: Color = isColor(color) ? color : 'w';
  const chosenDifficulty: Difficulty = isDifficulty(difficulty) ? difficulty : 'knight';

  const session = createGame(playerColor, chosenDifficulty);
  let engineMove: MoveInfo | undefined;
  let engineThinkMs: number | undefined;

  if (session.chess.turn() !== session.playerColor) {
    const started = Date.now();
    engineMove = runEngineTurn(session);
    engineThinkMs = Date.now() - started;
  }

  res.status(201).json(buildState(session, { engineMove, engineThinkMs }));
});

app.get('/api/games/:id', (req: Request, res: Response) => {
  const session = getGame(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Game not found' });
    return;
  }
  res.json(buildState(session));
});

app.post('/api/games/:id/move', (req: Request, res: Response) => {
  const session = getGame(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Game not found' });
    return;
  }
  if (session.status !== 'active') {
    res.status(409).json({ error: 'Game is already over', state: buildState(session) });
    return;
  }
  if (session.chess.turn() !== session.playerColor) {
    res.status(409).json({ error: 'Not your turn' });
    return;
  }

  const { from, to, promotion } = req.body ?? {};
  if (typeof from !== 'string' || typeof to !== 'string') {
    res.status(400).json({ error: 'from and to are required' });
    return;
  }

  let playerMoveResult;
  try {
    playerMoveResult = session.chess.move({
      from,
      to,
      promotion: typeof promotion === 'string' ? promotion : undefined,
    });
  } catch {
    res.status(400).json({ error: 'Illegal move' });
    return;
  }

  const playerMove = toMoveInfo(playerMoveResult);
  session.status = deriveStatus(session.chess);

  const started = Date.now();
  const engineMove = runEngineTurn(session);
  const engineThinkMs = engineMove ? Date.now() - started : undefined;

  res.json(buildState(session, { playerMove, engineMove, engineThinkMs }));
});

app.post('/api/games/:id/resign', (req: Request, res: Response) => {
  const session = getGame(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Game not found' });
    return;
  }
  session.status = 'resigned';
  res.json(buildState(session));
});

app.delete('/api/games/:id', (req: Request, res: Response) => {
  deleteGame(req.params.id);
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Chess engine server listening on http://localhost:${PORT}`);
});
