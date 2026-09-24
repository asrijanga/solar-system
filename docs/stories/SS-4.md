# SS-4 · Stars behind everything

Status: **done** · Release 1 · 2026-09-24

As the director, I want a starfield from a real catalogue, correctly oriented, so that the scene reads as space and the sky itself is the first thing the tool gets provably right.

## Acceptance criteria

| # | Criterion | Kind | Result |
| --- | --- | --- | --- |
| 1 | `pipeline/stars.py` converts the Yale Bright Star Catalogue (5th rev.) into a compact binary of J2000 unit vector, V, B−V; non-stellar entries dropped and counted | machine | 9,110 records → 9,096 stars, 14 removed entries dropped (HR listed in the manifest). Adds the HR number per star so tests can find stars |
| 2 | Deterministic, checksum recorded in the manifest | machine | Byte-identical across runs; CI re-runs the pipeline from the pinned source and fails on any diff |
| 3 | One draw call, at infinity: only camera rotation affects the stars | machine | One instanced mesh of 9,096 quads, placed by the view matrix's rotation alone (`w = 0`) |
| 4 | Brightness by flux ∝ 10^(−0.4·m); colour from B−V via a cited relation; point size fixed in pixels | machine | Pogson flux; Ballesteros (2012) B−V → temperature; Planck × CIE 1931 (Wyman et al. 2013 fit) → sRGB. Gaussian spot of σ = 0.7 CSS px carrying the star's whole flux, so brightness is the same at any pixel density |
| 5 | True black background, no ambient light | machine | Viewpoints showing space clear to `#000000`; harness and depth viewpoints keep the scaffold colour so a failed clear stays distinguishable |
| 6 | ICRF → scene through the one tested axis function | machine | `core/frames.ts`: determinant +1, orthonormal, pole → +Y, equinox → +X, RA 6h → −Z |
| 7 | Proper motion ignored, and the error quantified | machine | Largest drift over 1900–2100: HR 4550 (Groombridge 1830), 11.8′. Every other star moves less |

## Ground truth

All machine-checked, against SIMBAD (a different catalogue from the one rendered). The query and date are in `test/fixtures/simbad-stars.json`.

- **Positions**: all 12 reference stars within 5″ of SIMBAD.
- **Separations**: Betelgeuse–Rigel, Dubhe–Merak, Sirius–Vega within 5″ of SIMBAD's.
- **Polaris** within 1° of the scene's celestial north pole.
- **Orion capture, north up**: seven stars (Betelgeuse, Rigel, Bellatrix, Saiph, and the belt) each within 2 px of where a gnomonic projection of SIMBAD's coordinates puts them. Measured offsets 0.3 to 1.1 px. The projection is the harness's own (north up, east left), independent of the app's axis mapping and of three.js.
- **Mirror detection**: `orion-mirrored`, a negative control, renders the sky mirrored as a determinant −1 mapping would. All seven star checks fail, as they must.
- **Colour anchors**: a 2856 K blackbody lands within 0.0012 of CIE illuminant A's published chromaticity (the illuminant is defined as that blackbody); the Sun's B−V gives 5778 K.

## Owner decision: stars and exposure

Asked on 2026-09-24. **Chosen: a toggle, physical exposure by default.** When sunlit ground is in view, stars are as faint as a real exposure makes them, usually invisible; a labelled "star boost" shows them brighter than physics allows and says so on screen. Applied in SS-6 when the Moon arrives. Until then, with nothing sunlit in the scene, stars use a nominal exposure (`STAR_EXPOSURE`) that keeps the naked-eye limit near magnitude 6.5 just visible.

## Decisions made in this story

- **The binary stays in ICRF**, and the app converts to scene axes once at load. The data file is the truth; the renderer's conventions do not leak into it.
- **Stars sit exactly on the far plane** (depth 0 under reversed-Z, 1 otherwise), drawn additively without depth writes. Everything nearer draws over them; they never draw over anything.
- **A missing B−V renders neutral white.** 310 stars have none in the catalogue (median V 6.4, brightest 3.7). Nothing is guessed.
- **Display white is D65.** A 6500 K star renders near neutral and the Sun slightly warm. That is an authored adaptation choice, the same one every sRGB display makes.
- **Viewpoints gained a background**: `space` (black) or `scaffold`. Existing baselines are unchanged.
- **The Python pipeline starts here**, under `uv`, with no dependencies. Downloads are pinned by SHA-256 and retried; a mismatched download is discarded, never used. The first attempt at the catalogue through this container's proxy was truncated, which is exactly the case this handles.

## Traps, and what guards each

| Trap | Guard |
| --- | --- |
| Mirrored sky | Determinant test, and the `orion-mirrored` negative control |
| Byte offsets misremembered | Read from the catalogue's own ReadMe; parser unit-tested; 12 stars checked against SIMBAD |
| Blank B−V parsed as 0 | Unit test: blank → `None` → NaN → neutral |
| Colour-matching constants misremembered | Illuminant A anchor test |
| Stars dimmer on high-DPI screens | Peak computed in CSS-pixel units; the quad expands in device pixels |
| Starfield culled when the camera looks away from the origin | `frustumCulled = false` |
| Truncated download used as data | SHA-256 pin, retry, discard |

## Not verified

- How the stars look on a real screen. At σ = 0.7 CSS px the brightest stars are only a few pixels across; whether that reads well on a phone is for the owner's eyes.
- The colour rendering of the hottest stars, beyond "bluer than cool ones".

## Effort

Estimate: 1 to 2 sessions. Actual: 1 session.

Allocation: this repo's frame loop still allocates 0 bytes; three.js rose from about 15.5 to 16.4 KB per frame with the star draw added.
