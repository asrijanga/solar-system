# SS-1 · A WebGPU frame, and nothing else

Status: **done** · Release 1 · 2026-09-24

As the director, I want a TypeScript app that clears a real WebGPU canvas to a colour I chose, and refuses to run on anything else, so that the stack and its guard rails exist before anything is at stake.

## Acceptance criteria

| # | Criterion | Kind | Result |
| --- | --- | --- | --- |
| 1 | Vite + TypeScript, `strict` and `noUncheckedIndexedAccess` (plus `exactOptionalPropertyTypes`); ESLint, Prettier, Vitest; Node pinned in `.nvmrc` and `engines` | machine | Done; `npm run check` |
| 2 | `three` pinned exactly (0.184.0) with matching `@types/three` (0.184.1); lockfile committed | machine | Done |
| 3 | Canvas clears to a non-default, non-black colour | machine + eyes | `#1b3a5c`; centre pixel measured exactly `#1b3a5c` in headless Chromium |
| 4 | After `init()`, the backend is asserted to be WebGPU; otherwise the renderer is disposed and the actual reason shown | machine | Done; see refusal table |
| 5 | Renderer options go through one typed factory, so a misspelling is a type error | machine | `src/gpu/renderer.typetest.ts`; removing its `@ts-expect-error` lines fails typecheck (checked) |
| 6 | Adapter info, features and depended-on limits logged once | machine | Done; `[gpu]` console lines |
| 7 | Handles resize and devicePixelRatio, capped at 2 | machine | 390×844 at DPR 3 gives a 780×1688 canvas; resize 800×600 → 500×900 tracked |
| 8 | `CLAUDE.md` holds the working rules | eyes | Done |
| 9 | SessionStart hook installs dependencies for cloud sessions | machine | `.claude/hooks/session-start.sh`, run and verified |
| 10 | CI runs typecheck, lint, tests, build on every PR | machine | `.github/workflows/ci.yml`, plus format check and bundle budget |
| 11 | `src/core/` may not import three, proven by a failing fixture | machine | `test/core-boundary.test.ts` lints fixtures through the ESLint API |

## Refusals, checked in headless Chromium 141

| Situation | How it was produced | Shown |
| --- | --- | --- |
| No `navigator.gpu` | API removed by an init script | `no-webgpu-api` |
| WebGPU API but no adapter | Chromium without GPU flags | `no-adapter` |
| Software adapter, not allowed | SwiftShader without `?software` | `software-adapter` |
| Software adapter, allowed | SwiftShader with `?software` | Renders the frame |
| Compatibility-mode-only adapter | Not reproducible here | Unit-tested only |
| WebGL 2 fallback after init | Not reproducible here | Unit-tested message; code path unexercised in a browser |

Without the gate, the no-adapter case is exactly where three.js silently switches to WebGL 2.

## Decisions made in this story

- **Our own adapter and device.** three.js requests its adapter in WebGPU *compatibility* mode and, if it gets one, silently disables MSAA (`WebGPUBackend.init`, r184). The app instead requests a core adapter itself, refuses compatibility-only hardware with its own message, and passes the device to three. The adapter we check is guaranteed to be the one that renders.
- **Reversed-Z stays off** until SS-3, where a paired capture proves it. The typed factory already requires the option to be stated.
- **TypeScript 6.0.3, not 7.** typescript-eslint 8.70 supports `<6.1.0`.
- **`src/core/`**, not a top-level `core/`, so one `tsconfig` covers everything.
- **Bundle budget enforced now**: `npm run size` fails over 400 KB brotli. Measured 156.6 KB.

## Deviation from the plan

The plan put the first deployment at SS-7, as a private link. At the owner's request the app now deploys to public GitHub Pages from `main` on every push, gated on `npm run check`. SS-7 keeps the job of a private preview link.

## Not verified

- Anything on a real GPU. The owner checks criterion 3 by eye in a real browser.
- The compatibility-only and WebGL 2 fallback paths in a real browser (unit-tested only).
- Firefox and Safari.

## Traps, and what guards each

| Trap | Guard |
| --- | --- |
| Silent WebGL 2 fallback | Adapter gate before init; backend assertion after |
| Silently ignored renderer options | Closed `RendererOptions` type and the type test |
| Deprecated `renderAsync()` from older examples | Uses `init()` then `render()` |
| `@types/three` lagging the runtime | Pinned to the matching 0.184 line; typecheck in CI |

## Effort

Estimate: 1 session. Actual: 1 session.
