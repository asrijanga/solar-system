# SS-3 · A camera, a cube, and a clock

Status: **done** · Release 1 · 2026-09-24

As the director, I want a 3D camera, a test cube, orbit controls, and a frame-time overlay, so that there is a reference object and a real measurement before anything real is on screen.

## Acceptance criteria

| # | Criterion | Kind | Result |
| --- | --- | --- | --- |
| 1 | Perspective camera at a known pose looking at the origin; a lit test cube there is visibly three-dimensional | machine + eyes | `cube` viewpoint: three visible faces at three distinct brightnesses from one directional light, no ambient |
| 2 | Units are kilometres, declared once in `core/units.ts` | machine | `KM`, `METRE` |
| 3 | Reversed-Z through the typed factory, proven by captures, with a paired capture that must fail | machine | `depth-reversed` passes, `depth-standard` (negative control) fails, `depth-tie` (tie control) passes. See "Depth" below |
| 4 | Drag rotates, scroll zooms, within limits | machine + eyes | `OrbitControls`, 1.5 to 30 km. Driven headlessly: drag orbits, zoom stops at both limits |
| 5 | `?debug` overlay: frame-time histogram over 300 frames with p50/p95/p99; GPU time via timestamp queries where supported, saying so otherwise; draw calls and triangles; JS heap where exposed | machine + eyes | Interval and CPU work percentiles, histogram with 16.7 and 33.3 ms lines, GPU time, draws, triangles, heap |
| 6 | The render loop allocates nothing per frame, checked over 600 frames through the DevTools protocol | machine | `npm run alloc`: **0 bytes** sampled from `src/` over 604 frames at a 64-byte sampling interval. Proven able to see a planted one-element array (21 B/frame, 173 samples) |
| 7 | Uses `renderer.setAnimationLoop` | machine | Done |

## Depth: what the captures found

The plan's version of this test turned out not to test what it claimed, twice. Both problems are now written down so they are not repeated.

**1. Tilted giant quads measure float32 vertex precision, not the depth buffer.** The first version used two 70°-tilted quads thousands of kilometres across. Reversed-Z lost in bands that followed the tessellation rows, and more tessellation made it worse. At about 6,500 km a float32 view-space distance only has about 0.5 m of resolution, and a 10 m gap tilted 70° is 3.4 m along the view: a few float steps, which vertex-transform rounding can flip. The redesigned scene uses face-on quads, so every fragment of a quad has one depth.

**2. A tie is a pass unless draw order says otherwise.** Depth compares pass on equality, so whichever quad draws later wins a tie. The front quad now draws first, and a third viewpoint, `depth-tie` (0 m apart), proves ties go to the back quad. The front quad in `depth-reversed` therefore wins only by resolved depth.

**3. three r184 renders the scene on 24-bit depth even with reversed-Z on.** With sRGB output, `renderer.render()` draws the scene into an intermediate target whose depth texture is always `UnsignedIntType` (`depth24plus`); the canvas gets `depth32float`, but the scene never touches it. Read back from the GPU:

| Path | Scene depth under reversed-Z |
| --- | --- |
| `renderer.render()` | `depth24plus` |
| `RenderPipeline` with `pass(scene, camera)` | `depth32float` |

SwiftShader stores `depth24plus` as a 32-bit float, which is the only reason the first captures passed; on a GPU with a true 24-bit depth buffer they would have failed. The app now renders through a scene pass. Every capture reports the scene pass's depth type, and the harness refuses a reversed-Z viewpoint that did not render with float32 depth, so a three.js upgrade cannot bring this back quietly.

Final results, centre 20% of each capture:

| Viewpoint | Setup | Front quad | Back quad |
| --- | --- | --- | --- |
| `depth-reversed` | reversed-Z, 10 m apart | 100% | 0% |
| `depth-standard` | standard depth, 10 m apart | 0% | 100% |
| `depth-tie` | reversed-Z, coplanar | 0% | 100% |

I also tried an infinite far plane (three's reversed projection keeps a finite one). A float32 emulation showed the finite far plane separates these surfaces fine, because the division by `w` carries the signal, so it was not adopted: no complexity without evidence.

## Allocation

| Source | Bytes per frame, sampled | Status |
| --- | --- | --- |
| This repo's code (`src/`) | 0 | Gated in CI |
| three.js | about 15,500 | Reported, not gated |

Our first measurement was 30.6 B/frame from the loop itself: fractional timestamps stored in a captured `let` are boxed on the heap by V8 on every write. Timing state now lives in a `Float64Array`, and the clock is read only when the overlay is on.

three.js allocates about 15.5 KB per frame for a one-cube scene: child-list arrays (`_getChildren`), render-object cache-key hashing (`cyrb53`, `getCacheKey`), and matrix inversion. At 60 fps that is about 0.9 MB/s of garbage, the likeliest source of future GC hitches. It is upstream and tracked, not fixed here; `captures/alloc.json` records the top sites on every CI run.

## Decisions made in this story

- **Render through `RenderPipeline` + `pass()`**, for the depth reason above. Later stories need the pipeline anyway for exposure and tonemapping.
- **Negative and tie controls are first-class viewpoints.** A negative control's checks must fail; if they pass, the harness errors. Negative controls are never baselined.
- **Pixel checks run on every capture**, independent of baselines, so the depth assertions hold even when a baseline is legitimately updated.
- **The debug overlay's GPU time** is the most recent resolved frame, as three reports it. Resolving timestamps allocates, so it runs only with `?debug`, twice a second.
- **No infinite far plane**, as above.

## Traps recorded for later

- **Render targets default to 24-bit depth.** Any render target made later, for post-processing or shadows, gets `depth24plus` unless it asks for `FloatType`. Check depth types whenever one is added.
- **Faces away from the light are pure black.** That is correct for an airless body and there is no ambient light by design.

## Not verified

- Anything on a real GPU. The overlay's numbers here are SwiftShader's and mean nothing about performance; the owner checks criteria 1, 4 and 5 by eye.
- That real hardware's `depth24plus` fails `depth-standard` harder than SwiftShader does. It can only be worse, since SwiftShader stores it as float32.

## Effort

Estimate: 1 session. Actual: 1 long session. The depth test needed three redesigns, and each one found something real.
