# SS-5 · The Moon's data, scripted

Status: **done** · Release 1 · 2026-09-24

As the director, I want the Moon's imagery and a real sun direction produced by a script anyone can re-run, so that the data half of the pipeline is proven and repeatable before any of it is rendered.

## Owner decision: which imagery

Four USGS global mosaics were compared over the same 300 km around Copernicus (`ss5-product-comparison.png`), and the two usable ones were compared over the whole Moon (`ss5-global-preview.png`):

| Product | Finding |
| --- | --- |
| LRO WAC global mosaic, 100 m | Sharpest and seamless, but its `DATA_SET_ID` is `WAC_morphology_globe`: shading is baked in. Under a real sun, relief would be lit twice |
| **Clementine UVVIS 750 nm, 118 m, v2.1** | A low-phase albedo map: relief mostly gone, brightness is material. Faint seams between image strips, and a few unimaged gaps |
| Kaguya TC ortho, 64 ppd | Shading baked in, lit from one side |
| LOLA 1064 nm albedo, 10 ppd | Laser-measured, so no shading at all, but at low latitude it holds values only along the laser's ground tracks |

**Chosen by the owner on 2026-09-24: Clementine 750 nm.** A Hapke-normalised LROC WAC mosaic would be better still; the LROC archive's listing is rendered client-side and its script returned 404 from this environment, so it could not be evaluated. It remains a candidate for a later upgrade.

## Acceptance criteria

| # | Criterion | Kind | Result |
| --- | --- | --- | --- |
| 1 | `pipeline/` is Python under `uv` with a lockfile; GDAL from rasterio's wheels; GDAL version in outputs | machine | rasterio 1.4.4 (bundled GDAL), spiceypy 8.2.0, pillow 12.3.0, no system installs |
| 2 | Download scripted, resumable, checksummed; source URL, product and version recorded | machine | Publisher MD5 plus pinned SHA-256; resumes short transfers; identifies itself (USGS returns 403 to Python's default User-Agent) |
| 3 | Equirectangular, planetocentric, east-positive, cited from the label | machine | From the product's PDS3 label: `POSITIVE_LONGITUDE_DIRECTION = EAST`, `CENTER_LONGITUDE = 0`, `PROJECTION_LATITUDE_TYPE = PLANETOCENTRIC` |
| 4 | Size and format by measurement; download under 6 MB | machine | 8192 × 4096 (1.33 km/px at the equator). WebP q85: 2.57 MB plus a 22 KB mask, PSNR 41.0 dB over imaged pixels. Lossless was 13.4 MB |
| 5 | Transfer function explicit | machine | Linear in source pixel value, no sRGB curve: the source is 8-bit and a curve cannot add precision |
| 6 | Manifest: body, NAIF ID, radius from the PCK, body frame, provenance, checksums | machine | `albedo.json` and `ephemeris.json`. Radius 1737.4 km read from `pck00011.tpc` `BODY301_RADII` |
| 7 | SpiceyPy sun direction and orientation at canonical epochs, near full and near first quarter | machine | Found by scanning the phase angle: full 2026-01-03 10:00 UTC (4.27°), first quarter 2026-01-26 05:00 UTC (89.74°) |
| 8 | Re-running produces byte-identical outputs | machine | Stars and ephemeris re-derived in CI and diffed. The texture's 4.25 GB source is too large for CI; `pipeline:test` checks it against the Gazetteer instead |

## Ground truth

- **Sub-solar point vs JPL Horizons** (`test/fixtures/horizons-moon-subsolar.json`): Horizons states `MOON_ME` from DE441. SPICE and Horizons agree to about 1e-5°, well inside the 0.1° tolerance. A second test rotates the shipped sun vector into the body frame with the shipped matrix, the same operation the renderer will perform, and lands on Horizons' point.
- **IAU Gazetteer** (`test/fixtures/iau-gazetteer-moon.json`), with expectations written before the first texture existed:
  - Mare Crisium darker than the surrounding highlands;
  - Tycho and Aristarchus brighter than their surroundings;
  - the Apollo 11 site (IAU "Statio Tranquillitatis") darker than the Moon's median;
  - Aristarchus's contrast more than 1.5 times weaker at its east-west and north-south mirror positions, so a mirrored map fails.

All pass.

## Findings

- **A lossy codec cannot carry an exact no-data value.** Encoding gaps as 0 in one WebP flipped 50,000 to 130,000 pixels between gap and data at every quality tried. The fix is a design change, not a looser rule: a lossless 1-bit mask is the only authority on gaps, and the albedo image is lossy with gaps pull-push filled for compression only.
- **The gaps are real and located where Clementine is known to be thin**: 0.886% of the surface. 13% of the area south of −80° is missing, with a fringe near the north pole and small rectangles elsewhere. Ten polar rows are entirely missing.
- **No optical map can be shading-free near the poles**, because the Sun is always low there. Even Clementine shows crater relief poleward of about 70°. SS-6 will double-shade polar craters; this is recorded as a known limitation.
- **Neither label gives a reflectance scale.** The values are relative albedo. SS-6 needs a cited calibration before it can set the Moon's absolute brightness.
- **Longitude domains differ between sources**: the imagery is −180 to 180, LOLA albedo is centred on 180°, and the Gazetteer uses 0 to 360. Every conversion is explicit and tested.
- **The body frame is settled by the kernel's own text.** `MOON_ME` in DE440 is `MOON_ME_DE440_ME421`, aligned with the LRO-era frame; it differs from `MOON_PA` by 0.02886°, about 0.9 km on the surface.

## Traps, and what guards each

| Trap | Guard |
| --- | --- |
| Baked-in shading | Owner chose the low-phase product from side-by-side evidence |
| Mirrored or shifted longitude | Gazetteer tests with mirror negatives; conventions cited from each label |
| `MOON_ME` vs `MOON_PA` | Frame cited from the kernel; Horizons confirms `MOON_ME` |
| Radius typed in | Read from the PCK; tested |
| Truncated download used | Publisher MD5, pinned SHA-256, resume on short transfer |
| Lossy compression inventing or erasing gaps | Separate lossless mask, verified to round-trip exactly |

## Not verified

- How the texture looks on a sphere: that is SS-6.
- Absolute albedo: not available from the product, as above.

## Effort

Estimate: 2 to 4 sessions. Actual: 1 long session, most of it data: a 4.25 GB download that needed three downloader fixes, and one encoding redesign.
