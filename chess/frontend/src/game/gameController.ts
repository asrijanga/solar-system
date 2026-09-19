import * as THREE from 'three';
import type { Color, Difficulty, GameStateResponse, MoveInfo, PieceType } from '../types';
import { createGame, resignGame, submitMove } from '../api/client';
import { findKingSquare, parseFen } from './fen';
import { Board } from '../three/board';
import { PieceManager } from '../three/pieces/pieceManager';
import { animateMove } from '../three/animation/moveAnimator';
import { Hud, showGameOverModal } from '../ui/hud';
import { askPromotion } from '../ui/promotion';
import { showBattleBanner } from '../ui/battleBanner';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface GameControllerCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  board: Board;
  uiRoot: HTMLElement;
}

export class GameController {
  private state: GameStateResponse;
  private readonly pieces: PieceManager;
  private readonly hud: Hud;
  private selected: string | null = null;
  private busy = true;
  private capturedByWhite: PieceType[] = [];
  private capturedByBlack: PieceType[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private disposed = false;
  onRestart: (() => void) | null = null;

  private constructor(
    private readonly ctx: GameControllerCtx,
    initialState: GameStateResponse,
  ) {
    this.state = initialState;
    this.pieces = new PieceManager(ctx.board.pieceLayer);
    this.hud = new Hud(ctx.uiRoot, initialState.difficulty, {
      onResign: () => void this.handleResign(),
    });
    ctx.board.setOrientation(initialState.playerColor);
    ctx.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
  }

  static async start(ctx: GameControllerCtx, color: Color, difficulty: Difficulty): Promise<GameController> {
    const state = await createGame(color, difficulty);
    const controller = new GameController(ctx, state);
    await controller.intro();
    return controller;
  }

  private async intro(): Promise<void> {
    this.pieces.setBoard(parseFen(START_FEN));
    await showBattleBanner(this.ctx.uiRoot, 'Let the battle begin');
    if (this.state.engineMove) {
      await animateMove(this.animCtx(), this.state.engineMove);
      this.trackCapture(this.state.engineMove);
    } else {
      this.pieces.setBoard(parseFen(this.state.fen));
    }
    this.refreshHud();
    this.busy = false;
  }

  private animCtx() {
    return { scene: this.ctx.scene, pieceLayer: this.ctx.board.pieceLayer, pieces: this.pieces };
  }

  private trackCapture(move: MoveInfo): void {
    if (!move.captured) return;
    if (move.color === 'w') this.capturedByWhite.push(move.captured);
    else this.capturedByBlack.push(move.captured);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.busy || this.disposed) return;
    if (event.button !== undefined && event.button !== 0) return;

    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.ctx.camera);
    const hit = this.raycaster.intersectObject(this.ctx.board.pickTarget, false)[0];
    if (!hit) return;
    const square = this.ctx.board.squareFromWorldPoint(hit.point);
    if (square) void this.onSquareTapped(square);
  };

  private async onSquareTapped(square: string): Promise<void> {
    if (this.state.status !== 'active' || this.state.turn !== this.state.playerColor) return;

    const legalFromHere = this.state.legalMoves.filter((m) => m.from === this.selected);
    const chosen = this.selected ? legalFromHere.find((m) => m.to === square) : undefined;

    if (chosen) {
      await this.commitPlayerMove(chosen.from, chosen.to);
      return;
    }

    const ownPieceHere = this.pieces.has(square) && this.squareOwnedByPlayer(square);
    if (ownPieceHere) {
      this.select(square);
    } else {
      this.select(null);
    }
  }

  private squareOwnedByPlayer(square: string): boolean {
    return this.hasPlayerPieceAt(square);
  }

  private hasPlayerPieceAt(square: string): boolean {
    const grid = parseFen(this.state.fen);
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1], 10);
    const cell = grid[8 - rank]?.[file];
    return !!cell && cell.color === this.state.playerColor;
  }

  private select(square: string | null): void {
    this.selected = square;
    this.ctx.board.showSelection(square);
    if (!square) {
      this.ctx.board.showLegalTargets([], []);
      return;
    }
    const moves = this.state.legalMoves.filter((m) => m.from === square);
    const quiet = moves.filter((m) => !m.captured).map((m) => m.to);
    const captures = moves.filter((m) => m.captured).map((m) => m.to);
    this.ctx.board.showLegalTargets(quiet, captures);
  }

  private async commitPlayerMove(from: string, to: string): Promise<void> {
    this.busy = true;
    this.select(null);

    const candidates = this.state.legalMoves.filter((m) => m.from === from && m.to === to);
    let promotion: PieceType | undefined;
    if (candidates.length > 1) {
      promotion = await askPromotion(this.ctx.uiRoot, this.state.playerColor);
    } else if (candidates[0]?.promotion) {
      promotion = candidates[0].promotion;
    }
    const chosenMove = candidates.find((m) => (promotion ? m.promotion === promotion : true)) ?? candidates[0];

    this.hud.setResignEnabled(false);
    const opponentColor: Color = this.state.playerColor === 'w' ? 'b' : 'w';
    this.hud.setTurn(opponentColor, this.state.playerColor, true);

    const animPromise = animateMove(this.animCtx(), chosenMove);
    this.trackCapture(chosenMove);

    try {
      const [response] = await Promise.all([submitMove(this.state.gameId, from, to, promotion), animPromise]);
      this.state = response;

      if (response.status !== 'active') {
        this.refreshHud();
        await this.endGame();
        return;
      }

      if (response.engineMove) {
        await animateMove(this.animCtx(), response.engineMove);
        this.trackCapture(response.engineMove);
      }
      this.refreshHud();
      if (response.status !== 'active') {
        await this.endGame();
        return;
      }
    } catch (err) {
      this.hud.showToast(err instanceof Error ? err.message : 'Move failed — try again');
      await this.resync();
    } finally {
      this.hud.setResignEnabled(true);
      this.busy = false;
    }
  }

  private async resync(): Promise<void> {
    this.pieces.setBoard(parseFen(this.state.fen));
    this.refreshHud();
  }

  private refreshHud(): void {
    this.hud.setTurn(this.state.turn, this.state.playerColor, false);
    this.hud.setCheck(this.state.isCheck);
    this.hud.setCaptured(this.capturedByWhite, this.capturedByBlack);
    this.ctx.board.showCheck(this.state.isCheck ? findKingSquare(parseFen(this.state.fen), this.state.turn) : null);
  }

  private async handleResign(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.state = await resignGame(this.state.gameId);
    } catch {
      this.state = { ...this.state, status: 'resigned', winner: this.state.turn === this.state.playerColor ? (this.state.playerColor === 'w' ? 'b' : 'w') : this.state.winner };
    }
    await this.endGame();
  }

  private async endGame(): Promise<void> {
    this.hud.setTurn(this.state.turn, this.state.playerColor, false);
    await showGameOverModal(this.ctx.uiRoot, this.state.status, this.state.winner, this.state.playerColor);
    this.dispose();
    this.onRestart?.();
  }

  dispose(): void {
    this.disposed = true;
    this.ctx.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.hud.dispose();
    this.pieces.clear();
    this.ctx.board.showSelection(null);
    this.ctx.board.showLegalTargets([], []);
    this.ctx.board.showCheck(null);
  }
}
