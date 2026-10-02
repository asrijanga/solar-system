# Mars terrain for the solar-system app

The terrain the app at <https://asrijanga.github.io/solar-system/> streams for Mars: quantized-mesh tiles, levels 0–7, with vertices 1.31 km apart at level 7. They live here because Mars needs its own GitHub Pages site and its own 1 GB (owner, 2026-10-02).

Nothing in this repository is edited by hand. `.github/workflows/pages.yml` builds the tiles from the app repository, at the commit named in `SOURCE`, and deploys them. How they are made, and every check, is in the app repository's `docs/stories/SS-14.md` (W4).

## Sources and credit

- **MOLA:** Mars Global Surveyor MOLA MEGDR, 64 px/deg (PDS `MGS-M-MOLA-5-MEGDR-L3-V1.0`), Smith et al. (2003).
- **HRSC:** Mars Express HRSC stereo DTMs, the strips listed in `terrain/terrain.json` (PDS `MEX-M-HRSC-5-REFDR-DTM-V1.0`). Credit: ESA/DLR/FU Berlin (CC BY-SA 3.0 IGO).

The tiles combine HRSC data, so they are shared under the same licence, [CC BY-SA 3.0 IGO](https://creativecommons.org/licenses/by-sa/3.0/igo/). `terrain/terrain-source.png` shows where each source was used.
