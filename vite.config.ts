import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

function buildId(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  // Relative asset paths, so the build works at any sub-path (GitHub Pages serves /solar-system/).
  base: './',
  define: {
    // Shown in ?debug and on error reports, so a screenshot says which build it came from.
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  build: {
    target: 'es2023',
    // three.js alone exceeds Vite's 500 kB default; the real gate is the brotli budget in `npm run size`.
    chunkSizeWarningLimit: 1024,
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
