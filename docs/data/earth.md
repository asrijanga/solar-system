# Earth: data inventory

The owner's rule of 2026-09-25: gather every available dataset first, then build (README, "Gather first, then build"). This is story W1 of Earth's round (SS-20). It starts with what Earth needs first: **Earth as the Moon sees it** (SS-13c), a disc 1.9° across, about 80 device pixels on an iPhone in orbit.

At that size relief, city lights and coastlines finer than about 150 km cannot show. What shows is:
- where the clouds were;
- the oceans, continents and ice under them;
- the atmosphere's blue;
- the terminator.

The rest of the list is for Earth's own page and is still to evaluate.

**Status legend** (as in `docs/data/moon.md`): **used**, **rejected** (with the reason), **ground truth**, **to evaluate**.

**Checked from the cloud, 2026-09-26:** each source below marked reachable was downloaded or listed from this environment on that date.

## Earth's face at a given instant (for SS-13c)

The app shows two instants: 2026-01-03 10:00 UTC (full Moon) and 2026-01-26 05:00 UTC (first quarter).

At first quarter the Moon sees Earth half lit:
- **Sub-Moon point:** 168.3° W, 17.6° N.
- **Sub-solar point:** 107.6° E, 18.8° S.

The lit part the Moon sees runs from about 108° E to 168° W: Asia's east coast, Australia and the western Pacific. At the full-Moon instant Earth is nearly new, a thin crescent.

| Dataset | Status | What was established |
| --- | --- | --- |
| **Himawari-9 AHI** full disc, L1b Himawari Standard Data, every 10 min. JMA, via NOAA Open Data on AWS (`noaa-himawari9`) | **used** for 2026-01-26 (SS-13c) | The 05:00 UTC scan, bands 1–4, 40 files, pinned in `pipeline/earth_sources.json`. <br>**Bands:** 0.47, 0.51, 0.64 and 0.86 µm, at 1 km (0.5 km for 0.64 µm). <br>**Calibration:** counts to radiance to albedo from each file's own block 5. The updated coefficients are used where JMA gives them (offsets 51/59 after the update time at 43, read against real files). <br>**Scale:** JMA's albedo coefficient c′ is identical in January and July, so the albedo is relative to the Sun's irradiance at 1 AU. I/F on the day is albedo × r². <br>**Latitude:** the navigation takes geodetic latitude on GRS80, so the map's rows are geodetic. <br>**Projection:** CGMS normalised geostationary, sub-longitude 140.7° E, from block 3. <br>**Coverage:** 98.9% of the lit disc the Moon sees. <br>**Green for GOES:** its 0.51 µm band against its own 0.47, 0.64 and 0.86 µm bands, all seen through one geometry: r 0.9996, RMS 0.0047. <br>**Check:** it goes dark exactly where the Sun's cosine reaches 0, checked at 0°, 30° N and 30° S. <br>**Licence:** "NOAA and JMA request attribution … if you modify these data, you may not state or imply that it is original, unaltered data." |
| **GOES-18 ABI** (West, 137.2° W) full disc, L1b radiances, every 10 min. NOAA Open Data on AWS (`noaa-goes18`) | **used** for 2026-01-26 (SS-13c): 39% of the lit disc the Moon sees, by weight | The 05:00 UTC scan, bands 1–3, pinned. <br>**Bands:** 0.47, 0.64 and 0.865 µm, with no green band; green comes from Himawari's own relation (above). <br>**Scale:** reflectance factor = κ0 × radiance, κ0 = π d²/E_sun with the file's own Earth–Sun distance (0.98460 AU, matching SPICE's 0.98460): already I/F. <br>**Cross-calibration:** at 05:00 the Sun is far to Himawari's side and no place is seen by both in mirror geometry. So the two scans at 00:10 UTC are used, when the Sun stood 2.4° off the meridian halfway between the satellites. Fits are through zero where both saw a place with view zenith and phase angle within 5°, in daylight, within 70° of straight down (18,537 places): Himawari = 0.9588 × GOES at 0.64 µm (r 0.970) and 1.0205 × GOES at 0.47 µm (r 0.967). <br>**Found:** where the two see a place from opposite sides with the Sun low, they differ by up to about 2×. That is the surface's scattering, not calibration: clouds and sea are much brighter looking towards the Sun. So each place is taken mostly from the satellite whose line of sight was closer to the Moon's. <br>**Artefact:** GOES's own sun glint near 174° E, 15° S; each satellite is down-weighted inside its own glint. <br>**Licence:** "open to the public and can be used as desired", attribution requested. |
| **GOES-19 ABI** (East, 75.2° W). NOAA Open Data on AWS (`noaa-goes19`) | to evaluate, for the full-Moon instant's crescent | Reachable: listed for 2026-01-26 05:00. |
| **Meteosat-12 / Meteosat-9 IODC** (0° / 45.5° E). EUMETSAT Data Store | to evaluate | Needs a free EUMETSAT account. Not needed at either instant as far as computed; the full-Moon crescent is still to check. |
| **DSCOVR EPIC**, whole sunlit disc from the Sun–Earth L1 point, 10 bands including 0.443, 0.551 and 0.680 µm. NASA ASDC (L1B) and `epic.gsfc.nasa.gov` | to evaluate: best for instants when Earth is full from the Moon | Reachable: 11 images on 2026-01-26, the nearest at 04:26 and 06:14 UTC (34 and 74 min from the instant). It looks from the Sun, so the half-lit Earth the Moon sees at first quarter is at EPIC's limb, at grazing angles. Wrong geometry for this instant, ideal near new Moon. |
| **VIIRS NOAA-20 corrected reflectance**, true colour, daily. NASA GIBS | rejected as the source; kept for comparison | Reachable. It shows that day's clouds, but each place is imaged near 13:30 local time, not at the instant. <br>Black gaps between swaths near the equator. <br>A visual product, Rayleigh-corrected (the atmosphere's blue removed) and stretched, not calibrated reflectance. |
| GIBS geostationary layers (`Himawari_AHI_*`, `GOES-East/West_ABI_*`) | rejected | Short retention: January 2026 returns 404. The raw L1b above is the archive. |

## Earth's surface without clouds

| Dataset | Status | What was established |
| --- | --- | --- |
| **Blue Marble Next Generation**, monthly 2004, 500 m (Stöckli et al. 2005; NASA Visible Earth, record 73938, `world.200401.3x5400x2700.jpg`) | rejected for SS-13c; to evaluate for Earth's page | Reachable. A cloud-free visual composite of MODIS surface reflectance, not calibrated reflectance. <br>It has no clouds, but Earth is about two-thirds cloud-covered at any instant, so it would show an Earth that never exists. <br>The `world.topo.bathy` variant (record 73580) has shaded relief baked in: rejected (never bake lighting). |
| MODIS MCD43 BRDF/albedo (NBAR), 500 m, 16-day. LP DAAC | to evaluate, for Earth's page | Calibrated surface reflectance. Needs an Earthdata login. |
| Sentinel-2 L2A cloudless mosaics; Landsat | to evaluate, for Earth's page | |
| VIIRS Black Marble (night lights) | rejected for SS-13c | At the app's exposure (display = 2 · I/F) city lights are many orders of magnitude below one display level. They are not visible from the Moon at this exposure, as in the Apollo photographs. |

## Shape, orientation and position

| Dataset | Status | What was established |
| --- | --- | --- |
| `pck00011.tpc` BODY399_RADII | used (SS-13b) | 6378.1366 × 6378.1366 × 6356.7519 km |
| DE440 via SPICE | used (SS-13b) | Earth's position from the Moon at each instant |
| Earth's rotation: `IAU_EARTH` in `pck00011.tpc`, or the high-precision `earth_latest_high_prec.bpc` (ITRF93) | `IAU_EARTH` **used** (SS-13c) | Sets which side of Earth faces the Moon, taken when Earth's light left for it. Against JPL Horizons (DE441, Earth from the Moon's centre): sub-Moon point within 0.09° in longitude. The latitudes agree once Horizons' geodetic latitude is converted to planetocentric. |

## Elevation, oceans, atmosphere (for Earth's page)

| Dataset | Status |
| --- | --- |
| Copernicus DEM GLO-30 / GLO-90 | to evaluate |
| GEBCO 2025 bathymetry | to evaluate |
| ICESat-2, NASADEM | to evaluate |
| MODIS/VIIRS cloud products; ERA5 | to evaluate, for the atmosphere story |
