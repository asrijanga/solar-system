# Mercury terrain for the solar-system app

This is the terrain the app at <https://asrijanga.github.io/solar-system/> streams for Mercury: quantized-mesh tiles, levels 0–7, with vertices about 940 m apart at level 7. They live here because Mercury needs its own GitHub Pages site and its own 1 GB (owner, 2026-10-08).

Nothing in this repository is edited by hand. `.github/workflows/pages.yml` builds the tiles from the app repository, at the commit named in `SOURCE`, and deploys them. How they are made, and every check, is in the app repository's `docs/stories/SS-16.md` (W4).

## Sources and credit

- **USGS global DEM v2:** MESSENGER MDIS stereo, 64 px/deg (PDS `MESSDEM_1001`), Becker et al. (2016). Used south of 70° N.
- **MLA:** MESSENGER Mercury Laser Altimeter gridded topography, version 2.0 (PDS `messmla_2001`), Smith et al. Used north of 80° N, and moved into the DEM's frame.

The two are faded across 70–80° N. `terrain/terrain-source.png` shows where each was used.
