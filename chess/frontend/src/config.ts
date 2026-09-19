export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export const IS_TOUCH: boolean =
  typeof window !== 'undefined' &&
  (('ontouchstart' in window) || navigator.maxTouchPoints > 0);

export const IS_SMALL_SCREEN: boolean =
  typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 700;

/** Theme: "Obsidian & Aurora" — obsidian black vs pearl-ivory armies, glass board, violet/gold glow, floating in a starlit void. */
export const THEME = {
  bg: 0x05040a,
  fogColor: 0x05040a,
  boardLight: 0xe9e2cf,
  boardDark: 0x171225,
  boardEdge: 0x0c0a16,
  obsidian: {
    base: 0x0c0a12,
    emissive: 0x7c3aed,
    accent: 0xb98cff,
  },
  aurora: {
    base: 0xf3ecd9,
    emissive: 0xc9a24b,
    accent: 0xffe3a3,
  },
  selectGlow: 0x38f0c8,
  moveDot: 0x38f0c8,
  captureRing: 0xff5c5c,
  checkGlow: 0xff3b3b,
} as const;
