# Solar System

An interactive 3D model of the Solar System, built with [Three.js](https://threejs.org) and real NASA imagery.

**Live site:** https://asrijanga.github.io/solar-system/

## What's in it

It opens with a fifty-second cold open: the camera starts inside the Sun's corona, dives to Earth, then pulls back until the whole system is a smudge against the Milky Way. Skip it with `Esc`, replay it with `R`.

- **True scale by default.** Sizes and distances are real, so Earth is a point of light. That is the honest picture, and the opening sequence teaches you how to read it. Press `T` for the compressed, exaggerated view when you want the whole system on one screen.
- **Real NASA maps of every world.** Blue Marble and Earth-at-Night for Earth, LRO for the Moon, MESSENGER for Mercury, Magellan for Venus, Viking for Mars, Cassini for Jupiter and Saturn, Voyager 2 for Neptune and Triton, New Horizons for Pluto and Charon, plus Io, Europa, Ganymede, Callisto, Titan and Enceladus.
- **The Milky Way backdrop** is NASA's Tycho-2 all-sky map, with NASA's constellation figures available as an overlay (`C`).
- **Planets are where they really are.** Positions come from JPL's Keplerian elements for the current date, and the clock runs from real time up to 22 years per second.
- **A live Sun.** The Sun's panel shows NASA Solar Dynamics Observatory's latest extreme-ultraviolet image.
- **Earth's day and night.** City lights fade across the terminator, oceans glint, clouds drift, and Earth is rotated so the sub-solar longitude matches UTC.
- **Saturn's rings at true radii**, with the Cassini Division and Encke gap, the planet shadowing the rings and the rings shadowing the planet.
- **Halley's Comet** on its real retrograde orbit, growing a tail as it nears the Sun.
- **21,000 asteroids, Kuiper belt objects and Jupiter trojans** orbiting on the GPU.
- **Click any world** for facts, live distances and light-travel times, your weight and age there, and the NASA source of its imagery.
- **Calm rotation.** Rotation periods here span 762x, from Phobos at 7.6 hours to Venus at 5832, so no single clock rate suits them all: fast enough for Venus to move and Jupiter is a blur. Spin is therefore decoupled from the simulation clock and every period is compressed into a narrow band, anchored on the slowest body. Venus turns once every seven minutes instead of forty-six hours, Jupiter every two, and the order is preserved. Orbital positions of the planets are untouched and stay truthful, and the panels still report real day lengths. Turn it off in settings for literal spin tied to the clock.
- **A lofi soundtrack, played live.** A slow swung boom-bap beat under a Rhodes electric piano, with upright bass, a soft pad, tape wow and flutter, and vinyl crackle. Nothing is sampled: the Rhodes is FM synthesis, the drums are synthesised, and the crackle is generated noise. A single intensity value arranges it, so the beat walks in as the opening pulls away from Earth. 74 BPM, an eight-bar turnaround, and enough randomness in timing, velocity and fills that it never loops identically.

## Controls

| Key | Action |
| --- | --- |
| `0`–`9` | Fly to the Sun, Mercury … Pluto |
| `H` | Halley's Comet |
| `Space` | Pause / resume time |
| `[` `]` | Slower / faster |
| `N` | Jump to now |
| `T` | Toggle true scale |
| `R` | Replay the opening |
| `C` | Constellation figures |
| `Space` | Pause time and rotation |
| `?` | Show all keys |
| `M` | Music on / off |
| `F` | Fullscreen |
| `Esc` | Close panel and stop following |

Drag to orbit, scroll to zoom, click a planet or its label to fly there.

## Running locally

It is a static site with no build step. Serve the folder with any static server, for example:

```
python3 -m http.server 8080
```

then open http://localhost:8080/.

## Deployment

`.github/workflows/deploy-pages.yml` publishes the repository root to GitHub Pages on every push to `main`.

## Credits

- Planet and moon maps: NASA, NASA/JPL, NASA/JHUAPL, NASA/GSFC Scientific Visualization Studio, and the [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) collection. Each world's info panel links to its source.
- Sky map: NASA/Goddard Space Flight Center Scientific Visualization Studio, Tycho-2 catalog.
- Orbital elements: [JPL Solar System Dynamics](https://ssd.jpl.nasa.gov/planets/approx_pos.html).
- Uranus has no NASA global map, so its surface is procedural, matched to Voyager 2 and Hubble colour. Phobos and Deimos are procedural too.
- Three.js is MIT licensed. Project code is under the MIT License (see `LICENSE`).
