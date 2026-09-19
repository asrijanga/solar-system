import type { BoardGrid, Color, PieceType } from '../types';

/** Parses the piece-placement field of a FEN into an 8x8 grid, row 0 = rank 8. */
export function parseFen(fen: string): BoardGrid {
  const placement = fen.split(' ')[0];
  const rows = placement.split('/');
  return rows.map((row) => {
    const cells: BoardGrid[number] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        const empties = parseInt(ch, 10);
        for (let i = 0; i < empties; i++) cells.push(null);
      } else {
        const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
        cells.push({ type: ch.toLowerCase() as PieceType, color });
      }
    }
    return cells;
  });
}

export function pieceAt(grid: BoardGrid, square: string): { type: PieceType; color: Color } | null {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = parseInt(square[1], 10);
  const row = 8 - rank;
  return grid[row]?.[file] ?? null;
}

export function findKingSquare(grid: BoardGrid, color: Color): string | null {
  let found: string | null = null;
  forEachSquare(grid, (square, piece) => {
    if (piece.type === 'k' && piece.color === color) found = square;
  });
  return found;
}

export function forEachSquare(grid: BoardGrid, fn: (square: string, piece: { type: PieceType; color: Color }) => void): void {
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      const cell = grid[row][file];
      if (!cell) continue;
      const rank = 8 - row;
      const square = `${String.fromCharCode('a'.charCodeAt(0) + file)}${rank}`;
      fn(square, cell);
    }
  }
}
