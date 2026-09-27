# SS-13e · Earthshine on the Moon's night side

Status: **done** · 2026-09-27

As a learner on the Moon's night side, I want to see it lit by Earth, as the "da Vinci glow" lights a crescent Moon, with Earth's light as the satellites measured it.

## Owner decisions, 2026-09-27

- "What is the next story" was answered with this one, recommended.
- The owner replied: "Yes merge and build the story and merge again". So this spec was approved with the build and merged with it, in one PR.

## The physics, and what it means on screen

**How strong earthshine is.** Earth, seen from the Moon, is a disc of mean radiance factor I/F_disc, averaged over its whole disc, dark part included. On a surface facing it squarely it puts E / F = I/F_disc · (R/d)², with R Earth's radius and d its distance. The derivation is in `core/photometry.ts` `earthshineFactor`, and a unit test integrates the disc numerically.
- At the first-quarter instant, the satellites' map gives I/F_disc = 0.070 / 0.082 / 0.094 in red, green and blue (SS-13c; `public/data/earth/faces.json`, `discIOverFFromMoon`).
- So earthshine is about 1/50,000 of sunlight, bluish, because Earth is.

**How the Moon scatters it.** The Moon scatters Earth's light as it scatters the Sun's: Lommel–Seeliger with Earth's direction in place of the Sun's, times that factor. On terrain, Earth sets behind the horizon over its own angular radius, as the Sun does.

**Why a second exposure.** At the app's sunlit exposure, earthshine is a few millionths of display white (about 5 × 10⁻⁶ for highlands at first quarter). That rounds to black in every pixel: no existing capture changed. That is also true of real photographs, where a camera set for the sunlit Moon shows a black night side. Photographers expose earthshine separately, many stops longer, and the sunlit crescent burns out.

## Owner feedback, 2026-09-27, and the redesign

The first version shipped a labelled **"Exposure: earthshine"**: one camera exposure 16 stops (×65,536) longer.

The owner: "The earthshine is too bright, everything is blown out except for a small surface of moon … earthshine should be expose dark side of moon and sunlight the other in a balanced way."

**What was wrong.** The earthshine physics was right, the display design was not. One long exposure makes every sunlit surface 65,536 times brighter too. In orbit most of the view is sunlit, so almost everything went to white. The photographs that show both sides in balance are composites of two exposures.

**Now: "Earthshine: boosted"**, a labelled toggle beside "Stars: boosted", like it:
- **The sunlit Moon, Earth and the stars are unchanged.**
- **Earthshine is drawn 2¹³ (8,192) times brighter, only where the Sun is down.** Its extra weight fades out as the sunlit display value rises through 0.05 (`core/photometry.ts` `EARTHSHINE_BOOST_STOPS`, `SUNLIT_FADE`).
- **Result:** earth-lit highlands show at about 0.04 of display white, as bright as sunlit ground a few degrees past the terminator. So the two sides meet without a jump or a seam, and the sunlit side keeps its normal contrast.
- **The note on screen** says it is brighter than physics, and by how much.

Physical earthshine, the default, is unchanged: at the sunlit exposure it is a few millionths of white, as in every photograph of the sunlit Moon.

## What was built

- `core/photometry.ts`:
  - `earthshineFactor(discIOverF, R, d)`, `EARTHSHINE_BOOST_STOPS` and `SUNLIT_FADE`;
  - tests: the formula against a numerical integral over Earth's cone, and the magnitude, 1/30,000 to 1/100,000 of sunlight for a half-lit Earth.
- `pipeline/earth.py`: `disc_i_over_f` records each instant's disc I/F from the map as stored. `test_earth.py` checks the recorded value against the committed map. The map itself is byte-identical.
- `src/scenes/moon.ts`: the earthshine term on the sphere and on terrain, coloured by Earth, and the boost where the Sun is down.
- `src/main.ts`:
  - the "Earthshine: physical / boosted" toggle;
  - About text for both;
  - no earthshine at the full-Moon instant, where Earth's face is not built (SS-13d). Its light falls on the day side then anyway, since the night side is the far side.
- **Capture:** the new `moon-earthshine`, first quarter from over Oceanus Procellarum with the boost on.

![Earthshine at first quarter, boosted where the Sun is down](ss13e-earthshine.png)

## Checks

- **Unit:** the earthshine factor against numerical integration, and its magnitude. The recorded disc I/F matches the map.
- **Captures:** every existing capture is unchanged, as the physics says it must be at the sunlit exposure. `moon-earthshine` is new.

## Not verified

- **Published earthshine photometry:** the brightness has not been compared with published measurements (for example, Big Bear Solar Observatory's earthshine series). It follows from the satellites' measured Earth and the Moon's photometry alone.
- **Earth's size:** Earth is treated as a point for the Moon's scattering. It spans 1.9°, which changes nothing visible.
- **The owner's iPhone:** how it looks there.

## Effort

Part of one session, 2026-09-27.
