# SS-6 · The Moon, for real

Status: **in review** · Release 1 · 2026-09-24

As the director, I want the Moon rendered from SS-5's data with a correct sun, so that the whole path from NASA archive to browser pixel is proven, and provably right.

## Acceptance criteria

| # | Criterion | Kind | Result |
| --- | --- | --- | --- |
| 1 | Sphere in km, radius and orientation from the manifest at a canonical epoch | machine | Radius 1737.4 km from `ephemeris.json` (read from the PCK in SS-5). Object space is the `MOON_ME` body frame; the model matrix is S·Mᵀ from the manifest's `j2000ToBodyFixed`, unit-tested as a rotation (determinant +1) |
| 2 | Texture coordinates per fragment from the object-space direction, not mesh UVs | machine | `lon = atan2(y, x)`, `lat = asin(z)` in TSL. The Gazetteer checks and the mirror negative control prove the mapping |
| 3 | No seam at ±180°, handled explicitly; a canonical capture at the wrap | machine | Tarini's method with explicit gradients. `moon-seam`: the step at the meridian is 1.03 times the step beside it. `moon-seam-naive` (negative control, plain sampling): 4.33 times, a visible dashed line |
| 4 | Mipmaps correct for the format; anisotropy at the adapter's maximum; a limb capture shows it | machine + eyes | R8, uncompressed, so mips are generated on the GPU at load (a 2×2 box filter, three's mipmap pass). Anisotropy 16, the WebGPU maximum. `moon-limb` is for eyes |
| 5 | Lommel–Seeliger in `core/`, unit-tested, mirrored in TSL | machine | `core/photometry.ts`. `uniform-ls-full` and `uniform-ls-quarter`: every one of 408,636 disc pixels within 1 level of the core function. `uniform-lambert-full` (negative control): 9.4% match, worst pixel 88 levels off |
| 6 | Irradiance scales with the Moon–sun distance; exposure and tone mapping chosen once and documented; no ambient term | machine | 1/r² in AU at the epoch. Exposure and tone mapping below. `moon-quarter`: all 200,200 pixels more than 0.5° into the night are exactly black |
| 7 | SS-4's star decision applied | machine | Physical exposure by default, with a labelled boost of ×100,000 (12.5 magnitudes) |
| 8 | Drag and scroll within limits, closest approach about 1.5 radii | machine | OrbitControls about the Moon's centre, lunar north as the orbit axis, 1.5 to 60 radii. The first view fits the disc to 80% of the screen's shorter side |
| 9 | Test cube deleted | machine | Scene, viewpoint and baseline removed |
| 10 | Download bytes, GPU bytes and time to first frame, measured on the owner's machine | **eyes** | `?debug` now shows the first-frame time and the bytes transferred. Expected values are below; the owner's measurement is still to come |

## Ground truth

All machine-checked on every PR, by the harness, from `ephemeris.json` in J2000. The harness rebuilds the camera without the app's axis mapping or three.js, casts a ray through every pixel onto the true sphere, and knows each pixel's longitude, latitude, μ0 and μ.

- **Photometry, every pixel.** A uniform Moon with ϖ = 0.96 (8p for p = 0.12) must match `core/photometry.ts` pixel by pixel, within 2 levels, on at least 99% of the disc more than 2 px inside the limb. At full and first quarter every pixel is within 1 level. This one check covers the TSL mirror of the formula, the sun direction, the terminator 90° from the sub-solar point, the 1/r² and the exposure.
- **IAU Gazetteer, on rendered pixels.** At full Moon, seen from Earth with lunar north up: Tycho, Copernicus and Aristarchus brighter than the ring around them; Mare Crisium darker than the highlands around it; the Apollo 11 site darker than the median of the lit disc. Radii and the qualitative thresholds are SS-5's texture tests, unchanged. Measured ratios: 1.086, 1.255, 1.485, 0.760, 0.695.
- **Mirror detection.** `moon-full-mirrored` samples the map at −longitude. Tycho (0.980) and Copernicus (0.812) fail, as they must.
- **Unit tests.** Mare Crisium is right of centre and Tycho south, seen from Earth; the body frame is a rotation; the manifest's sun vector lands on its own sub-solar point; libration stays within its bounds.
- **The constants against the fact sheet.** Geometric albedo 0.12 at 378,000 km gives magnitude −12.75, against the fact sheet's −12.74 at opposition. A star and a zero-phase disc of the same magnitude put the same light on screen.
- **Decoding.** The app reports the mean of the albedo bytes it decoded. It must be within 0.05 levels of the pipeline's mean (43.9234), which catches a colour-managed, premultiplied or resampled decode.

### Changed from the plan

The plan's first ground truth was "a marker at Horizons' sub-solar point sits at the brightest point of a Lommel–Seeliger render". That is true of Lambert, not of Lommel–Seeliger: its brightest point is at the bright limb, wherever the phase is not zero. The per-pixel photometry check replaces it and is stronger: it checks every pixel's value, including the terminator's position, against the formula. The sun direction it uses was tied to Horizons' sub-solar point in SS-5.

The plan also asked for markers at Gazetteer coordinates. A marker drawn by the app lands wherever the app thinks the coordinates are, so it can only confirm the app agrees with itself. The harness instead predicts where each feature must be, independently, and checks the rendered landform is there.

## Decisions made in this story

### Units, exposure and tone mapping

The display quantity is the radiance factor I/F at the epoch's sun distance, times one exposure: `display = 2 · (I/F) / r_AU²`, in linear sRGB.

- **Exposure 2** is the photographer's "looney 11" rule, one stop over "sunny 16". At exposure 1 an 18% grey card in sunlight displays at 18% linear, middle grey. The Moon is lit as that card is, but at geometric albedo 0.12 it is darker, about as dark as worn asphalt, so it is exposed one stop more.
- **No tone mapping.** The plan named AgX or Neutral. At this exposure, the brightest 1% of lunar surface between ±60° latitude displays near 0.5 linear at full phase, and only a thin rim at grazing emission, where Lommel–Seeliger doubles, reaches display white. The Moon needs no tone curve. Only the sun-facing slopes of polar craters clip, and those are over-bright in the source (baked shading, SS-5). Neutral also subtracts a small offset from every dark colour, which shifts the night side and every scaffold and depth-test colour the checks rely on. Tone mapping stays off, the choice is documented here, and it can be revisited when something brighter than the Moon is in view.
- **Stars share the exposure.** A star of magnitude m is drawn with the light a surface of I/F = π·10^(−0.4(m + 26.74))/Ω would put into pixels of solid angle Ω. At a 40° field on an 800-pixel screen a magnitude-0 star peaks near 5 × 10⁻⁵: invisible next to the Moon, as in every Apollo photograph. Physical star brightness changes with the field of view and the screen, so it is updated on resize.
- **The boost is a fixed ×100,000** (12.5 magnitudes), labelled on screen whenever it is on. The star-only viewpoints (`orion`) keep SS-4's nominal exposure, so their baselines do not change.

### Albedo calibration

Neither Clementine label gives a reflectance scale. `pipeline/calibrate.py` scales the map so that its disc at zero phase has the Moon's visual geometric albedo, 0.12 (NASA Moon Fact Sheet). At zero phase Lommel–Seeliger gives I/F = ϖ/8 at every point, so ϖ = k·v with k = 8p / mean(v), the mean weighted by projected area over the hemisphere facing longitude 0, latitude 0, gaps left out. Result: k = 7.8826. CI re-runs it and diffs.

ϖ here is effective, not physical: for the average Moon it is 0.96, and bright regions exceed 1. It absorbs the opposition surge, which Lommel–Seeliger does not model. The consequence is honest and recorded: calibrated at zero phase, the model overstates the Moon's brightness at larger phase angles, roughly twofold at quarter phase. Hapke (SS-8b) fixes that.

### Gaps

Pixels the mask marks as never imaged are shaded like the surface, with the disc-mean albedo so their shape and lighting read, and coloured magenta so they can never pass for data. The south polar gaps are the largest.

### Texture loading

The 8192 × 4096 WebP is decoded with `createImageBitmap` (no colour conversion, no premultiplication), then copied out 256 rows at a time through an `OffscreenCanvas`, keeping one byte per pixel. No full-size RGBA copy (128 MB) exists next to the bitmap. The gap mask is packed to one bit per texel (4 MB on the GPU instead of 32 MB) and read with `textureLoad`, so it is never filtered.

## Findings

- **TSL's `select` is a branch, and derivatives in a branch are undefined.** The first seam fix chose between derivatives with `select`, and the gap colour with another. TSL compiled both to `if/else`, and the texture sample landed inside a branch. WGSL leaves derivatives in non-uniform control flow undefined; on SwiftShader they came out as zero, and the whole Moon rendered sharper than plain sampling, with no error and no warning. Found because the seam fix made images differ away from the seam, where it should change nothing. The fix evaluates every derivative and the sample into variables in uniform flow and chooses with `mix` and `step`. The rule is in `CLAUDE.md`.
- **A seam check straight down the meridian proves nothing.** Looking exactly at longitude 180, the meridian falls on a boundary between 2×2 pixel quads, no quad straddles the wrap, and even naive sampling shows no seam. The canonical view is from 165°E, 25°N, where the meridian curves across quads as it does for anyone orbiting.
- **`albedo.json` from SS-5 was not valid JSON.** It recorded the lossless trial's PSNR as `Infinity`, which Python writes and browsers refuse. Now `null`; every manifest is written with `allow_nan=False`, and a test parses them strictly.
- **The Clementine strips show.** At full Moon, faint vertical banding crosses the centre of the disc: the seams between Clementine's image strips, noted in SS-5. It is in the data.

## Measurements

| | Value | How |
| --- | --- | --- |
| Download | 2.57 MB albedo + 22 KB mask + 236 KB JS (gzip) + 0.2 MB stars | File sizes. The owner's `?debug` shows the real transfer |
| GPU memory | 44.7 MB albedo (R8 with mips) + 4.0 MB gap bits | Computed from formats and sizes |
| Peak CPU memory while decoding | about 190 MB: the decoded bitmap (up to 128 MB, browser-dependent), 32 MB albedo, 32 MB mask, 8 MB strip | Computed; not measured |
| Time to first frame | not yet measured | `?debug` on the owner's device |
| Frame-loop allocation | 0 B per frame from `src/`; three.js about 16.0 KB | `npm run alloc` on SwiftShader |

## Traps, and what guards each

| Trap | Guard |
| --- | --- |
| Mirrored Moon | Gazetteer checks on pixels; `moon-full-mirrored` negative control |
| Lambert's limb darkening | Per-pixel photometry; `uniform-lambert-full` negative control |
| Seam at ±180° | `moon-seam`, off-axis; `moon-seam-naive` negative control |
| Derivatives in branches | No `select` or `If` before the sample; rule in `CLAUDE.md` |
| Ambient light | `moon-quarter` night check: exactly black |
| Browser decode differs from the pipeline's | Decoded mean checked against the manifest |
| Uncalibrated brightness | Calibration re-derived in CI; fact-sheet magnitude test |

## Not verified

- **Anything on real hardware.** Time to first frame, memory, frame rate and how it looks on the owner's iPhone. The peak memory while decoding is the main risk on a phone.
- **The limb capture** is for eyes: no automated anisotropy check.
- **Earthshine and relief shadows** are absent by design (earthshine is a later story; shadows need terrain).
- **Brightness at large phase angles** is overstated by Lommel–Seeliger calibrated at zero phase, as above.

## Effort

Estimate: 2 to 4 sessions. Actual: 1 session.
