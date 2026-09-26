# The world recipe

How every world is built, taken from how the Moon was actually built (SS-5 to SS-13, 2026-09-24 to 26). Each world is one round of the same eight stories. They run in this order, one PR per change.

The Moon is the reference implementation. Every step below names the Moon's version and what the owner decided there. That way the next world starts from the answer, not from the question.

## What the owner wants, in their words

These requests shaped the Moon and apply to every world:

- **"A recreation of reality, i.e. we fetch best sources and recreate this."** Real measurements only, from every mission that measured the world. When blurry terrain showed on zoom, the owner called it a failure.
- **"I don't want to pay for storage … github pages is fine. We will have to work around it."** The website stays on GitHub Pages, free and working on the iPhone. `npm run local` gives full measured detail on the owner's own computer.
- **"Put me in orbit in a cinematic mode … close enough where I can see terrain but at a distance where I should not see blurry terrain."** Then: **"I need the gesture to zoom in and zoom out and then start orbit."**
- **"This purple is distracting … drop purple and fill gaps."** Where a second mission measured a gap, fill it from that. Nothing on screen should break the view.
- **"If possible write everything in typescript"**, with Python only where a library has no good TypeScript equivalent.
- **"We will let user know it's an approximation."** Detail below the measurements is optional, local-only and labelled on screen (SS-10b).
- **One page per world, with a way back** (SS-13).
- **CI must not hold merges up** (2026-09-26). Screenshots run on every PR. The allocation checks run only when the frame code changes.

## The eight stories

### W1 · Inventory: every dataset, before any code

Write `docs/data/<world>.md`: every mission and instrument that measured the world. For each one, record:
- coverage and resolution;
- wavelength, and whether the lighting is baked in;
- frame and datum, cited from the product's own label;
- known artefacts;
- licence, download URL, and whether a checksum is published.

Mark each dataset used, rejected (with the reason) or to evaluate.

**Moon:** `docs/data/moon.md`.
- The WAC and Kaguya mosaics were rejected for baked shading.
- A USGS LOLA track mosaic was rejected for stripes, which the LOLA team's own gridded map (`LDAM_10`) does not have.
- Kaguya's stereo terrain was found to be too smooth to carry roughness (SS-10b).

**Done when:** the owner has seen the inventory. Every later story cites it.

### W2 · Constants and ephemeris, from SPICE

These come from pinned SPICE kernels, never typed in:
- the radius, GM and rotation model;
- positions of the Sun, the world and its neighbours at the canonical epochs.

The kernels are checked by SHA-256, and CI re-derives the output and diffs it.

**Moon:** `pipeline/ephemeris.py`, `public/data/moon/ephemeris.json`. GM came from `gm_de440.tpc`, added for orbit mode.

### W3 · True albedo, from every source

The surface's brightness, with no lighting baked in:
1. **Primary map:** the owner picks the global map from side-by-side comparison images (SS-5).
2. **Poles and gaps:** filled from other instruments, calibrated where the maps overlap. Record the fit (r, RMS) and blend across a stated band.
3. **Remaining gaps:** filled only from another measurement, matched locally to the surroundings.
4. **Absolute scale:** calibrated to the published geometric albedo. Checked against named features from the IAU Gazetteer.

Where nothing measured a region, it stays a gap. How to show it is the owner's call for each world: after the Moon, not as a distracting colour.

**Moon:**
- Clementine 750 nm as the primary map (SS-5).
- LOLA's polar laser albedo poleward of 65–75° (SS-6b).
- LOLA's global map for the last 0.06% (SS-11c, fit r 0.92).
- Calibrated to p = 0.12.

### W4 · Terrain for the website

Quantized-mesh tiles from the best global elevation model:
- **Compression:** stored gzip-compressed, inflated in the browser.
- **Global levels:** as deep as the world's share of the Pages budget allows.
- **Finer regions:** in boxes where finer data exists.
- **Budget:** the build fails over budget. CI caches the built tiles.

When a world's detail outgrows its share of the 1 GB, its tiles move to a data repository of its own. Each repository gets its own Pages site and its own 1 GB, and Pages allows cross-site reads. The owner creates that repository.

**Moon:** LOLA `LDEM_64` everywhere to level 7 (670 m), with finer boxes around Albategnius. 46,743 tiles, 671 MB (SS-10, SS-11b part 2).

### W5 · Local mode: everything measured, on demand

`npm run local` builds any tile on first view from the publishers' own files:
- **Fetching:** HTTP range requests per block, or the whole file where a server ignores ranges.
- **Caching:** blocks and tiles are kept on disk.
- **Registration:** each finer product is checked against the global one (shift and vertical offset recorded) before it is used.
- **Fall-through:** a missing value at a vertex falls through to the next product. Nothing is filled in.

**Moon:** LOLA at 16, 64, 128 and 512 pixels per degree, SLDEM2015, and Kaguya at 8.4 m (SS-10c).

### W6 · Labelled approximation below the measurements (optional)

Only if the owner asks for it, for that world:
- **Where:** local mode only, off by default.
- **Label:** on screen for as long as it is on.
- **Measurements:** it passes exactly through every one (a unit test proves it).
- **Statistics:** from cited sources or the world's own measured data.
- **Checks:** never in a checked capture.

**Moon:** craters from NASA's DSNE equilibrium counts. Roughness was measured from LROC NAC stereo models (SS-10b).

### W7 · The world's page

A page at `/<world>/` (SS-13):
- **Home page:** the world's entry becomes a link.
- **Way back:** an "← Solar System" link.
- **About text:** where each dataset came from.
- **Orbit mode** (SS-11b):
  - Gestures set the height, then Orbit starts from there, heading in a random direction.
  - Pinch changes the height in flight, and the real circular speed follows it.
  - The orbit never goes below the lowest height the website's terrain stays sharp from: at most 3 device pixels per measured sample.
  - Time can run ×10 or ×100, labelled.
- **Captures:** a view from orbit and a close view with relief, each with a checked expectation where one can be written. Baselines change in their own commit, with before and after images.
- **Allocation:** the frame loop allocates nothing (`npm run alloc`).

**Moon:** `/moon/`. Orbit comes down to about 620 km on an iPhone.

### W8 · Neighbours in the sky

The bodies near the world are drawn where the ephemeris puts them, at true brightness, so they come and go as the world turns and the orbit carries on. The Moon has Earth; Mars has Phobos and Deimos; Jupiter's moons have Jupiter.

This is the owner's "objects in the background coming and going". A neighbour is drawn from its own world's data once that world exists. Until then it is a point or a disc, labelled as such.

**Moon:** Earth, sunlit, rising ahead over the south pole on the Orbit button's orbit (SS-13b).

## How each round is run

- **One PR per change.** Each PR says:
  - what was checked by machine;
  - what needs the owner's eyes on the iPhone;
  - what was not checked.
- **Owner decisions** are quoted in the story that acted on them, with the date.
- **Conventions:** longitude sign, latitude, datum, frame, projection and units are cited from each product's own label in the PR.
- **Checksums:** every download is checksummed. Where the publisher gives none, it is pinned from the first download, after checking it against the label (size, minimum, maximum).
- **The cloud has no GPU.** SwiftShader proves correctness, never speed. Frame rate is measured only on the owner's devices.

## What each world round costs

The Moon took three days from its data story (SS-5) to orbit mode with gap-free albedo (SS-11c). Most of that time went into data, not code:
- a 4.25 GB download;
- polar projection conventions whose own formula disagreed with their prose;
- a registration check between Kaguya and LOLA;
- the Pages budget.

The next world reuses the whole pipeline. So the expected cost of a round is the data: W1, W3 and W4.
