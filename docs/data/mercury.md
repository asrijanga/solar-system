# Mercury: data inventory

The owner's rule of 2026-09-25: gather every available dataset first, then build (README, "Gather first, then build"). This is story W1 of Mercury's round (SS-16, `docs/world-recipe.md`). Nothing below has been built yet. Every later Mercury story cites this file.

**Status legend** (as in `docs/data/mars.md`):
- **used:** shipped in the app.
- **rejected:** evaluated and not used, with the reason.
- **ground truth:** used only to check other data.
- **to evaluate:** known to exist, not yet examined. Figures not read from the product itself are marked as such.

**Checked from the cloud, 2026-10-05.** "Reachable" means this environment listed the directory, or read the file's size with a HEAD request. GeoTIFF headers were read through GDAL's `/vsicurl/`. PDS3 labels, the MDIS archive's own documentation and the USGS product pages were read directly.

**Not reachable on that date:** nothing needed. `astrogeology.usgs.gov`, which answered 403 for Mars on 2026-09-29, served Mercury's product pages. `pds-imaging.jpl.nasa.gov` answered curl but refused a page-reading tool with 403. Pipelines use curl and Python, which it serves.

## Conventions shared by every product

- **Mercury's shape** (`pck00011.tpc`, read 2026-10-05): `BODY199_RADII = ( 2440.53 2440.53 2438.26 )` km.
- **Three reference spheres,** one per product family. They differ by up to 1.13 km, and Mercury's relief is about ±5 km, so they must be reconciled before any blend (W4):

| Products | Reference sphere | Source |
| --- | --- | --- |
| USGS DEM; every MDIS map (BDR, LOI, MDR, MD3); MLA `hdem_64` | 2439.4 km | GeoTIFF headers, PDS3 labels (`hdem_64.lbl`: "OFFSET = 2439400"; corrected 2026-10-08, SS-16 W4) |
| Some MLA gridded products | 2440.0 km | their labels: "OFFSET = 2440000." |
| pck00011 | 2440.53 × 2438.26 km | `BODY199_RADII` |

- **Longitude:** every product read is planetocentric, east-positive.
  - The USGS DEM's GeoTIFF is centred on 180° (columns 0 to 360° E). The MDIS mosaics are centred on 0° (−180 to 180°).
  - The MDIS products were made with SPICE kernels of their own time. Whether their prime meridian is pck00011's (`BODY199_PM = ( 329.5988 6.1385108 0 )`) is to check in W2, against the IAU Gazetteer.
- **Photometric normalisation of the MDIS maps.** Every end-of-mission MDIS map (BDR, MDR, MD3, MP5, HIE, HIW, LOI, RTM) is "reflectance corrected to i = 30º, e = 0º, g = 30º" with "a Kaasalainen–Shkuratov photometric model, whose parameters are the same for any given wavelength band across all MESSENGER end-of-mission map data products", from Domingue et al. (2016) (`MDIS_CDR_RDRSIS.PDF` §2.4, §2.5.2.3).
  - **The correction does not remove shading from slopes.** The angles used are "determined at an equipotential surface" (§2.5.2.3 (f)), not on local slopes. Shading from slopes remains wherever the images were taken with the Sun low.
  - This decides the albedo choice below.

## Elevation

| Dataset | Status | What was established |
| --- | --- | --- |
| USGS global DEM v2, 665 m (64 px/°), `Mercury_Messenger_USGS_DEM_Global_665m_v2.tif` (planetarymaps.usgs.gov, 531 MB). The same in PDS `MESSDEM_1001/DEM/GLOBAL/IMG/MSGR_DEM_USG_SC_I_V02.IMG`, MD5 `5365bd7c870710214c6a18dac1a28b0f` (`MESSDEM_1001_md5.txt`) | **used** (W4): the global base south of 70° N, lowered 34.5 m to MLA. The PDS copy stores DN × 0.5 m. Every pixel is interpolated from 12.6 million control points (`MSGR_DEM_SIS.PDF` §4.3.2.5) | Reachable. 23,040 × 11,520 int16, metres from the 2439.4 km sphere, no-data −32768 (GeoTIFF header). Equirectangular, planetocentric, east-positive, 0–360°. Stereo from 100,432 NAC and WAC-G images, "12, 596, 336 control points" (USGS page, after Becker et al. 2016, LPSC 47 #2959). Every MDIS map was projected onto it. The USGS page gives no vertical accuracy. Errata: version 1 was a preliminary DEM released by mistake; version 2 applies "a 1-sigma filter applied to the point cloud". USGS-hosted copies publish no checksum; the PDS copy has the MD5 |
| USGS polar DEMs v2, `MSGR_DEM_USG_NP_I_V02.IMG` and `_SP_` (PDS `MESSDEM_1001`, MD5s published) | to evaluate (W4) | Reachable. Made "independently … using the same technique as the Version 2 global DEM" (errata) |
| MLA gridded topography, version 1: `hdem_64` and `hdem_16` (global grids), `hdem_45n_{1000,500,250}m` (north of 45° N), plus counts (`hdec_*`) (PDS Geosciences `mess-e_v_h-mla-3_4-cdr_rdr-data-v1/messmla_2001/gdr/img/`) | **used** (W4): `hdem_64` north of 80° N and in the 70–80° N blend, resampled 0.75 px north and 0.25 px east into the DEM's frame; the laser reference for the DEM's offset. Version 2.0's label gives 2439.4 km | Reachable. MLA ranged mostly over the northern hemisphere: MESSENGER's eccentric orbit put its low point in the north. Label: radius = DN × 0.5 m + 2,440,000 m, "POLAR STEREOGRAPHIC", planetocentric, east-positive |
| MLA version 2: `hdem_75n_250m` (`messmla_2101/gdr/img/`) | to evaluate (W4) | Reachable. North of 75° N at 250 m. The only gridded product in version 2 |
| MESSENGER shape and gravity harmonics, `ggmes_100v08_shb` (PDS `mess-h-rss_mla-5-sdp-v1/messrs_1001/data/shbdr/`) | to evaluate (W4): the geoid, if heights are given above it | Reachable. Degree 100 |
| Ernst et al. / Preusker et al. regional stereo DEMs (MESSENGER H-quadrangle DTMs) | to evaluate | Not looked for yet |

## Albedo and imagery

| Dataset | Status | What was established |
| --- | --- | --- |
| **MD3 v2:** 3-colour (430, 750, 1000 nm) map, 128 px/°, i = 30°, e = 0°, g = 30° (PDS `MSGRMDS_6001/MD3/`, 54 tiles, MD5s in `MSGRMDS_6001_md5.txt`). USGS 8-bit 64 px/° copy `Mercury_MESSENGER_MDIS_Basemap_MD3Color_Mosaic_Global_665m.tif` (797 MB) | **used** (W3): the albedo and colour, wherever it measured (72% of the surface) | Reachable. Averaged over all images that meet the criteria for image scale, photometric geometry and detector temperature, from the regional 3-colour campaign. That minimises calibration drift. Use the PDS 128 px/° float tiles, not the 8-bit stretch |
| **MDR v4:** 8-colour (8 WAC filters) map, 64 px/°, i = 30°, e = 0°, g = 30° (PDS `MSGRMDS_5001/MDR/`, MD5s published) | **used** (W3): its 430, 750 and 1000 nm bands, scaled to MD3 (gains 1.005–1.008), wherever MD3 did not measure (27%) | Reachable. From the global 8-colour campaign at "the lowest values possible" of incidence (USGS page for the MDR-based mosaic). Averaged like MD3. A redundant lower-resolution south polar tile fills gaps |
| **LOI:** low-incidence monochrome basemap, 750 nm, 256 px/° (166 m), i = 30°, e = 0°, g = 30° (PDS `MSGRMDS_7201/LOI/`; USGS 8-bit `…LOI_Mosaic_Global_166m.tif`, 4.2 GB) | to evaluate (W3): finest albedo detail, if its shading is small enough | Reachable. Images with incidence "near 45°", so shading from slopes is moderate. The USGS 8-bit copy maps I/F 0.005 to about 0.2 |
| BDR v1/v2: monochrome basemap, 750 nm, 256 px/° (PDS `MSGRMDS_4001/BDR/`; USGS `…BDR_Mosaic_Global_166m.tif`, 4.2 GB) | **rejected for albedo: lighting baked** | Reachable. Images with incidence "near 74°", chosen "for morphology studies" (USGS). Shading from slopes is strong, because the correction uses the equipotential surface |
| HIE and HIW: high-incidence basemaps lit from the east and west, 256 px/° (PDS `MSGRMDS_7001`, `MSGRMDS_7101`) | **rejected for albedo: lighting baked** | Reachable. Incidence near 78° (version 1) or 86° (version 2), on purpose |
| USGS Enhanced Color mosaic, 665 m | **rejected:** not reflectance | Reachable. Principal components and a ratio in red, green and blue: a geology view |
| RTM: regional targeted mosaics, including the Caloris and b30 colour maps with a scattered-light correction (PDS `MSGRMDS_8001`) | to evaluate (W5): local detail | Reachable. 6,516 files |

## Photometry and brightness

| Dataset | Status | What was established |
| --- | --- | --- |
| Mercury's disc-integrated V magnitude: Mallama & Hilton (2018), arXiv:1808.01973, Eq. 2 | **to use** (W7): the phase curve the scattering law is fitted to, and the brightness check | Read from the arXiv PDF, 2026-10-05: "V = 5 log10 ( r d ) -0.613 + 6.3280E-02 α - 1.6336E-03 α2 + 3.3644E-05 α3 – 3.4265E-07 α4 + 1.6893E-09 α5 – 3.0334E-12 α6". The observations span "2.1o < α < 169.5o". "this magnitude is about 8% fainter than the result derived from geophysical modeling", which includes the opposition surge |
| Mercury's geometric albedos: Mallama, Krobusek & Pavlov (2017), arXiv:1609.05048, Table 7 | **to use** (W7): the per-band calibration | Read 2026-10-05. Johnson U 0.087, B 0.105, V 0.142, R 0.172, I 0.208, Rc 0.158, Ic 0.180; Sloan u′ 0.095, g′ 0.130, r′ 0.169, i′ 0.200, z′ 0.237 |
| The MDIS maps' scattering law: Domingue, Denevi, Murchie & Hash (2016), "Application of multiple photometric models to disk-resolved measurements of Mercury's surface", Icarus 268, 172–203 (Kaasalainen–Shkuratov parameters per band) | to evaluate: **not read** | The paper holds the parameters the maps were corrected with. No open copy was found, and the PDS calibration directories hold no photometry table (`MSGRMDS_1001/CALIB/`: dark, flat, responsivity, solar, correction only). Without it, the law is fitted to Eq. 2 as Mars's was (SS-14 W7) |

## Geometry, orientation, position and names

| Dataset | Status | What was established |
| --- | --- | --- |
| `pck00011.tpc` (NAIF) | to use (W2) | Already pinned. Radii above. Rotation `BODY199_POLE_RA = ( 281.0103 -0.0328 0 )`, `BODY199_PM = ( 329.5988 6.1385108 0 )`, with periodic terms |
| DE440 and `gm_de440.tpc` | to use (W2) | Already pinned. `BODY199_GM = 22031.868551400003` km³/s² |
| IAU Gazetteer, Mercury (`MERCURY_nomenclature_center_pts.zip`, 1.6 MB, the same S3 bucket as Mars's) | to use: labels and ground truth | Reachable. The bucket rebuilds its zips in place (SS-14 W8), so the records used will be kept in the repo, not pinned by checksum |

## What this means for the next stories

- **W2 (ephemeris) is straightforward:** everything is pinned at NAIF already.
- **W3 (albedo):** MD3 and MDR are the candidates. They come from the low-incidence colour campaigns and are averaged over many images.
  - **Residual shading from slopes is to measure** before choosing, by correlating each map with slopes from the DEM, as Hubble checked Mars.
  - **LOI** gives the finest detail if its shading measures small.
- **W4 (terrain):** the USGS stereo DEM is global at 665 m. MLA is the laser truth for the north.
  - **Sizes:** Mercury's area is 0.39 of Mars's, so the website terrain at Mars's 1.3 km would be about 0.4 of Mars's size.
- **W7 (photometry):** without Domingue et al.'s parameters, the law is fitted to Mallama & Hilton Eq. 2, as Mars's was to Eq. 6.
- **Mercury has no air:** no W6 (atmosphere).
