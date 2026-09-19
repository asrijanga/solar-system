export type Easing = (t: number) => number;

export const Easing = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInCubic: (t: number) => t * t * t,
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  easeInBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
} as const;

/** Runs onUpdate(easedT) across `durationMs`, resolving when complete. */
export function tween(durationMs: number, onUpdate: (t: number) => void, easing: Easing = Easing.linear): Promise<void> {
  return new Promise((resolve) => {
    if (durationMs <= 0) {
      onUpdate(1);
      resolve();
      return;
    }
    const start = performance.now();
    function frame(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      onUpdate(easing(t));
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
