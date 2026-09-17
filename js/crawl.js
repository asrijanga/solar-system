// The opening crawl.
//
// A blue preamble, then a block of text receding up a tilted plane into the
// distance, in the manner of a certain 1977 title sequence. The effect is pure
// CSS: a perspective container, the text rotated back about the X axis, and a
// translate along its own tilted Y so it slides away from the viewer rather than
// simply up the screen. A gradient mask at the top swallows it as it goes.
//
// Everything here is presentation, so it lives outside the render loop. The only
// contract with the rest of the app is the promise: it resolves true if the
// viewer skipped, false if the crawl played out.

export const CRAWL_SECONDS = 27;
const PREAMBLE_SECONDS = 5;

export function playCrawl({ root, skipBtn }) {
  return new Promise(resolve => {
    let finished = false;

    const finish = skipped => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      skipBtn?.removeEventListener('click', onSkip);
      root.classList.remove('show');
      root.classList.add('fading');
      setTimeout(() => { root.classList.remove('fading', 'running'); }, 1300);
      resolve(skipped);
    };

    const onSkip = () => finish(true);
    const onKey = e => { if (e.key === 'Escape') finish(true); };

    // Restart the CSS animations cleanly on a replay.
    root.classList.remove('show', 'running', 'fading');
    void root.offsetWidth;
    root.classList.add('show');
    requestAnimationFrame(() => root.classList.add('running'));

    if (skipBtn) { skipBtn.classList.add('show'); skipBtn.addEventListener('click', onSkip); }
    window.addEventListener('keydown', onKey);

    const timer = setTimeout(() => finish(false), (PREAMBLE_SECONDS + CRAWL_SECONDS) * 1000);
  });
}
