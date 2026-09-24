# Working in this repo

The plan is `README.md`. The world list is `docs/world-catalogue.md`. Each story has a spec in `docs/stories/SS-n.md`, which is approved before code and records actual effort afterwards.

## Stack

- three.js `WebGPURenderer`, shaders in TSL, TypeScript (strict), Vite, Vitest.
- WebGPU only. The app refuses to run on the WebGL 2 fallback or a software adapter. `?software` allows a software adapter, for headless captures only.
- `src/core/` is pure TypeScript and must not import three.js (enforced by lint and by `test/core-boundary.test.ts`). Truth-critical code lives there: ephemeris, orbits, geodesy, photometry, tile maths, support decisions.
- Units are kilometres. Every renderer option goes through `createRenderer` in `src/gpu/renderer.ts`.

## Commands

- `npm run check` runs everything CI runs: typecheck, lint, format check, tests, build, and the bundle-size budget.
- `npm run dev` for a dev server; `npm run preview` serves the production build.

## Rules

- **Read the installed source.** For three.js, `node_modules/three` (including `examples/jsm`) at the pinned version is authoritative. Memory of older versions is not. TSL changes monthly.
- **Pins move together.** three.js is pinned exactly. Upgrade it only in a PR of its own, together with Playwright's Chromium, and re-run every capture. r185.1 and later fail on Chromium 141.
- **Cite conventions.** Longitude sign, latitude definition, vertical datum, body frame, projection parameters and units are cited in the PR from the dataset's own label or documentation, every time.
- **Never invent data.** No procedural noise, guessed coordinates, or gap-filling. A missing value is shown as missing.
- **Never tune a check to pass.** Tolerances, thresholds, and skipped or loosened tests change only with the owner's approval, stated in the PR description.
- **Baselines change deliberately**, in a commit of their own, with before and after images in the PR.
- **Say what was not verified.** Every PR lists what was checked by machine, what needs the owner's eyes on real hardware, and what was not checked at all.
- **The cloud has no GPU.** Headless Chromium with SwiftShader proves correctness, never performance. Performance numbers come only from real hardware.
