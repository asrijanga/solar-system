# Moon: data inventory

The owner's rule of 2026-09-25: gather every available dataset first, then recreate the world from the whole inventory (README, "Gather first, then build"). From the whole inventory the Moon's terrain and features are recreated as real geometry with true, unshaded albedo, so that lighting works out of the box for any sun angle. This file is that inventory for the Moon. It was started after the Moon had been built product by product; the albedo was rebuilt from it in SS-5b (2026-09-29).

**Status legend:**
- **used:** shipped in the app.
- **rejected:** evaluated and not used, with the reason.
- **ground truth:** used only to check other data.
- **to evaluate:** known to exist, not yet examined; the figures quoted are not yet verified.

## Albedo and imagery

| Dataset | Status | What was established |
| --- | --- | --- |
| Clementine UVVIS 750 nm mosaic v2.1, 118 m (USGS) | superseded (SS-5b) | Used from SS-5 to SS-8b. Reflectance at i = 30°, e = 0°, g = 30°, relative only. Shading baked in near the poles and strip seams, both visible beside the WAC mosaic (docs/stories/ss5b-wac-vs-clementine.png). 0.886% never imaged |
| LOLA LDAM polar normal albedo, 1 km, 50° to the poles (Lemelin et al. 2016, PDS) | used poleward of 62–70° | 1064 nm, laser-lit, so no shading. Fitted to the WAC mosaic at 50–60°: r 0.90 (north) and 0.89 (south), against Clementine's 0.77 and 0.73. Faint track stripes (SS-6b, SS-5b) |
| LOLA LDAM_10 global normal albedo, 3 km, 10 ppd (Lemelin et al. 2016, PDS `lola_gdr/cylindrical`) | used for the base map's gaps | Filled Clementine's gaps (0.06% of the map, SS-11c). The WAC mosaic has none within 70° at the app's resolution, so since SS-5b it fills nothing |
| LRO WAC global morphology mosaic, 100 m (USGS) | rejected | Shading baked in: `DATA_SET_ID` is `WAC_morphology_globe` (SS-5) |
| Kaguya TC ortho mosaic, 64 ppd (USGS) | rejected | Shading baked in, lit from one side (SS-5) |
| LOLA 1064 nm albedo, 10 ppd (USGS mosaic) | rejected | Individual ground tracks with calibration stripes; correlation with Clementine about 0 (SS-6) |
| LROC WAC Hapke photometric parameter maps, 1° (Sato et al. 2014, PDS `LROLRC_2001/DATA/SDP/WAC_HAPKEPARAMMAP`) | used, 566 nm | w, b, c, Bs0, hs per 1° tile, 70°N–70°S; θ̄ fixed at 23.657°. How every place scatters light with angle, and the absolute reflectance scale. The PDS4 label's image offset (1440) is wrong; the attached PDS3 header's (5760) is right (SS-8b) |
| LROC WAC Hapke-normalised mosaic, 400 m, 7 bands (PDS `LROLRC_2001/DATA/MDR/WAC_HAPKE`) | used, 70°N–70°S | The albedo since SS-5b: 566 nm for brightness, 415, 643 and 689 nm for colour. Absolute I/F at i = g = 60°, e = 0°, normalised with the same Hapke parameter maps the renderer uses; each pixel the median of about 40 months of images, so no shading. Agrees with the parameter maps per 1° tile: slope 0.96, r 0.988. 8 tiles of 146 MB per band, MD5 in each label (SS-5b) |
| Kaguya Multiband Imager (MI) reflectance, 9 bands 415–1550 nm, ~20 m | to evaluate, for local mode | Not downloaded. At the website's 1.3 km per texel the WAC mosaic (400 m, SS-5b) already exceeds what the texture shows; MI's 20 m would matter only for close-up local mode (owner decision 2026-09-29, SS-10d) |
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
| SLDEM2015, LOLA with Kaguya TC stereo (Barker et al. 2016), 59 m, ±60°, 32 files of 30° × 45° (PDS) | used on the website and in local mode | Website levels 0–7 within 58°, from the 128 px/deg global product averaged to 64 px/deg, blended into LDEM_64 by 60° (SS-10d). Against LDEM_64 over 171 million samples: mean −0.16 m, RMS 23.7 m, r 0.99995; the RMS is the relief Kaguya adds between laser tracks. Local mode levels 9–11 (SS-10c). km from 1737.4 km (`OFFSET`), pixel-registered, MEAN EARTH/POLAR AXIS OF DE421 |
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
