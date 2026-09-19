import type { Color, Difficulty, GameStatus, PieceType } from '../types';

const PIECE_GLYPH: Record<Color, Record<PieceType, string>> = {
  w: { q: '♕', r: '♖', b: '♗', n: '♘', p: '♙', k: '♔' },
  b: { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟', k: '♚' },
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  squire: 'Squire',
  knight: 'Knight',
  warlord: 'Warlord',
};

export interface HudCallbacks {
  onResign: () => void;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly turnPill: HTMLElement;
  private readonly turnLabel: HTMLElement;
  private readonly checkFlag: HTMLElement;
  private readonly capturedByWhite: HTMLElement;
  private readonly capturedByBlack: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly resignBtn: HTMLButtonElement;
  private toastTimer: number | undefined;
  private resignArmed = false;
  private resignTimer: number | undefined;

  constructor(root: HTMLElement, difficulty: Difficulty, callbacks: HudCallbacks) {
    this.root = document.createElement('div');
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="turn-pill panel">
          <span class="turn-pill__dot"></span>
          <span class="turn-pill__spinner"></span>
          <span class="turn-pill__label">Your move</span>
        </div>
        <div class="hud-actions">
          <button type="button" class="btn btn-small resign-btn">Resign</button>
        </div>
      </div>
      <div class="check-flag">Check</div>
      <div class="captured-tray">
        <div class="captured-side captured-by-white"></div>
        <div class="captured-side captured-by-black"></div>
      </div>
      <div class="toast panel"></div>
      <div class="hint-text">Tap a piece, then tap a glowing square · Drag to orbit · Pinch to zoom · ${DIFFICULTY_LABEL[difficulty]} engine</div>
    `;
    root.appendChild(this.root);

    this.turnPill = this.root.querySelector('.turn-pill')!;
    this.turnLabel = this.root.querySelector('.turn-pill__label')!;
    this.checkFlag = this.root.querySelector('.check-flag')!;
    this.capturedByWhite = this.root.querySelector('.captured-by-white')!;
    this.capturedByBlack = this.root.querySelector('.captured-by-black')!;
    this.toast = this.root.querySelector('.toast')!;
    this.resignBtn = this.root.querySelector('.resign-btn')!;

    this.resignBtn.addEventListener('click', () => {
      if (!this.resignArmed) {
        this.resignArmed = true;
        this.resignBtn.textContent = 'Confirm?';
        this.resignBtn.classList.add('btn-danger');
        window.clearTimeout(this.resignTimer);
        this.resignTimer = window.setTimeout(() => this.disarmResign(), 3600);
        return;
      }
      this.disarmResign();
      callbacks.onResign();
    });
  }

  private disarmResign(): void {
    this.resignArmed = false;
    this.resignBtn.textContent = 'Resign';
    this.resignBtn.classList.remove('btn-danger');
  }

  setTurn(turn: Color, playerColor: Color, thinking: boolean): void {
    this.turnPill.classList.toggle('is-black', turn === 'b');
    this.turnPill.classList.toggle('thinking', thinking);
    if (thinking) {
      this.turnLabel.textContent = turn === 'w' ? 'Aurora is thinking…' : 'Obsidian is thinking…';
    } else {
      this.turnLabel.textContent = turn === playerColor ? 'Your move' : 'Opponent to move';
    }
  }

  setCheck(inCheck: boolean): void {
    this.checkFlag.classList.toggle('show', inCheck);
  }

  setCaptured(byWhite: PieceType[], byBlack: PieceType[]): void {
    this.capturedByWhite.innerHTML = byWhite.map((p) => `<span class="captured-piece">${PIECE_GLYPH.b[p]}</span>`).join('');
    this.capturedByBlack.innerHTML = byBlack.map((p) => `<span class="captured-piece">${PIECE_GLYPH.w[p]}</span>`).join('');
  }

  showToast(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 3200);
  }

  setResignEnabled(enabled: boolean): void {
    this.resignBtn.disabled = !enabled;
  }

  dispose(): void {
    this.root.remove();
  }
}

export function showGameOverModal(
  root: HTMLElement,
  status: GameStatus,
  winner: Color | null,
  playerColor: Color,
): Promise<void> {
  return new Promise((resolve) => {
    let title = 'Game Over';
    let sub = '';
    if (status === 'checkmate') {
      const won = winner === playerColor;
      title = won ? 'Victory' : 'Checkmate';
      sub = won ? 'The engine has been outplayed.' : 'Your king has fallen.';
    } else if (status === 'stalemate') {
      title = 'Stalemate';
      sub = 'No legal moves remain — the game is drawn.';
    } else if (status === 'draw') {
      title = 'Draw';
      sub = 'The armies fight to a standstill.';
    } else if (status === 'resigned') {
      title = winner === playerColor ? 'Victory' : 'You Resigned';
      sub = winner === playerColor ? 'The engine has resigned.' : 'The engine claims the board.';
    }

    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim';
    scrim.innerHTML = `
      <div class="panel game-over-panel">
        <div class="game-over-title font-display">${title}</div>
        <div class="game-over-sub">${sub}</div>
        <div class="game-over-actions">
          <button type="button" class="btn btn-primary play-again">New Match</button>
        </div>
      </div>
    `;
    root.appendChild(scrim);
    scrim.querySelector('.play-again')!.addEventListener('click', () => {
      scrim.remove();
      resolve();
    });
  });
}
