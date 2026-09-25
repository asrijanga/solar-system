# Moon: data inventory

The owner's rule of 2026-09-25: gather every available dataset first, then recreate the world from the whole inventory (README, "Gather first, then build"). This file is that inventory for the Moon. It was started after the Moon had been built product by product, and the rebuild from it is still to come.

**Status legend:**
- **used:** shipped in the app.
- **rejected:** evaluated and not used, with the reason.
- **ground truth:** used only to check other data.
- **to evaluate:** known to exist, not yet examined; the figures quoted are not yet verified.

## Albedo and imagery

| Dataset | Status | What was established |
| --- | --- | --- |
| Clementine UVVIS 750 nm mosaic v2.1, 118 m (USGS) | used | Low-phase, so shading is mostly absent except near the poles. 0.886% never imaged, mostly polar. Relative albedo only, calibrated to geometric albedo 0.12 (SS-5, SS-6) |
| LOLA LDAM polar normal albedo, 1 km, 50° to the poles (Lemelin et al. 2016, PDS) | used poleward of 65–75° | 1064 nm, laser-lit, so no shading. Fitted to Clementine at 50–60° (r 0.73 / 0.77). Faint track stripes (SS-6b) |
| LRO WAC global morphology mosaic, 100 m (USGS) | rejected | Shading baked in: `DATA_SET_ID` is `WAC_morphology_globe` (SS-5) |
| Kaguya TC ortho mosaic, 64 ppd (USGS) | rejected | Shading baked in, lit from one side (SS-5) |
| LOLA 1064 nm albedo, 10 ppd (USGS mosaic) | rejected | Individual ground tracks with calibration stripes; correlation with Clementine about 0 (SS-6) |
| LROC WAC Hapke-normalised mosaic | to evaluate | The best candidate albedo map. The LROC archive listing could not be read from the cloud environment (SS-5) |
| Kaguya Multiband Imager (MI) reflectance | to evaluate | |
| LRO NAC images | to evaluate | Metre scale, local only; for close-up detail (SS-10 onwards) |

## Elevation

| Dataset | Status | What was established |
| --- | --- | --- |
| LOLA LDEM_64 gridded shape map, 474 m (PDS) | used | Global. Normals at 2.6 km and heights at 10.7 km in the app (SS-8) |
| LOLA LDEM 128 / 256 / 512 ppd and LDEM_1024 tiles (PDS) | to evaluate | Listed in the PDS directory; finer global and tiled grids for zooming in |
| LOLA polar DEMs (PDS, `lola_gdr/polar`) | to evaluate | Listed alongside the LDAM products |
| SLDEM2015, LOLA with Kaguya TC stereo, about 59 m, ±60° | to evaluate | Fewer interpolation artefacts between LOLA tracks |
| Chang'E-1 laser altimetry (Li et al. 2010) | ground truth | Highest and lowest points agree with LOLA within 0.13 and 0.06 km (SS-8) |
| Chang'E-2 DEM | to evaluate | |

## Geometry, orientation, names

| Dataset | Status | What was established |
| --- | --- | --- |
| JPL DE440 ephemeris and lunar orientation (NAIF kernels) | used | `MOON_ME`, matched to Horizons within about 1e-5° (SS-5) |
| PCK `pck00011.tpc` | used | Radius 1737.4 km |
| IAU Gazetteer of Planetary Nomenclature | ground truth | Feature positions and diameters for checks |

## Other layers

| Dataset | Status | Notes |
| --- | --- | --- |
| Illumination and permanent-shadow maps (LOLA-derived) | to evaluate | For checking shadows (SS-8 part 2) |
| Diviner surface temperature | to evaluate | |
| Mini-RF radar | to evaluate | Sees into the permanently shadowed craters |
