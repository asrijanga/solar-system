# SS-2 · Claude can see it

Status: **done, pending owner approval of the tolerance** · Release 1 · 2026-09-24

As the director, I want Claude to render the app headlessly and read the image, so that "does this look right" is checkable in every later story without me at the desk.

## Acceptance criteria

| # | Criterion | Kind | Result |
| --- | --- | --- | --- |
| 1 | `npm run capture -- <viewpoint>` launches Playwright's Chromium with SwiftShader WebGPU, opens the app with `?capture=<viewpoint>`, writes `captures/<viewpoint>.png` | machine | Done; serves the production build via Vite's preview API, so captures test what ships |
| 2 | JSON sidecar: git SHA, three revision, Chromium version, adapter info, canvas size, epoch, camera pose | machine | Done; also Playwright version, backend, devicePixelRatio, determinism result, dirty-tree flag |
| 3 | Waits for an explicit ready signal sent after the frame's GPU work completes; never a fixed timeout | machine | `window.__capture` is set after `device.queue.onSubmittedWorkDone()` and one animation frame. The 60 s limit is only a failure timeout |
| 4 | Refuses to write unless the backend is WebGPU and the adapter is SwiftShader | machine | `tools/capture/verify.ts`, unit-tested. Also refuses a wrong viewpoint, pixel ratio or canvas size, any page error, and an app-side refusal |
| 5 | Deterministic: fixed size at DPR 1, no clock, no animation. Two runs compared, result recorded | machine | Each viewpoint renders twice in fresh browser contexts. `clear`: **pixel-identical** across runs |
| 6 | `npm run capture:diff` uses a perceptual metric tolerant of anti-aliasing, writes a diff image, exits non-zero past tolerance | machine | Done, with a second global check (see Decisions) |
| 7 | `npm run capture:accept` is the only way to update baselines | machine | Requires naming viewpoints or `--all`; warns when captured from a dirty tree |
| 8 | CI runs every capture on every PR and uploads captures and diffs | machine | `captures` job in `ci.yml`; artifacts uploaded even on failure. The Pages deploy runs the same gate |
| 9 | Viewpoint 0 is the SS-1 clear colour | machine | `clear`, 1024 × 1024, baseline committed |

## The harness was tested by breaking the app on purpose

Each case changed `CLEAR_COLOUR`, rebuilt, captured, and diffed against the `#1b3a5c` baseline.

| Clear colour | Local check (pixelmatch) | Global check (mean shift) | Result |
| --- | --- | --- | --- |
| `#000000` | 1,048,576 pixels differ | 59.00 levels | Fails |
| `#1b3a5d`, one level of blue | 0 pixels | 0.33 levels | Passes, correctly |
| `#22466e`, visibly different | **0 pixels** | 12.33 levels | Fails, **but only because of the global check** |

Other refusals checked: a missing baseline fails the diff; an unknown viewpoint name fails at the harness; `?capture=nope` makes the app report a refusal.

## Decisions made in this story

- **Two checks, not one.** pixelmatch at its default threshold let a visibly different whole-frame colour through with zero pixels flagged. A uniform shift is exactly what an exposure or radiometry bug looks like, so the diff also fails when the mean absolute RGB difference exceeds 0.5 levels per channel.
- **Tolerance, for owner approval:**
  - pixelmatch threshold **0.1**, its default;
  - at most **0.05 %** of pixels differing locally (about 520 of a 1024 × 1024 capture);
  - mean shift at most **0.5 levels** per channel.

  These are starting numbers. The harness measured zero noise between runs on one machine. If CI's machines disagree with the committed baseline, the fix is investigated, not the tolerance raised.
- **Playwright pinned at 1.56.1** (Chromium 141), the browser three r184 was proven against. It moves only together with three.js.
- **The harness is TypeScript run directly by Node** (type stripping, Node ≥ 22.18), so it is typechecked and linted like the app.
- **Capture mode allows the software adapter.** `?capture=<id>` implies `?software`. That is the only way capture mode differs from production, and the harness separately insists the adapter *is* SwiftShader.

## Cross-machine result

The first CI run on PR #4 rendered `clear` on a GitHub Actions runner and matched the baseline made in the Claude container exactly: 0 of 1,048,576 pixels differing, mean shift 0.00, and identical across its own two renders. SwiftShader on Chromium 141 is deterministic across these two machines for this viewpoint. Scenes with real geometry and filtering may not be; later stories re-measure.

## Not verified

- Performance. SwiftShader timings are meaningless, and the harness records none.

## Effort

Estimate: 1 to 2 sessions. Actual: 1 session.
