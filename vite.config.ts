import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the build works at any sub-path (GitHub Pages serves /solar-system/).
  base: './',
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
