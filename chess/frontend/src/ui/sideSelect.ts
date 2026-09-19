import type { Color, Difficulty } from '../types';

export interface SideSelectResult {
  color: Color;
  difficulty: Difficulty;
}

const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: 'squire', label: 'Squire' },
  { id: 'knight', label: 'Knight' },
  { id: 'warlord', label: 'Warlord' },
];

export function showSideSelect(root: HTMLElement): Promise<SideSelectResult> {
  return new Promise((resolve) => {
    let color: Color = 'w';
    let difficulty: Difficulty = 'knight';

    const screen = document.createElement('div');
    screen.className = 'overlay-screen';
    screen.innerHTML = `
      <h1 class="select-title font-display">Obsidian &amp; Aurora</h1>
      <p class="select-subtitle">A chess board suspended in the void. Choose your army, then face an opponent that calculates every reply — a search-driven engine, not a script.</p>
      <div class="side-cards">
        <button type="button" class="side-card aurora selected" data-color="w">
          <span class="side-card__badge">&#9812;</span>
          <span class="side-card__name font-display">Aurora</span>
          <span class="side-card__desc">Ivory &amp; gold. Moves first.</span>
        </button>
        <button type="button" class="side-card obsidian" data-color="b">
          <span class="side-card__badge">&#9818;</span>
          <span class="side-card__name font-display">Obsidian</span>
          <span class="side-card__desc">Jet &amp; violet. Answers first.</span>
        </button>
      </div>
      <div class="difficulty-row" role="group" aria-label="Difficulty">
        ${DIFFICULTIES.map((d) => `<button type="button" class="difficulty-btn${d.id === difficulty ? ' active' : ''}" data-difficulty="${d.id}">${d.label}</button>`).join('')}
      </div>
      <button type="button" class="btn btn-primary select-begin font-display">Begin</button>
    `;
    root.appendChild(screen);

    const cards = Array.from(screen.querySelectorAll<HTMLButtonElement>('.side-card'));
    for (const card of cards) {
      card.addEventListener('click', () => {
        color = card.dataset.color as Color;
        for (const c of cards) c.classList.toggle('selected', c === card);
      });
    }

    const diffButtons = Array.from(screen.querySelectorAll<HTMLButtonElement>('.difficulty-btn'));
    for (const btn of diffButtons) {
      btn.addEventListener('click', () => {
        difficulty = btn.dataset.difficulty as Difficulty;
        for (const b of diffButtons) b.classList.toggle('active', b === btn);
      });
    }

    screen.querySelector('.select-begin')!.addEventListener('click', () => {
      screen.style.transition = 'opacity 0.35s ease';
      screen.style.opacity = '0';
      setTimeout(() => screen.remove(), 350);
      resolve({ color, difficulty });
    });
  });
}
