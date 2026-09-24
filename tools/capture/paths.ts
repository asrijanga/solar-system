import { join } from 'node:path';

export const root = join(import.meta.dirname, '..', '..');
export const distDir = join(root, 'dist');
/** Fresh output of `npm run capture`. Not committed. */
export const capturesDir = join(root, 'captures');
/** Accepted references. Committed, and changed only by `npm run capture:accept`. */
export const baselinesDir = join(root, 'baselines');

export const pngPath = (dir: string, id: string): string => join(dir, `${id}.png`);
export const sidecarPath = (dir: string, id: string): string => join(dir, `${id}.json`);
export const diffPath = (id: string): string => join(capturesDir, `${id}.diff.png`);
