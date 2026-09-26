# SS-11b · Orbit mode: a real orbit, flown for you

Status: **in review** · Release 3 · 2026-09-25

As a learner, I want to sit back and orbit the Moon, low enough to see its terrain but never so low that it turns blurry, without steering it with my fingers.

## Owner decision, 2026-09-25

The owner said: "I am not going to host it anywhere else, github pages is fine. We will have to work around it … can i enter an orbit mode where you randomly select the altitude and direction and put me in orbit in a cinematic mode with objects in the background coming and going. It should be close enough where i can see terrain but at a distance where I should not see blurry terrain."

That gives three things to deliver:

1. **Orbit mode,** in this story.
2. **Sharper terrain that fits on GitHub Pages,** so the orbit can come lower. This is part 2 below, in its own PR.
3. **"Objects in the background coming and going".** Nothing but the Moon and stars is rendered yet. Earth needs its own data story, with its own inventory and sources. Stars are drawn at their true brightness next to a sunlit Moon, which is almost invisible, as it is to a real eye or camera. Neither is faked here.

## What it does

- **An "Orbit" button.** It puts the camera in a random circular orbit around the Moon. The gestures step aside while it flies, and pressing it again hands control back. `?orbit` in the URL starts a random orbit, and `?orbit=<seed>` repeats a given one, so a view can be shared.
- **A real orbit.** The speed is the circular orbital speed √(GM/r), using the Moon's GM from the same SPICE kernel set as the ephemeris: `gm_de440.tpc`, BODY301_GM = 4902.800118457549 km³/s², SHA-256 pinned in `pipeline/ephemeris.py`. At real speed, 1.3 to 1.5 km/s, one orbit takes about two to three hours. A "Time" button runs it ×10 or ×100, and a note says so whenever it is not real speed.
- **Random but always worth seeing:**
  - **Plane:** the orbit plane's normal is uniform on the sphere, so any inclination and direction.
  - **Height:** from the lowest sharp height (below) up to 1.5 times it.
  - **Start:** over ground where the Sun is 8° to 35° above the horizon, so the relief casts its shading. The flight then carries on round, through the terminator and over the night side, as a real orbit does.
- **Framing:** the camera looks ahead along the track, tilted down so the horizon sits 35% of the half-height above the centre of the view. The curved limb shows against black space.

## Never blurry: how low it goes

The height is chosen so that nothing on screen is magnified past its data.

- **Nearest ground:** the ground nearest the camera is at the bottom edge of the frame. The height is found by bisection so that a measured sample there spans at most 3 device pixels.
- **The sample:** the finest terrain level the site has everywhere on the Moon, or half the albedo map's texel, whichever is coarser. Brightness varies more gently than shape, so it may take twice the size on screen.
- **Depends on the screen:** a taller screen in device pixels needs more distance for the same sharpness.
- **Code:** `sharpHeightKm` in `src/core/orbit.ts`, unit-tested.

| Terrain everywhere | Sample | Capture (1024 px) | Laptop (1600 px) | iPhone (2532 px) |
| --- | --- | --- | --- | --- |
| Level 5, today's website | 2.67 km | 1037 km | 1624 km | 2481 km |
| Level 6 | 1.33 km | 492 km | 800 km | 1289 km |
| Level 7, part 2 | 0.67 km | 226 km | 374 km | 621 km |

Heights are from the 1737.4 km sphere, with a 50° vertical field of view and at most 3 px per sample.

## Part 2: sharper terrain within GitHub Pages (separate PR)

GitHub Pages publishes at most about 1 GB, counted uncompressed. The website's terrain stops at level 5 (2.7 km) everywhere, and adds finer levels only around Albategnius.

- **Store compressed tiles.** Pages already sends `.terrain` files gzip-encoded in transit, but counts their full size against the limit.
  - **Build:** writes each tile gzip-compressed, measured at 81.6 KB down to 14.0 KB per tile.
  - **Browser:** a terrain plugin recognises the gzip header (1f 8b) and inflates the tile with the browser's own `DecompressionStream`.
  - **Local mode:** tiles from the local server stay uncompressed and pass straight through.
- **Global levels 6 and 7** (1.33 km and 0.67 km) from LOLA LDEM_64 (474 m), about 41,000 more tiles. The budget is checked in CI.
- **Result:** orbit comes down to the last row of the table: about 620 km on the iPhone.

## Checks

- **Unit tests** (`src/core/orbit.test.ts`):
  - Circular speed at 100 km and 1000 km against the textbook values (1.6335 and 1.3383 km/s).
  - Horizon dip.
  - Ray-to-ground distance.
  - The sharp height meets its pixel limit exactly.
  - A seed always gives the same orbit.
  - Every random orbit starts with the Sun 8° to 35° up, between 1 and 1.5 times the minimum height, on a unit orthogonal plane basis at circular speed.
- **Capture:** `moon-orbit`, seed 7 at first quarter, the start of a random orbit. It is a new baseline, and every existing capture is unchanged.
- **Flight tests** (`src/scenes/orbitFlight.test.ts`):
  - For three seeds, the camera is where the orbit maths puts it at the start, 100 s later, and after switching to ×100 with no jump.
  - The view's centre is exactly `viewDepression` below the local horizontal, heading along the track, with no roll.
  - Reversing the direction of travel, or the heading, fails them.
- **Allocation:** CI runs `npm run alloc` a second time with `?orbit=7`.
  - Orbit mode draws terrain to the horizon, so SwiftShader renders it more slowly: 600 frames took 524 s locally, and on CI the 600 warm-up frames overran the script's 900 s wait.
  - Its wait limit is now 30 minutes for every run. That is a wait, not a pass criterion: the rule is still 0 B sampled in `src/`.

## As built (2026-09-26)

**The frame path took four tries to make allocation-free.** Each was measured with `npm run alloc -- orbit=7`.

1. **146 B, then 74 B per frame:** computing the pose in typed arrays and passing numbers to three's vector setters.
2. **24 B per frame:** doing every sum with three's vector and quaternion methods instead.
3. **24 B again,** after fixing a separate bug. three's animation loop makes its first call with no timestamp, and that would have made the orbit's angle NaN in the live app. `frame` now ignores such a call, and a test covers it. The capture renders only the starting pose, so it could not show this.
4. **0 B:** the final version.
   - It does its arithmetic in one typed array.
   - It hands three the camera's whole matrix in a single `fromArray` call, with `matrixAutoUpdate` off while flying. `release` restores position, quaternion and up for the gestures.

**How the cause was narrowed down:**
- **V8's trace:** with `--trace-opt --trace-deopt`, V8 optimised the flight with Maglev and never deoptimised it, so this was not unoptimised code.
- **Not in isolation:** a browser harness running the same class with real timestamps, at the check's frame counts, allocated nothing.
- **What that leaves:** the allocation came from writing fractional numbers into three's `Vector3` and `Quaternion` fields from our function, inside the full app. A matrix's elements are a plain array of doubles.
- **Unconfirmed:** why those field writes allocate only in the full app.

## Not verified by this story

- How it looks and runs on the owner's iPhone.
- The frame rate while terrain streams in behind a moving camera. The cloud has no GPU.
- Whether tiles stream in fast enough at ×100 time, over a phone connection.
