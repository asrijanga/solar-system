# Mars: data inventory

The owner's rule of 2026-09-25: gather every available dataset first, then build (README, "Gather first, then build"). This is story W1 of Mars's round (SS-14, `docs/world-recipe.md`). Nothing below has been built yet. Every later Mars story cites this file.

**Status legend** (as in `docs/data/moon.md`):
- **used:** shipped in the app.
- **rejected:** evaluated and not used, with the reason.
- **ground truth:** used only to check other data.
- **to evaluate:** known to exist, not yet examined; figures not read from the product itself are marked as such.

**Checked from the cloud, 2026-09-29.** "Reachable" means this environment listed the directory, or fetched the first byte of the file with a range request and got its size. Sizes are those the servers reported. Where a header is quoted, it was read from the file itself (GeoTIFF headers through GDAL's `/vsicurl/`, PDS3 labels directly).

**Not reachable from the cloud on that date:**

| Host | What failed | What it holds |
| --- | --- | --- |
| `astrogeology.usgs.gov` | HTTP 403 | USGS product pages: descriptions, vertical datums and licences. The files themselves, on `planetarymaps.usgs.gov`, are reachable |
| `murray-lab.caltech.edu` | TLS certificate not verifiable (curl exit 60) | The global CTX mosaic |
| `pds.mars.asu.edu` | The proxy refused the connection (502 to CONNECT) | THEMIS archive. `global-data.mars.asu.edu` is reachable |
| `clpds.bao.ac.cn` | Connection dropped | Tianwen-1 archive (needs registration in any case). `moon.bao.ac.cn` is reachable |
| `www.emiratesmarsmission.ae` | HTTP 403 | Project site. Its science data centre, `sdc.emiratesmarsmission.ae`, is reachable |

## Conventions shared by every product

- **Mars's shape** (`pck00011.tpc`, read 2026-09-29): `BODY499_RADII = ( 3396.19 3396.19 3376.20 )` km. Mars is flattened by 20 km, 60 times more than the Moon. The app will need a real ellipsoid or radius values, not one sphere.
- **Two vertical datums are in use, and must never be mixed:**
  - **Radius:** distance from Mars's centre (MOLA `MEGR`).
  - **Height above the areoid:** MOLA `MEGT` and most derived DEMs. The areoid is Mars's equipotential surface; it departs from any sphere by kilometres. The geometry must be built from radius. Heights above the areoid are what maps and the Gazetteer quote.
- **Longitude:** east-positive, planetocentric latitude, in every product read so far. Some older products and the Gazetteer also give west longitudes: each is checked from its own label.

## Elevation

| Dataset | Status | What was established |
| --- | --- | --- |
| **MOLA MEGDR, 128 px/deg (463 m)**, 88°S–88°N, 16 tiles of 44° × 90° (PDS Geosciences `MGS-M-MOLA-5-MEGDR-L3-V1.0`, `mgsl_300x/meg128/`) | to evaluate: the global base | Reachable. Three products per tile, from the labels: <br>**`megr`, radius:** 16-bit big-endian integers (`MSB_INTEGER`), metres, `OFFSET = 3396000`, 129.8 MB per tile (2.1 GB total). <br>**`megt`, topography:** "median observed topography" relative to the areoid "defined by the Goddard Mars potential model GMM3 (mgm1025) evaluated to degree and order 50", IAU2000 frame. <br>**`megc`, counts:** 8-bit, the number of laser shots in each pixel. <br>**Map:** SIMPLE CYLINDRICAL, planetocentric, `POSITIVE_LONGITUDE_DIRECTION = EAST`, 11520 × 5632 samples per tile. The projection offsets (for example `LINE_PROJECTION_OFFSET = -5631.5`) put pixel centres at half-pixel positions: pixel-registered. <br>**Known artefact:** "Where no observations lie within the area, an interpolated value is supplied." The `megc` count is 0 there. Near the equator most pixels lie between laser tracks. Interpolated pixels must be kept apart from measured ones and never presented as measured, as the Moon's LDEM_64 was (SS-10d) |
| **MOLA MEGDR polar, 128/256/512 px/deg**, polar stereographic (`mgsl_300x/polar/`) | to evaluate: the poles | Reachable. `megr`, `megt` and `megc` for each pole; `megr_s_512.img` is 604 MB. Covers what the cylindrical tiles miss beyond 88°. Off-nadir polar shots are included (label) |
| MOLA PEDR, individual laser shots (`MGS-M-MOLA-3-PEDR-L1A-V1`) | to evaluate: ground truth | Directory answered (HTTP 200), not yet listed. About 600 million shots (MEGDR label). The measurements every MOLA grid comes from; the reference for checking any DEM, and for telling measured pixels from interpolated ones |
| **HRSC–MOLA blended DEM v2, 200 m** (USGS, `planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif`) | to evaluate: likely the global base, as README suggests | Reachable, 11.4 GB. From its GeoTIFF header: <br>**Grid:** 106,694 × 53,347 int16, nodata −32768, 0.003374° per pixel (296 px/deg), 180°W–180°E, 90°N–90°S. <br>**Ellipsoid:** `Mars_2000_Sphere_IAU_IAG`, radius 3,396,190 m. `AREA_OR_POINT = Area`. <br>**Not established:** whether its heights are above the areoid or the sphere. The USGS product page that says so is not reachable (403). Must be settled from the documentation before use, by comparing with MOLA `MEGT` and `MEGR` over the same pixels, recorded as the Moon's registrations were. <br>**Composition:** HRSC stereo where HRSC covered, MOLA elsewhere. Which pixels came from which is still to find, so provenance per region is kept |
| MOLA global DEM, 463 m (USGS GeoTIFF, `Mars_MGS_MOLA_DEM_mosaic_global_463m.tif`) | rejected in favour of the PDS MEGDR | Reachable, 2.1 GB, 46,080 × 23,040 int16, equirectangular on a 3,396,190 m sphere. A repackaging of the MEGDR without the counts. The PDS original keeps the count per pixel, its label and the radius product |
| HRSC level-4 DTMs, 50–150 m per orbit strip, and the MC-30 quadrangle DTMs (Mars Express, ESA PSA `MEX-M-HRSC-4-REFDR-MAPPROJECT-*`, `-EXT1` to `-EXT9`) | to evaluate: finer regions and local mode | PSA FTP listing reachable (`archives.esac.esa.int/psa/ftp/MARS-EXPRESS/HRSC/`). Stereo, so ground heights between MOLA tracks, as Kaguya was for LOLA. Coverage is by orbit strip, not yet counted |
| CTX stereo DTMs, about 20 m (MRO) | to evaluate: local | Not a global product. Made per site (USGS, ASU, community ASP pipelines). CTX images are reachable at `pds-imaging.jpl.nasa.gov/data/mro/ctx/` |
| **HiRISE DTMs, 1–2 m** (MRO, `hirise-pds.lpl.arizona.edu/PDS/DTM/`) | to evaluate: local mode, named sites | Listing reachable. Hundreds of sites, including landing sites and Valles Marineris walls. The Albategnius equivalent: the finest measured terrain where it exists |

## Albedo and imagery

Mars differs from the Moon in one way that decides W3: **it has weather.** Dust storms, dust settling and clearing, frost and water-ice clouds change what the surface looks like season to season, and in a global dust storm hide it entirely. So Mars's albedo is a measurement at a stated time, or a stated average over one (`docs/world-recipe.md`, W3).

| Dataset | Status | What was established |
| --- | --- | --- |
| **TES Lambert albedo, 1/8° (7.4 km)** (MGS, USGS `Mars_MGS_TES_Albedo_mosaic_global_7410m.tif`) | to evaluate: absolute scale, as LDAM was for the Moon | Reachable, 16.6 MB. From its header: 2880 × 1440 float32, equirectangular on a 3,396,000 m sphere, `AREA_OR_POINT = Area`. <br>**Meaning** (a bolometric Lambert albedo, 0.3–2.9 µm, from TES's broadband channel; Christensen et al. 2001) is still to cite from the product's documentation, which sits on the unreachable USGS page. <br>**Epoch:** 1999–2004, before and after the 2001 global dust storm. Coarse, but measured with the Sun's shading removed |
| **MOLA 1064 nm reflectivity** (laser-lit, like LOLA's LDAM) | to evaluate | A normal albedo lit by the laser itself, so no shading, as LOLA's was for the Moon's poles. The product and its PDS location are still to find. Note that MOLA's active radiometry is known to be affected by atmospheric dust and ice opacity |
| **Viking MDIM 2.1 colour mosaic, 232 m** (USGS `Mars_Viking_MDIM21_ClrMosaic_global_232m.tif`) | to evaluate: likely rejected | Reachable, 12.7 GB. Built from Viking images taken under many Sun angles; shading is expected to be baked in, as it was in the Moon's WAC morphology and Kaguya mosaics. Keep only if a side-by-side comparison (W3) shows otherwise. Epoch 1976–1980 |
| **THEMIS day-time infrared, 100 m** (Mars Odyssey, USGS `Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12.tif`) | rejected for albedo | Reachable, 22.8 GB. Thermal emission, not reflected light: it shows temperature, which follows slope and Sun angle, so shading is intrinsic to it. Useful as morphology only |
| **CTX global mosaic, about 5 m** (Murray Lab, Caltech; beta 01) | rejected for albedo; to evaluate for morphology | Host not verifiable from the cloud (TLS). Individual images at many Sun angles and seasons, contrast-stretched, not calibrated reflectance: shading and seams baked in. The sharpest global view of Mars's surface, and so the one to compare shapes against |
| HRSC colour orthoimages and MC-30 colour mosaics (Mars Express, ESA PSA) | to evaluate: colour | Listing reachable. Calibrated reflectance in blue, green, red and near-infrared. Shading at each image's own Sun angle |
| OMEGA global albedo maps (Mars Express; Ody et al. 2012) | to evaluate | A near-infrared albedo with photometric and atmospheric correction. The product and its location are still to find |
| CRISM multispectral maps (MRO, PDS Geosciences `mro-m-crism-*`) | to evaluate: colour and composition | PDS Geosciences CRISM volumes reachable (the type-spectra volume was listed); the map products themselves not yet located. Visible and near-infrared multispectral mapping, with gaps |
| **MARCI daily global maps** (MRO, `pds-imaging.jpl.nasa.gov/data/mro/marci/`) | to evaluate: Mars at an instant | The directory answered with a redirect on 2026-09-29 (and once with a 502); not yet listed. One global colour view per day since 2006: the dust and clouds on a given date, like the weather satellites for Earth (SS-13c). About 1–10 km per pixel. Needed if Mars is shown at a stated date rather than on average |
| EMM EXI full-disc images (Emirates Mars Mission, `sdc.emiratesmarsmission.ae`) | to evaluate: the whole disc at an instant | Reachable. Full disc in colour from a high orbit, several times a day since 2021. For Mars as a neighbour in the sky, as EPIC was for Earth |
| Tianwen-1 MoRIC global colour mosaic, 76 m (CNSA, 2023) | to evaluate | The archive host was not reachable, and the archive needs registration: the owner would create the account, its keys in the environment's secrets |

## Geometry, orientation, position and names

| Dataset | Status | What was established |
| --- | --- | --- |
| `pck00011.tpc` (NAIF) | to use (W2) | Reachable. Radii above; `IAU_MARS` rotation |
| DE440 and `gm_de440.tpc` (NAIF) | to use (W2) | Already pinned for the Moon |
| Mars system ephemeris, `mar099.bsp` (1.23 GB) and `mar099s.bsp` (67.6 MB) (NAIF `spk/satellites/`) | to use (W2) | Reachable. Phobos and Deimos. The short-span version covers the app's epochs if its coverage file (`.cmt`) says so |
| Phobos shape models: `phobos512.bds`, `phobos_2014_09_22.bds`, `phobos_3_3.bds` (NAIF `dsk/satellites/`, with Willner et al.) | to evaluate (W8) | Reachable. Phobos's measured shape for W8. None for Deimos in that directory |
| HRSC Phobos maps (ESA PSA `MEX-MSA-HRSC-5-REFDR-PHOBOS-MAPS-V1.0`) | to evaluate (W8) | Listing reachable. Phobos's surface |
| IAU Gazetteer of Planetary Nomenclature, Mars (`MARS_nomenclature_center_pts.zip`, 5.4 MB, the same S3 bucket as the Moon's) | to use: labels and ground truth | Reachable. Names, centres and diameters for labels (W7) and checks. Olympus Mons, Valles Marineris, Hellas and the landing sites give elevation checks against MOLA's published extremes |

## What this means for the next stories

- **W2 (ephemeris) is straightforward:** everything is reachable at NAIF.
- **W4 (website terrain) outgrows the Moon's budget.** Mars has 3.8 times the Moon's surface area. At the Moon's global density (670 m) its tiles would take about 2.5 GB, past GitHub Pages' 1 GB. So Mars needs either its own data repository with its own Pages site (the recipe's plan, which the owner creates), or a coarser global density on the website with full detail in local mode. That is the owner's decision when W4 comes.
- **W3 (albedo) needs a decision on time:** a stated date from MARCI or HRSC and CTX colour, or a long-term average like TES. It also needs the side-by-side comparison of candidate maps, rendered as the app would show them.
- **Before any build:**
  - The HRSC–MOLA blend's vertical datum must be established from its documentation. That page is not reachable from the cloud, so it will be checked against MOLA's radius product instead, and the result recorded.
  - Licences are still to be quoted in each publisher's own words. The NASA PDS, USGS and ESA PSA terms are the ones needed first.
