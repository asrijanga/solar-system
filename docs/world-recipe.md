# The world recipe

How every world is built, taken from how the Moon was actually built (SS-5 to SS-15, 2026-09-24 to 26), and how Earth was first drawn from real data in the Moon's sky (SS-13c, 2026-09-27). Each world is one round of the same eight stories. They run in this order, one PR per change.

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
- **"Fix the best spot first or a known spot and start the orbit there."** Orbit mode starts over a named landmark, not at random (SS-15).
- **"Smoothly take the viewer to the starting point instead of it being jerky."** Nothing on screen jumps: the camera glides onto the orbit (SS-15).
- **"Labels on the popular landmarks … slowly fading in and out (maybe reacting to sunlight) … legible from the orbiting path."** Names come and go with the horizon and the daylight, and stay readable from orbit (SS-15).
- **"We need to emulate real earth details at this distance."** Then: **"Satellites at that moment"**, **"Yes, colour."** A neighbour in the sky shows what was really there at that instant, measured (SS-13c).

## The eight stories

### W1 · Inventory: every dataset, before any code

Write `docs/data/<world>.md`: every mission and instrument that measured the world. For each one, record:
- coverage and resolution;
- wavelength, and whether the lighting is baked in;
- frame and datum, cited from the product's own label;
- known artefacts;
- licence, download URL, and whether a checksum is published.

Mark each dataset used, rejected (with the reason) or to evaluate.

Also record, for each source:
- **Whether the cloud can reach it**, checked by downloading or listing it, with the date. A host the environment blocks is a fact to plan around, not a surprise mid-build.
- **Whether it needs an account.** The owner creates the account, and its keys go into the environment's secrets, never into chat (Earth: Meteosat needs a EUMETSAT account).
- **The licence in the publisher's own words**, quoted, including any attribution it asks for.

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

**Moon:** `pipeline/ephemeris.py`, `public/data/moon/ephemeris.json`. GM came from `gm_de440.tpc`, added for orbit mode. Earth's orientation at each epoch (`IAU_EARTH`, taken when its light left for the Moon) was added for SS-13c.

**Checked against:** JPL Horizons, with the request and the returned rows pinned as a test fixture (`test/fixtures/horizons-*.json`). Horizons gives Earth's latitudes as geodetic, so the test converts them before comparing.

**Mars** (SS-14): `pipeline/ephemeris_mars.py`, `public/data/mars/ephemeris.json`, with Phobos and Deimos from `mar099s.bsp`, at the Moon's two instants so the app keeps one clock.
- **Horizons' conventions:** Horizons gives Mars's longitudes west-positive and its latitudes planetodetic. Read them from its header for every world.
- **Light time:** check the vectors the app draws against Horizons seen from somewhere close to the world, not from Earth. From Earth Mars is seen 20 minutes late, and has turned 5° by then.

### W3 · True albedo, from every source

The surface's brightness, with no lighting baked in:
1. **Primary map:** the owner picks the global map from side-by-side comparison images (SS-5).
2. **Poles and gaps:** filled from other instruments, calibrated where the maps overlap. Record the fit (r, RMS) and blend across a stated band.
3. **Remaining gaps:** filled only from another measurement, matched locally to the surroundings.
4. **Absolute scale:** calibrated to the published geometric albedo. Checked against named features from the IAU Gazetteer.

Where nothing measured a region, it stays a gap. How to show it is the owner's call for each world: after the Moon, not as a distracting colour.

**The side-by-side comparison** is rendered the way the app will show it: the app's own photometry (display = exposure · I/F / r²), at the app's own instant and viewpoint, full size and at the size it will be on the owner's phone (`pipeline/compare_moon_products.py`, `pipeline/compare_earth_products.py`).

**Conventions to establish from the files themselves, every time** (each one bit SS-13c):
- **The reflectance scale.** Is it relative to the Sun's irradiance at 1 AU or on the day? Check by comparing a calibration constant across two dates: Himawari's c′ is the same in January and July, so it is relative to 1 AU. GOES's κ0 includes the day's Earth–Sun distance.
- **The latitude.** Satellite navigation (CGMS, the GOES-R PUG) works in geodetic latitude, and planetary maps are usually planetocentric. They differ by up to 0.19° on Earth.
- **Pixel centres.** Whether a coordinate names a pixel's centre or its corner, and whether indices start at 0 or 1. A unit test at the sub-satellite point caught a half-pixel error.

**Cross-calibrate only in matching geometry.** Two instruments seeing the same place from different directions differ because of how the surface scatters light, not only because of calibration. Late in the day Himawari and GOES differed by up to 2× where they saw the same clouds from opposite sides. Fit them only where they saw a place in mirror geometry (the same view zenith and phase angle, within a stated tolerance chosen before the fit), from a scan pair when that geometry exists. Where they still differ, prefer the one that saw the place more as the app's viewer does.

**Viewer-dependent effects belong to the viewer.** Sun glint on water, and the bright spot opposite the Sun, sit where that instrument was. Down-weight them there, and say that the app's own viewer would see them elsewhere.

**A world with weather is an instant.** Clouds change hourly, so the albedo of Earth, Mars in a dust storm, or Titan is a measurement at a stated time, and the scene uses that time.

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
  - Gestures set the height, then Orbit starts from there, over a named landmark chosen for what the orbit passes, heading along a stated direction (the Moon: Albategnius, due north).
  - The camera glides onto the orbit from wherever it was: a great-circle turn round the world (never through it), distance changing geometrically, attitude by the shortest rotation, eased in and out. A unit test proves the glide starts at the old view, moves in small steps, stays outside the world, and ends exactly on the orbit.
  - Pinch changes the height in flight, and the real circular speed follows it.
  - The orbit never goes below the lowest height the website's terrain stays sharp from: at most 3 device pixels per measured sample.
  - Time can run ×10 or ×100, labelled.
- **Labels** (SS-15): popular landmarks from the IAU Gazetteer, with names, centres and diameters exactly as the Gazetteer gives them. The only hand-typed parts are which features to show, plus the mission name for each landing site, checked against the Gazetteer's own note. They are drawn at a fixed on-screen size in a font bundled with the site. The shader fades them with the horizon, the daylight and their apparent size; a button fades them all in or out.
- **Captures:** a view from orbit and a close view with relief, each with a checked expectation where one can be written. Baselines change in their own commit, with before and after images.
- **Allocation:** the frame loop allocates nothing (`npm run alloc`).

**Moon:** `/moon/`. Orbit comes down to about 620 km on an iPhone.

### W8 · Neighbours in the sky

The bodies near the world are drawn where the ephemeris puts them, at true brightness, so they come and go as the world turns and the orbit carries on. The Moon has Earth; Mars has Phobos and Deimos; Jupiter's moons have Jupiter.

This is the owner's "objects in the background coming and going". A neighbour is drawn from real measurements of it, at the scene's instant, as soon as they exist. That can be long before the neighbour's own round: Earth in the Moon's sky needed only its W1 inventory and a W3 at the Moon's distance (SS-13c). Until then it is a point or a disc, labelled as such.

**Its orientation** comes from SPICE, and a unit test proves that a texel at a given longitude and latitude lands where SPICE puts that place, so the map is neither mirrored nor turned.

**Its brightness as a plain disc** must use a phase law consistent with its Bond albedo, not a Lambert sphere of its geometric albedo. For a world with air or cloud those differ by about 2× away from full phase: a Lambert sphere of Earth's geometric albedo, 0.434, would reflect 65% of the sunlight it gets, and Earth reflects 30.6%.

**Moon:** Earth, rising ahead over the south pole on the Orbit button's orbit (SS-13b). At the first-quarter instant it shows what Himawari-9 and GOES-18 measured at 2026-01-26 05:00 UTC: clouds, oceans, air and terminator, in colour (SS-13c). The full-Moon instant still shows a plain disc; it needs Meteosat.

## How each round is run

- **One PR per change.** Each PR says:
  - what was checked by machine;
  - what needs the owner's eyes on the iPhone;
  - what was not checked.
- **Owner decisions** are quoted in the story that acted on them, with the date.
- **Conventions:** longitude sign, latitude, datum, frame, projection and units are cited from each product's own label in the PR.
- **Checksums:** every download is checksummed. Where the publisher gives none, it is pinned from the first download, after checking it against the label (size, minimum, maximum).
- **The cloud has no GPU and no Safari.** SwiftShader proves correctness, never speed, and only Chromium can be tested there. Frame rate, and anything that only happens in Safari on the iPhone, can be seen only on the owner's devices. When the owner reports a problem there, ask what exactly is on screen (black page, error box, missing element) before changing anything.
- **Captures are the same on every machine.** Nothing a capture shows may depend on what is installed where it runs: fonts are bundled, never taken from the system (CI caught 0.058% of pixels differing when labels used `system-ui`).
- **A check whose reference turns out to be wrong** is fixed by correcting the reference, never by loosening its tolerance, and the owner approves the change in the PR before merge (SS-13c: the Lambert-sphere reference above).

## What each world round costs

The Moon took three days from its data story (SS-5) to orbit mode with gap-free albedo (SS-11c). Most of that time went into data, not code:
- a 4.25 GB download;
- polar projection conventions whose own formula disagreed with their prose;
- a registration check between Kaguya and LOLA;
- the Pages budget.

Earth as a neighbour (SS-13c) took about one working session and 1.6 GB of satellite data. Most of that time went into the cross-calibration, when the two satellites' disagreement turned out to be the surface's scattering rather than calibration, and into conventions: each instrument's reflectance scale, geodetic latitude and pixel centres.

The next world reuses the whole pipeline. So the expected cost of a round is the data: W1, W3 and W4.
