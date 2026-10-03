/**
 * A two-state switch. While it is on, `onNote` names the departure from physics, on screen,
 * for as long as it lasts.
 */
export function createToggle(
  labels: { readonly off: string; readonly on: string },
  onNote: string | null,
  notes: HTMLElement,
  onChange: (on: boolean) => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  const note = document.createElement('p');
  note.className = 'note warning';
  note.textContent = onNote ?? '';
  let on = false;
  const set = (value: boolean): void => {
    on = value;
    button.textContent = on ? labels.on : labels.off;
    button.setAttribute('aria-pressed', String(on));
    if (on && onNote !== null) notes.append(note);
    else note.remove();
    onChange(on);
  };
  button.addEventListener('click', () => set(!on));
  set(false);
  return button;
}

/**
 * Links to the page's instants (docs/stories/SS-13f.md): `?epoch=` absent is now. The one shown is
 * plain text, the others links.
 */
export function createDateLinks(
  choices: readonly (readonly [string | null, string])[],
  current: string | null,
): HTMLElement {
  const dates = document.createElement('span');
  dates.className = 'dates';
  for (const [value, label] of choices) {
    const next = new URLSearchParams(location.search);
    if (value === null) next.delete('epoch');
    else next.set('epoch', value);
    const query = next.toString();
    const item = document.createElement(value === current ? 'span' : 'a');
    if (item instanceof HTMLAnchorElement) {
      item.href = query === '' ? location.pathname : `?${query}`;
    } else {
      item.setAttribute('aria-current', 'true');
    }
    item.textContent = label;
    dates.append(item);
  }
  return dates;
}
