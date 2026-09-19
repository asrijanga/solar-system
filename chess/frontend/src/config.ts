export const IS_TOUCH: boolean =
  typeof window !== 'undefined' &&
  (('ontouchstart' in window) || navigator.maxTouchPoints > 0);

export const IS_SMALL_SCREEN: boolean =
  typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 700;

/** Theme: "Obsidian & Aurora" — obsidian-black vs ivory-and-gold armies, on a
 * sunlit marble terrace: warm daylight, a pale sky, and a polished stone board. */
export const THEME = {
  bg: 0xeef2f6,
  skyTop: 0xaed4f0,
  skyHorizon: 0xfbf3e3,
  fogColor: 0xf3ecdd,
  boardLight: 0xf8f1e1,
  boardDark: 0x8a6a49,
  boardEdge: 0xe9dcc0,
  groundColor: 0xe6ddc9,
  obsidian: {
    base: 0x211c26,
    emissive: 0x7c3aed,
    accent: 0xb98cff,
  },
  aurora: {
    base: 0xfbf4e4,
    emissive: 0xc9862f,
    accent: 0xffcf6b,
  },
  selectGlow: 0x1fb391,
  moveDot: 0x1fb391,
  captureRing: 0xe0483f,
  checkGlow: 0xe0483f,
} as const;
