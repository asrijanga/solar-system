# Moon: data inventory

The owner's rule of 2026-09-25: gather every available dataset first, then recreate the world from the whole inventory (README, "Gather first, then build"). From the whole inventory the Moon's terrain and features are recreated as real geometry with true, unshaded albedo, so that lighting works out of the box for any sun angle. This file is that inventory for the Moon. It was started after the Moon had been built product by product, and the rebuild from it is still to come.

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
| LOLA LDEM_64 gridded shape map, 474 m (PDS) | used | Global. Terrain tiles levels 0–5, vertices 2.7 km apart (SS-10) |
| LOLA LDEM_512 (59 m), tile 45°S–0°, 0–90°E (PDS) | used around Albategnius | A byte range of the 68 GB tile (latitude 5–17°S). Agrees with LDEM_64: r 0.9998, mean difference 0.3 m. Terrain levels 6–11 (SS-10) |
| LOLA LDEM_16, LDEM_64, LDEM_128 and all 16 LDEM_512 files (PDS) | used in local mode | Levels 0–8 globally, and 9–11 poleward of 60°, streamed by block from PDS (SS-10c). Pixel-registered from 90° N and 0° E per their labels |
| SELENE (Kaguya) TC DTM_MAP_02 seamless, 8.4 m sampling, 3° tiles (JAXA DARTS, `SLN-L-TC-5-DTM-MAP-SEAMLESS-V2.0`) | used over Albategnius's floor and peak | 16-bit metres, planetocentric, east-positive, heights from the 1737.4 km sphere. Registered to LDEM_512: r 0.99992, mean difference 0.6 m, MAD 4 m, RMS 17 m (steep slopes). Best horizontal shift 3–6 m, below one sample, so none is applied. 0.015% no-data samples, filled from LOLA. Integer metres, so slopes over 20 m carry about 3° of quantisation noise. No checksum published; SHA-256 pinned. Terrain levels 12–13 (SS-10). Coverage 84° S to 84° N (JAXA's listing), 233 MB per 3° file: about 1.1 TB for the whole Moon. In local mode each file is downloaded when first needed and checked against LOLA before use (SS-10c): Tycho 1.1 m, Theophilus 0.5 m and 2.0 m. JAXA's server ignores range requests |
| LROC NAC stereo DTMs, 2–5 m (PDS4 LRO-L-LROC-5-RDR; 666 sites listed in `pds.mcp.nasa.gov`'s public archive) | statistics only (SS-10b) | Apollo 11 and Apollo 16 (2 m, float32, MD5 in their labels) set how roughness falls off below 64 m. The two sites agree within 14% after scaling. The products' README notes 0.5–1 m steps at stitched seams. Not yet used as terrain |
| LOLA polar DEMs (PDS, `lola_gdr/polar`) | to evaluate | Listed alongside the LDAM products. Needed beyond 84°, where simple cylindrical LDEM_512 is heavily stretched |
| SLDEM2015, LOLA with Kaguya TC stereo (Barker et al. 2016), 59 m, ±60°, 32 files of 30° × 45° (PDS) | used in local mode | Levels 9–11 within 60° (SS-10c). km from 1737.4 km (`OFFSET`), pixel-registered (`LINE_PROJECTION_OFFSET` −0.5 at the band's north edge). PDS answers multi-range requests, so a 256 × 256 block is one request |
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
