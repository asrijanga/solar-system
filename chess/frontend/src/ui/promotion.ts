import type { Color, PieceType } from '../types';

const GLYPHS: Record<Color, Record<PieceType, string>> = {
  w: { q: '♕', r: '♖', b: '♗', n: '♘', p: '♙', k: '♔' },
  b: { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟', k: '♚' },
};

const CHOICES: PieceType[] = ['q', 'r', 'b', 'n'];

export function askPromotion(root: HTMLElement, color: Color): Promise<PieceType> {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim';
    scrim.innerHTML = `
      <div class="panel promotion-panel">
        <div class="promotion-title">Promote to</div>
        <div class="promotion-choices">
          ${CHOICES.map((c) => `<button type="button" class="promotion-choice" data-piece="${c}">${GLYPHS[color][c]}</button>`).join('')}
        </div>
      </div>
    `;
    root.appendChild(scrim);

    for (const btn of Array.from(scrim.querySelectorAll<HTMLButtonElement>('.promotion-choice'))) {
      btn.addEventListener('click', () => {
        scrim.remove();
        resolve(btn.dataset.piece as PieceType);
      });
    }
  });
}
