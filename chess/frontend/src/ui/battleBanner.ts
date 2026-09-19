const LINES = ['Let the battle begin'];

export function showBattleBanner(root: HTMLElement, text: string = LINES[0]): Promise<void> {
  return new Promise((resolve) => {
    const banner = document.createElement('div');
    banner.className = 'battle-banner';
    banner.innerHTML = `<div class="battle-banner__text font-display">${text}</div>`;
    root.appendChild(banner);
    const label = banner.querySelector<HTMLElement>('.battle-banner__text')!;

    requestAnimationFrame(() => {
      label.style.transition = 'opacity 0.7s ease, transform 0.7s cubic-bezier(0.2, 0.8, 0.2, 1)';
      label.style.opacity = '1';
      label.style.transform = 'scale(1)';
    });

    setTimeout(() => {
      label.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      label.style.opacity = '0';
      label.style.transform = 'scale(1.08)';
      setTimeout(() => {
        banner.remove();
        resolve();
      }, 600);
    }, 1500);
  });
}
