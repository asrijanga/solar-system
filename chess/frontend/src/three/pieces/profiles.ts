import * as THREE from 'three';

/** Lathe silhouettes (radius, height), bottom to top. Every profile ends at r=0
 * so the revolve closes cleanly into a point/dome — no visible hole from above. */
const RAW_PROFILES: Record<string, [number, number][]> = {
  p: [
    [0.34, 0.0], [0.34, 0.05], [0.2, 0.09], [0.16, 0.28], [0.22, 0.34],
    [0.16, 0.4], [0.3, 0.52], [0.3, 0.58], [0.12, 0.66], [0, 0.74],
  ],
  r: [
    [0.36, 0.0], [0.36, 0.06], [0.24, 0.1], [0.26, 0.14], [0.26, 0.6],
    [0.32, 0.66], [0.32, 0.72], [0.22, 0.78], [0.22, 0.8], [0, 0.88],
  ],
  n: [
    [0.36, 0.0], [0.36, 0.06], [0.22, 0.1], [0.2, 0.3], [0.26, 0.36],
    [0.24, 0.42], [0.16, 0.46], [0, 0.5],
  ],
  b: [
    [0.34, 0.0], [0.34, 0.05], [0.2, 0.09], [0.18, 0.2], [0.24, 0.26],
    [0.16, 0.34], [0.14, 0.6], [0.2, 0.66], [0.1, 0.78], [0.08, 0.86], [0, 0.94],
  ],
  q: [
    [0.36, 0.0], [0.36, 0.05], [0.22, 0.09], [0.18, 0.24], [0.24, 0.3],
    [0.16, 0.42], [0.18, 0.6], [0.26, 0.66], [0.2, 0.76], [0.3, 0.86],
    [0.34, 0.92], [0.24, 0.98], [0, 1.06],
  ],
  k: [
    [0.38, 0.0], [0.38, 0.05], [0.24, 0.09], [0.2, 0.24], [0.26, 0.3],
    [0.18, 0.44], [0.2, 0.64], [0.28, 0.7], [0.22, 0.82], [0.3, 0.9],
    [0.34, 0.96], [0.22, 1.02], [0, 1.1],
  ],
};

export function latheProfile(type: string): THREE.Vector2[] {
  return RAW_PROFILES[type].map(([r, y]) => new THREE.Vector2(r, y));
}

/** Silhouette height, used for camera-friendly scaling and animation arc heights. */
export function pieceHeight(type: string): number {
  const profile = RAW_PROFILES[type];
  return profile[profile.length - 1][1];
}

/** Low segment count on purpose: faceted, gem-cut silhouettes instead of smooth
 * lathes, matching the Obsidian & Aurora low-poly art direction. */
export const LATHE_SEGMENTS = 10;
