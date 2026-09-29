# SS-11f · Orbit from anywhere

Status: **built** · 2026-09-29

As a learner, I want to start orbiting from anywhere, so I can choose what I fly over and watch Earth rise from any angle.

## Owner decision, 2026-09-29

"Before we go to the next story, lets fix orbit, we chose to start orbit from a specific point, let's change that decision, users can start orbit anywhere they want and pinch to zoom in. That way they can see the earth rise etc or be im a totally different angle."

This replaces SS-15's "Fix the best spot first or a known spot and start the orbit there", under which every orbit started over Albategnius heading due north.

## What changed

- **Where it starts** (`orbitAlongView`, `src/core/orbit.ts`): the Orbit button starts over the point directly below the camera, flying towards the top of the screen.
  - That direction along the ground is the surface part of the camera's forward direction plus its screen-up direction:
    - looking straight down, forward has no surface part and screen-up gives the direction;
    - looking at the horizon, screen-up points away from the ground and forward gives the direction;
    - in between, both point the same way.
- **Unchanged:**
  - The height is still the one the gestures left the camera at, never below the lowest height the terrain stays sharp from.
  - The speed is still the real circular speed for that height.
  - Pinch and scroll still change the height in flight.
  - The camera still glides onto the orbit (SS-15) and tilts up for a rising Earth (SS-11e). From your own view the glide is short.
- **About text:** the Orbit line now says how to use it: turn the Moon to any spot, choose the height, press Orbit. To watch Earth rise ahead, start over the far side flying towards the near side.
- **Captures unchanged:** the checked views `moon-orbit`, `moon-orbit-labels` and `moon-earthrise-tilt` still place their orbits over Albategnius, through the viewpoints' own `orbitFrom`. They are fixed views for checking, not the button's start.

## Checks

- **Unit tests** (`src/core/orbit.test.ts`, 4 new):
  - Looking straight down with north at the top: the orbit starts below the camera, heads north, at the chosen height and circular speed.
  - Looking at the horizon to the east: it heads east.
  - Pitched down 30°: it heads where the view points along the ground.
  - A view with no direction along the ground is refused.
- **Browser run** (headless Chromium, SwiftShader):
  - Placed over Mare Crisium (59° E, 17° N), 700 km up, with labels on, then Orbit pressed.
  - After 12 s the view looks north over the limb from there, with Posidonius (30° E, 32° N) at the left, as flying north from Crisium puts it. Under the old start it would have glided to Albategnius, 4° E, 11° S.
  - No page errors.
- `npm run check`: 181 tests pass.

## Not verified

- On the owner's iPhone: how the start feels with touch gestures, and the glide from a low, tilted view.
- Earthrise from an arbitrary orbit: the tilt (SS-11e) is generic in Earth's direction, but only the Albategnius orbit's earthrise is a checked capture.
