# Solar System

An interactive 3D model of the Solar System, built with [Three.js](https://threejs.org) and real NASA imagery.

**Live site:** https://asrijanga.github.io/solar-system/

## What's in it

- **Real NASA maps of every world.** Blue Marble and Earth-at-Night for Earth, LRO for the Moon, MESSENGER for Mercury, Magellan for Venus, Viking for Mars, Cassini for Jupiter and Saturn, Voyager 2 for Neptune and Triton, New Horizons for Pluto and Charon, and Galileo/Cassini mosaics for Io, Europa, Ganymede, Callisto, Titan and Enceladus.
- **The Milky Way backdrop** is NASA's Tycho-2 all-sky map (8k on desktop, 4k on mobile).
- **Planets are where they really are.** Positions are computed from JPL's Keplerian elements for the current date, and the simulation clock can be scrubbed from real time up to 22 years per second.
- **A live Sun.** The Sun's info panel shows NASA Solar Dynamics Observatory's latest extreme-ultraviolet image, refreshed every time you open it.
- **Earth's day and night.** City lights fade in across the terminator, oceans glint in the sunlight, clouds drift over the surface, and Earth is rotated so the sub-solar longitude matches UTC time.
- **Saturn's rings at true radii.** The C, B and A rings, the Cassini Division, and the Encke and Keeler gaps are built from their real distances. The planet casts a shadow on the rings and the rings cast a shadow on the planet.
- **Halley's Comet** on its real retrograde orbit, growing a tail as it approaches the Sun.
- **Asteroid belt, Kuiper belt and Jupiter trojans**, 21,000 bodies orbiting on the GPU.
- **True-scale mode** (press `T`) shows the real sizes and distances. Earth becomes a speck.
- **Click any world** for facts, live distances and light-travel times, your weight and age there, and the NASA source of its imagery.
- **A generative ambient soundtrack** composed live with the Web Audio API, so no two visits sound the same.

## Controls

| Key | Action |
| --- | --- |
| `0`–`9` | Fly to the Sun, Mercury … Pluto |
| `H` | Halley's Comet |
| `Space` | Pause / resume time |
| `[` `]` | Slower / faster |
| `N` | Jump to now |
| `T` | Toggle true scale |
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
