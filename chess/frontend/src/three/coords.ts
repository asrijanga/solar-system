export const SQUARE_SIZE = 1;

export function fileIndex(square: string): number {
  return square.charCodeAt(0) - 'a'.charCodeAt(0);
}

export function rankIndex(square: string): number {
  return parseInt(square[1], 10) - 1;
}

/** World-space X/Z for the center of a square, board centered on the origin. */
export function squareToWorld(square: string): { x: number; z: number } {
  const f = fileIndex(square);
  const r = rankIndex(square);
  return {
    x: (f - 3.5) * SQUARE_SIZE,
    z: (3.5 - r) * SQUARE_SIZE,
  };
}

export function squareName(file: number, rank: number): string {
  return `${String.fromCharCode('a'.charCodeAt(0) + file)}${rank + 1}`;
}

export function isLightSquare(file: number, rank: number): boolean {
  return (file + rank) % 2 === 1;
}
