export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Color = 'w' | 'b';
export type CastleSide = 'king' | 'queen' | null;

export interface MoveInfo {
  from: string;
  to: string;
  piece: PieceType;
  color: Color;
  captured?: PieceType;
  promotion?: PieceType;
  isEnPassant: boolean;
  isCastle: CastleSide;
  san: string;
}

export type GameStatus = 'active' | 'checkmate' | 'stalemate' | 'draw' | 'resigned';

export interface GameStateResponse {
  gameId: string;
  fen: string;
  turn: Color;
  playerColor: Color;
  difficulty: Difficulty;
  status: GameStatus;
  isCheck: boolean;
  winner: Color | null;
  playerMove?: MoveInfo;
  engineMove?: MoveInfo;
  engineThinkMs?: number;
  legalMoves: MoveInfo[];
}

export type Difficulty = 'squire' | 'knight' | 'warlord';
