import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works whether it's served from the site root or
  // from a subpath (e.g. GitHub Pages project sites, or /chess/ alongside
  // another app in the same repo).
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
