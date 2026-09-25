# SS-10b · Approximated detail below the measurements (optional, labelled)

Status: **approved, not started** · Release 3 · 2026-09-25

As a learner zooming past what any mission measured, I want the ground to keep looking like the Moon rather than smooth polygons. When the app shows me detail that is an approximation and not a measurement, I want to be told.

## Owner decision, 2026-09-25

The owner asked: "can we still use polygons but recreate details as an approximation". Offered the choice, they picked **"Both, real first"**:

- **Real first.** The finest real data came first: Kaguya 10 m heights over Albategnius (SS-10, PR #16).
- **Then this.** An optional approximation mode, off by default, labelled on screen while it is on, and kept out of every check.

Later that day, choosing viewpoint streaming (SS-10c), the owner confirmed it: "lets stream it based on viewpoint so we can scale it to very tiny details … of course we will let user know it's an approximation". They also asked about an image service for fills. That was declined, and the owner has not objected: generated images are pictures with lighting baked in, not heights; they differ on every request and cost money per call. The statistical approximation below gives height detail for free, lit by the real Sun, and the same on every visit.

This is an **exception to "Never invent data"** (CLAUDE.md), approved by the owner on this date. The rule stays for everything else. The exception is written into CLAUDE.md in the same PR, with its limits:

1. Off by default.
2. Labelled on screen for as long as it is on.
3. Never in captures, checks or baselines except one for-eyes view that shows the label.
4. Never alters the measured surface at the measured resolution.

## What it does

When the mode is on and the camera is closer than the finest measured level supports, the terrain keeps refining past it. There are up to 3 extra levels below the finest measured one: 1.3 m vertex spacing below Kaguya's 10 m levels (84° S to 84° N in local mode, SS-10c), and correspondingly coarser wherever the finest measurement is coarser. The extra levels are polygons, generated in the browser from the measured parent tile plus two kinds of detail.

- **Roughness.** Fractal height variation whose statistics are **measured from our own data**. The pipeline computes the Kaguya tile's height-difference structure function, RMS Δh against baseline from 8 m to 2 km. Fitting it gives a Hurst exponent and an amplitude, and the extrapolation below 8 m uses that fit. The values go into a committed JSON with the fit's error, and are cross-checked against LOLA's published roughness (Rosenburg et al. 2011; the value is checked against the paper before it is used).
- **Small craters.** Bowls with raised rims, drawn from a published size-frequency distribution for small lunar craters (the empirical equilibrium distribution) and published depth-to-diameter ratios for small craters. Each number is quoted from its source in the JSON, checked against the paper before code; none comes from memory.

## Constraints that keep it honest

- **Band-limited.** Generated detail only has wavelengths shorter than the measured vertex spacing. Averaged over one measured cell it is zero, so the measured surface is unchanged at the scale it was measured. A unit test enforces this.
- **Deterministic and seamless.** Detail is a function of the body-fixed position, not of the tile. The same place always looks the same, and neighbouring tiles agree exactly along their edges (unit test).
- **Labelled.** A switch, "Detail: measured / + approximation". While it is on, a warning reads: "Approximation: small craters and roughness below what was measured are generated from the Moon's statistics. They are not the real craters here." `?detail=approx` in the URL turns it on for sharing, with the same label.
- **Separate.** Generated tiles are never written to disk or served. They exist only in the browser while the mode is on.

## How

- **Plugin:** a 3d-tiles-renderer plugin extends the layer's availability below the measured levels. It answers fetches for those tiles by decoding the measured ancestor tile, subdividing it, adding the detail, and encoding a quantized-mesh tile with normals.
- **Code split:** a TypeScript port of the pipeline's encoder does the encoding. The pure maths goes in `src/core/` (detail spectrum, crater field, band-limit), unit-tested, with no three.js.
- **Frame loop:** stays allocation-free. Generation happens in the tile loader, not per frame.

## Checks

- **Unit tests:**
  - Band-limit: the mean over each measured cell is within 1 cm of zero.
  - Edge continuity.
  - Determinism.
  - The structure function of generated terrain matches the fitted one within its error.
- **Captures:** every existing capture runs with the mode off and must be unchanged. The harness refuses a check viewpoint with the mode on.
- **For eyes:** one capture, `moon-albategnius-approx`, with the mode on and its label visible.
- **Allocation:** `npm run alloc` with the mode on.

## Not verified by this story

- That generated craters resemble the real ones at any particular spot. They cannot, and the label says so.
- iPhone frame rate with the extra levels.

## Estimate

1 to 2 sessions.
