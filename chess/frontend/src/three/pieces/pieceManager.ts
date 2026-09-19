import * as THREE from 'three';
import type { BoardGrid } from '../../types';
import { forEachSquare } from '../../game/fen';
import { squareToWorld } from '../coords';
import { buildPiece } from './factory';

export class PieceManager {
  private readonly bySquare = new Map<string, THREE.Group>();

  constructor(private readonly layer: THREE.Group) {}

  get(square: string): THREE.Group | undefined {
    return this.bySquare.get(square);
  }

  has(square: string): boolean {
    return this.bySquare.has(square);
  }

  /** Destroys every tracked piece, e.g. when a GameController hands the board off. */
  clear(): void {
    for (const group of this.bySquare.values()) this.destroy(group);
    this.bySquare.clear();
  }

  /** Clears the board and places pieces fresh from a board grid, with no animation. */
  setBoard(grid: BoardGrid): void {
    this.clear();

    forEachSquare(grid, (square, piece) => {
      const group = buildPiece(piece.type, piece.color);
      const { x, z } = squareToWorld(square);
      group.position.set(x, 0, z);
      this.layer.add(group);
      this.bySquare.set(square, group);
    });
  }

  /** Removes a piece's bookkeeping entry (used right before a capture animation destroys it). */
  take(square: string): THREE.Group | undefined {
    const group = this.bySquare.get(square);
    if (group) this.bySquare.delete(square);
    return group;
  }

  /** Re-keys a piece's square without touching its transform (animation drives position). */
  relocate(from: string, to: string): void {
    const group = this.bySquare.get(from);
    if (!group) return;
    this.bySquare.delete(from);
    this.bySquare.set(to, group);
  }

  place(square: string, group: THREE.Group): void {
    this.bySquare.set(square, group);
  }

  spawn(type: Parameters<typeof buildPiece>[0], color: Parameters<typeof buildPiece>[1], square: string): THREE.Group {
    const group = buildPiece(type, color);
    const { x, z } = squareToWorld(square);
    group.position.set(x, 0, z);
    this.layer.add(group);
    this.bySquare.set(square, group);
    return group;
  }

  destroy(group: THREE.Group): void {
    this.layer.remove(group);
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) mat.dispose();
      }
    });
  }
}
