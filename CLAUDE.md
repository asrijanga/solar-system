# Working in this repo

The plan is `README.md`. The world list is `docs/world-catalogue.md`. Each story has a spec in `docs/stories/SS-n.md`, which is approved before code and records actual effort afterwards.

## Stack

- three.js `WebGPURenderer`, shaders in TSL, TypeScript (strict), Vite, Vitest.
- WebGPU only. The app refuses to run on the WebGL 2 fallback or a software adapter. `?software` allows a software adapter, for headless captures only.
- `src/core/` is pure TypeScript and must not import three.js (enforced by lint and by `test/core-boundary.test.ts`). Truth-critical code lives there: ephemeris, orbits, geodesy, photometry, tile maths, support decisions.
- Units are kilometres. Every renderer option goes through `createRenderer` in `src/gpu/renderer.ts`.
- Draw the scene through the `RenderPipeline` scene pass in `src/main.ts`, never `renderer.render()`. In three r184 the default path draws into an intermediate target with 24-bit depth even under reversed-Z. Captures refuse a reversed-Z viewpoint that did not render with float32 depth.
- In TSL, `select` and `If` compile to branches, and derivatives inside a branch (`dFdx`, `dFdy`, and the implicit ones in any `texture()` sample) are undefined in WGSL: SwiftShader silently returns zero. Evaluate every derivative and texture sample into a `.toVar()` before any `select`, and choose between derivatives with `mix`/`step` (docs/stories/SS-6.md).
- Brightness goes through `core/photometry.ts`: display = exposure · I/F / r_AU², no tone mapping. Stars use the same exposure. Never add ambient light.
- The frame loop allocates nothing. `npm run alloc` fails on any sampled allocation from `src/` on the frame path. Fractional numbers stored in captured variables allocate in V8: keep per-frame numeric state in typed arrays.

## Commands

- `npm run check` runs everything CI runs: typecheck, lint, format check, tests, build, and the bundle-size budget.
- `npm run dev` for a dev server; `npm run preview` serves the production build.
- `npm run build && npm run capture` renders every canonical viewpoint headlessly (WebGPU on SwiftShader) into `captures/`. Read the PNGs: that is how you see what you built.
- `npm run capture:diff` compares `captures/` against `baselines/`; CI fails on any difference past tolerance.
- `npm run alloc` measures allocation in the interactive frame loop over 600 frames (CI runs it).
- `npm run pipeline:ephemeris` re-derives the Moon's ephemeris from pinned SPICE kernels (CI diffs it). `npm run pipeline:moon` rebuilds the Moon texture from a 4.25 GB source; too large for CI, so `pipeline:test` checks the committed texture against the IAU Gazetteer instead. `npm run pipeline:calibrate` re-derives the albedo scale from the committed texture (CI diffs it). `npm run pipeline:terrain` rebuilds the relief (normals and heights) from the 1 GB LOLA grid; `pipeline:test` checks the committed files.
- `npm run pipeline:stars` re-derives `public/data/stars/` from the pinned catalogue; `npm run pipeline:test` runs the pipeline's unit tests. Python is managed by `uv` in `pipeline/`. CI re-runs the pipeline and fails if the committed data differs.
- `npm run capture:accept -- <id>` is the only way to change a baseline. Never run it to make a failing diff pass unless the change is intended and shown in the PR.

## Rules

- **Read the installed source.** For three.js, `node_modules/three` (including `examples/jsm`) at the pinned version is authoritative. Memory of older versions is not. TSL changes monthly.
- **Pins move together.** three.js is pinned exactly. Upgrade it only in a PR of its own, together with Playwright's Chromium, and re-run every capture. r185.1 and later fail on Chromium 141.
- **Cite conventions.** Longitude sign, latitude definition, vertical datum, body frame, projection parameters and units are cited in the PR from the dataset's own label or documentation, every time.
- **Never invent data.** No procedural noise, guessed coordinates, or gap-filling. A missing value is shown as missing.
- **Combine every available source.** Build each world from all usable real datasets, not the single best one: best source per region, registered to one frame, cross-calibrated where they overlap (fit recorded), blended across a stated band, provenance kept per region. A composite of real measurements is not invented data; where nothing measured a region, it stays a gap (README, "Combine every available source").
- **Gather first, then build.** Before building or rebuilding a world, inventory every available dataset for it (every mission and instrument: coverage, resolution, wavelength, frame, known artefacts, licence) in `docs/data/<world>.md`, then recreate the world from the whole inventory, not one product at a time. The Moon is due its inventory and a rebuild from it.
- **Never tune a check to pass.** Tolerances, thresholds, and skipped or loosened tests change only with the owner's approval, stated in the PR description.
- **Baselines change deliberately**, in a commit of their own, with before and after images in the PR.
- **Say what was not verified.** Every PR lists what was checked by machine, what needs the owner's eyes on real hardware, and what was not checked at all.
- **The cloud has no GPU.** Headless Chromium with SwiftShader proves correctness, never performance. Performance numbers come only from real hardware.
