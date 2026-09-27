"""Earth's face at the app's instants, as the geostationary satellites measured it (SS-13c).

    npm run pipeline:earth

Python, because the sources are bzip2 Himawari Standard Data and HDF5 (NetCDF-4) GOES files, and
the work is whole-image numpy; the maps are written as lossless WebP.

Sources (docs/data/earth.md), every file pinned in earth_sources.json:
- Himawari-9 AHI full disc, L1b, 0.47 / 0.51 / 0.64 um: the primary, and the colour reference.
- GOES-18 ABI full disc, L1b, 0.47 / 0.64 / 0.86 um: where Himawari sees Earth obliquely or not
  at all. It has no green band; its green is fitted to Himawari's 0.51 um where both see well.

What is stored is each place's reflectance factor, I/F, under the Sun of that instant: the Sun's
angle, the terminator and the atmosphere are all in it, because that is what was measured.
- AHI: albedo = c' x radiance, with JMA's c' from each file's calibration block. c' is the same in
  January and July (checked on 2025-07-04 and 2026-01-26), so it is relative to the Sun's
  irradiance at 1 AU. The Sun's irradiance that day was 1/r^2 of that, so I/F = albedo x r^2.
- ABI: reflectance factor = kappa0 x radiance, kappa0 = pi d^2 / E_sun from each file, with d the
  file's own Earth-Sun distance: already I/F.
The app shows it as it shows the Moon (core/photometry.ts): display = exposure x I/F / r^2.

Blending: each satellite's weight is smoothstep(cos 85, cos 65, cos view zenith), how directly it
saw the place, times a Gaussian (sigma 30 degrees) of the angle between its line of sight and the
Moon's, so the one that saw a place more as the Moon did counts more, with no seam; and each fades
inside its own sun glint (15 to 30 degrees), which is where that satellite was, not the Moon. The two are
put on one scale first, by fits where they saw the same places in mirror geometry. Where neither sees (weight 0 from both) the map has no value (alpha 0). Nothing is
filled in: the app draws those places dark. Night needs no filling: the satellites measured it.

Output, per instant with sources (the full-Moon instant needs Meteosat, not yet obtained):
- public/data/earth/<instant id>.webp: 2048 x 1024 plate carree, pixel centres, longitude -180
  to 180 left to right, geodetic latitude 90 to -90 top to bottom (the satellites' navigation,
  CGMS 03 and the GOES-R PUG, takes geodetic latitude on the GRS80 ellipsoid), body-fixed frame
  IAU_EARTH (the ephemeris's j2000ToEarthFixed). RGB: I/F in 0.64 / 0.51 / 0.47 um, clipped to
  1 and sRGB-encoded. Alpha: 255 measured, 0 not.
- public/data/earth/faces.json: sources, cross-calibration fits, coverage.
Each output pixel averages 4 x 4 samples of a 4.9 km grid from the 2 km averaged satellite
images.
"""

from __future__ import annotations

import bz2
import json
import math
import struct
from pathlib import Path

import h5py
import numpy as np
from PIL import Image

from download import fetch

ROOT = Path(__file__).resolve().parent.parent
SOURCES = Path(__file__).resolve().parent / "earth_sources.json"
EPHEMERIS = ROOT / "public" / "data" / "moon" / "ephemeris.json"
OUT = ROOT / "public" / "data" / "earth"
AU_KM = 149597870.7
WIDTH, HEIGHT = 2048, 1024
OVERSAMPLE = 4
ROWS_PER_BLOCK = 32  # output rows per pass, to bound memory
# Every band is averaged down to 2 km before sampling.
AHI_FACTOR = {"B01": 2, "B02": 2, "B03": 4, "B04": 2}
ABI_FACTOR = {"C01": 2, "C02": 4, "C03": 2}
# A satellite's view counts fully up to 65 degrees from straight down, fading out by 85.
BLEND = (math.cos(math.radians(85)), math.cos(math.radians(65)))
# Sun glint, the Sun's mirror image on the sea, is where a satellite happened to be, not where the
# Moon was: each satellite's weight fades inside GLINT_DEG of its own glint, so the other supplies
# that place. The Moon's own glint (near 150 E on the equator at first quarter) is not in the data.
GLINT_DEG = (15.0, 30.0)
# Where both see a place, each is also weighted by a Gaussian of the angle between its line of
# sight and the Moon's: the one that saw it more as the Moon did counts more, smoothly.
PREFER_SIGMA_DEG = 30.0
# The two satellites are compared only where they saw a place in mirror geometry (the same view
# zenith and the same phase angle, within these), in daylight, both within 70 degrees of
# straight down: there a matte or azimuthally symmetric surface looks the same to both, so a
# difference is calibration, not the surface's scattering. 5 degrees, set from the sample count
# before any fit was seen: in the scan pair used the Sun stood 2.4 degrees off the meridian
# halfway between the satellites, so no place matched within 3 (0 samples), and 5 gives 18,728.
MIRROR_DEG = 5.0
FIT_MIN_MU0 = 0.2
FIT_MAX_ZENITH_DEG = 70


# --- Himawari Standard Data -------------------------------------------------------------------


def read_ahi(paths: list[Path], factor: int) -> tuple[np.ndarray, dict]:
    """One AHI band's full disc as JMA albedo, averaged by `factor`, from its 10 segments.

    Header layout from JMA's Himawari Standard Data User's Guide v1.3: numbered blocks, each
    starting with its number (uint8) and length (uint16), little-endian. Offsets used, each
    checked against the real files: block 1 +70 total header length; block 2 +5 columns, lines;
    block 3 +3 sub-longitude, CFAC, LFAC, COFF, LOFF, +27 satellite distance, +35 equatorial and
    polar radii; block 5 +3 band, +5 wavelength, +15 error and outside-scan counts, +19 gain,
    constant, +35 c', +43 update time (MJD), +51 updated gain and constant; block 7 +5 first line.
    """
    rows = []
    meta: dict = {}
    for path in sorted(paths):
        raw = bz2.decompress(path.read_bytes())
        blocks = {}
        at = 0
        while at < len(raw):
            number, length = struct.unpack_from("<BH", raw, at)
            blocks[number] = at
            at += length
            if number == 11:
                break
        b1, b2, b3, b5, b7 = (blocks[i] for i in (1, 2, 3, 5, 7))
        header_length = struct.unpack_from("<I", raw, b1 + 70)[0]
        columns, lines = struct.unpack_from("<HH", raw, b2 + 5)
        sub_lon, cfac, lfac, coff, loff = struct.unpack_from("<dIIff", raw, b3 + 3)
        distance = struct.unpack_from("<d", raw, b3 + 27)[0]
        req, rpol = struct.unpack_from("<dd", raw, b3 + 35)
        band, wavelength = struct.unpack_from("<Hd", raw, b5 + 3)
        err, outside = struct.unpack_from("<HH", raw, b5 + 15)
        gain, constant, c_prime = struct.unpack_from("<ddd", raw, b5 + 19)
        new_gain, new_constant = struct.unpack_from("<dd", raw, b5 + 51)
        if new_gain != 0:
            gain, constant = new_gain, new_constant
        first_line = struct.unpack_from("<H", raw, b7 + 5)[0]
        counts = np.frombuffer(raw, "<u2", columns * lines, header_length).reshape(lines, columns)
        albedo = ((counts * gain + constant) * c_prime).astype(np.float32)
        albedo[(counts == err) | (counts == outside)] = np.nan
        rows.append((first_line, block_mean(albedo, factor)))
        meta = dict(
            sub_lon=sub_lon, cfac=cfac, lfac=lfac, coff=coff, loff=loff, distance=distance,
            distance_km=distance,  # block 3 gives kilometres
            req=req, rpol=rpol, band=band, wavelength=wavelength, factor=factor,
        )
    rows.sort(key=lambda r: r[0])
    return np.concatenate([r[1] for r in rows]), meta


def block_mean(image: np.ndarray, factor: int) -> np.ndarray:
    h, w = image.shape
    image = image[: h - h % factor, : w - w % factor]
    with np.errstate(invalid="ignore"):
        blocks = image.reshape(h // factor, factor, w // factor, factor)
        # A block with any missing sample is missing, never half-filled.
        return blocks.mean(axis=(1, 3))


def geostationary(lon, lat, sub_lon, distance, req, rpol):
    """The CGMS/GOES-R geometry of a body-fixed point from a geostationary satellite:
    (s_x, s_y, s_z), the satellite-to-point terms of the GOES-R PUG (vol. 3, 4.2.8) and CGMS 03,
    and the cosine of the view zenith angle (negative where the point faces away)."""
    phi = np.radians(lat)
    d_lon = np.radians(lon - sub_lon)
    c_lat = np.arctan((rpol / req) ** 2 * np.tan(phi))
    rc = rpol / np.sqrt(1 - (1 - (rpol / req) ** 2) * np.cos(c_lat) ** 2)
    px = rc * np.cos(c_lat) * np.cos(d_lon)
    py = rc * np.cos(c_lat) * np.sin(d_lon)
    pz = rc * np.sin(c_lat)
    sx, sy, sz = distance - px, -py, pz
    # Toward the satellite, against the geodetic normal.
    vx, vy, vz = sx, -py, -pz
    nx, ny, nz = np.cos(phi) * np.cos(d_lon), np.cos(phi) * np.sin(d_lon), np.sin(phi)
    cz = (vx * nx + vy * ny + vz * nz) / np.sqrt(vx * vx + vy * vy + vz * vz)
    return sx, sy, sz, cz


def ahi_sample(image: np.ndarray, meta: dict, lon, lat):
    """AHI values at body-fixed points, and the cosine of the view zenith there."""
    sx, sy, sz, cz = geostationary(lon, lat, meta["sub_lon"], meta["distance"], meta["req"], meta["rpol"])
    rn = np.sqrt(sx * sx + sy * sy + sz * sz)
    x = np.degrees(np.arctan(-sy / sx))
    y = np.degrees(np.arcsin(-sz / rn))
    column = meta["coff"] + x * 2.0**-16 * meta["cfac"]
    line = meta["loff"] + y * 2.0**-16 * meta["lfac"]
    # Column and line are 1-based with pixel k spanning k - 0.5 to k + 0.5 (HSD guide), so the
    # 0-based block of `factor` pixels holding a position is floor((column - 0.5) / factor).
    f = meta["factor"]
    ci = np.clip(np.floor((column - 0.5) / f).astype(np.int64), 0, image.shape[1] - 1)
    li = np.clip(np.floor((line - 0.5) / f).astype(np.int64), 0, image.shape[0] - 1)
    return np.where(cz > 0, image[li, ci], np.nan), cz


# --- GOES-R ABI L1b -----------------------------------------------------------------------------


def read_abi(path: Path, factor: int) -> tuple[np.ndarray, dict]:
    """One ABI band's full disc as reflectance factor (kappa0 x radiance), averaged by `factor`.
    Samples with a data quality flag above 1 (out of range, no value, focal plane too warm) are
    missing (GOES-R PUG vol. 3, DQF)."""
    with h5py.File(path, "r") as f:
        rad = f["Rad"]
        scale = float(rad.attrs["scale_factor"][0])
        offset = float(rad.attrs["add_offset"][0])
        fill = int(rad.attrs["_FillValue"][0])
        kappa0 = float(f["kappa0"][()])
        n = rad.shape[0]
        step = factor * 512
        out = []
        for start in range(0, n, step):
            counts = rad[start : start + step].view(np.uint16)
            dqf = f["DQF"][start : start + step].view(np.uint8)
            reflectance = ((counts * scale + offset) * kappa0).astype(np.float32)
            reflectance[(counts == fill) | (dqf > 1)] = np.nan
            out.append(block_mean(reflectance, factor))
        image = np.concatenate(out)
        x = f["x"][()] * float(f["x"].attrs["scale_factor"][0]) + float(f["x"].attrs["add_offset"][0])
        y = f["y"][()] * float(f["y"].attrs["scale_factor"][0]) + float(f["y"].attrs["add_offset"][0])
        projection = f["goes_imager_projection"].attrs
        req = float(projection["semi_major_axis"][0])
        meta = dict(
            sub_lon=float(projection["longitude_of_projection_origin"][0]),
            distance=float(projection["perspective_point_height"][0]) + req,
            distance_km=(float(projection["perspective_point_height"][0]) + req) / 1000,  # metres in the file
            req=req,
            rpol=float(projection["semi_minor_axis"][0]),
            x0=float(x[: len(x) - len(x) % factor].reshape(-1, factor).mean(1)[0]),
            y0=float(y[: len(y) - len(y) % factor].reshape(-1, factor).mean(1)[0]),
            dx=float(x[1] - x[0]) * factor,
            dy=float(y[1] - y[0]) * factor,
            wavelength=float(f["band_wavelength"][0]),
            earth_sun_au=float(f["earth_sun_distance_anomaly_in_AU"][()]),
        )
    return image, meta


def abi_sample(image: np.ndarray, meta: dict, lon, lat):
    """ABI values at body-fixed points (fixed grid, sweep x), and the cosine of the view zenith."""
    sx, sy, sz, cz = geostationary(lon, lat, meta["sub_lon"], meta["distance"], meta["req"], meta["rpol"])
    rn = np.sqrt(sx * sx + sy * sy + sz * sz)
    x = np.arcsin(-sy / rn)
    y = np.arctan(sz / sx)
    ci = np.clip(np.round((x - meta["x0"]) / meta["dx"]).astype(np.int64), 0, image.shape[1] - 1)
    li = np.clip(np.round((y - meta["y0"]) / meta["dy"]).astype(np.int64), 0, image.shape[0] - 1)
    return np.where(cz > 0, image[li, ci], np.nan), cz


# --- The map ------------------------------------------------------------------------------------


def grid_rows(start: int, count: int) -> tuple[np.ndarray, np.ndarray]:
    """Longitude and latitude of the oversampled grid for output rows start..start+count."""
    n = WIDTH * OVERSAMPLE
    lon = (np.arange(n) + 0.5) / n * 360 - 180
    fine = (np.arange(start * OVERSAMPLE, (start + count) * OVERSAMPLE) + 0.5) / (HEIGHT * OVERSAMPLE)
    lat = 90 - fine * 180
    return np.meshgrid(lon, lat)


def to_output(fine: np.ndarray) -> np.ndarray:
    """Average OVERSAMPLE x OVERSAMPLE blocks; any missing sample makes the output missing."""
    h, w = fine.shape
    return fine.reshape(h // OVERSAMPLE, OVERSAMPLE, w // OVERSAMPLE, OVERSAMPLE).mean(axis=(1, 3))


def sample_all(samplers: dict) -> dict:
    """Every band of every satellite, and each satellite's view cosine, on the output grid."""
    out = {name: np.full((HEIGHT, WIDTH), np.nan, np.float32) for name in samplers}
    for start in range(0, HEIGHT, ROWS_PER_BLOCK):
        lon, lat = grid_rows(start, ROWS_PER_BLOCK)
        for name, sample in samplers.items():
            out[name][start : start + ROWS_PER_BLOCK] = to_output(sample(lon, lat))
    return out


def fit(y: np.ndarray, xs: list[np.ndarray]) -> dict:
    """Least squares y = sum(a_i x_i), through zero: no light in the inputs is no light out, so
    the night side stays dark. With its correlation and RMS residual."""
    design = np.column_stack(xs)
    coefficients, *_ = np.linalg.lstsq(design, y, rcond=None)
    predicted = design @ coefficients
    return {
        "coefficients": [float(c) for c in coefficients],
        "r": float(np.corrcoef(predicted, y)[0, 1]),
        "rms": float(np.sqrt(np.mean((predicted - y) ** 2))),
        "samples": int(y.size),
    }


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


def linear_to_srgb(v: np.ndarray) -> np.ndarray:
    return np.where(v <= 0.0031308, 12.92 * v, 1.055 * np.power(v, 1 / 2.4) - 0.055)


def sun_earth_fixed(epoch: dict) -> np.ndarray:
    """The Sun's direction from Earth in IAU_EARTH, from the committed ephemeris."""
    sun = np.array(epoch["sunDirectionJ2000"]) * epoch["sunDistanceKm"]
    earth = np.array(epoch["earthDirectionJ2000"]) * epoch["earthDistanceKm"]
    v = np.array(epoch["j2000ToEarthFixed"]) @ (sun - earth)
    return v / np.linalg.norm(v)


def unit_grid() -> np.ndarray:
    """The outward surface normal at each output pixel: its latitude is geodetic."""
    lon = np.radians((np.arange(WIDTH) + 0.5) / WIDTH * 360 - 180)
    lat = np.radians(90 - (np.arange(HEIGHT) + 0.5) / HEIGHT * 180)
    lon, lat = np.meshgrid(lon, lat)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)


def fetch_all(files: list[dict]) -> list[Path]:
    paths = []
    for entry in files:
        (Path(__file__).resolve().parent / ".cache" / entry["name"]).parent.mkdir(parents=True, exist_ok=True)
        paths.append(fetch(entry["url"], entry["sha256"], entry["name"]))
    return paths


def load_and_sample(paths: list[Path], ahi_bands: list[str], abi_bands: list[str], r: float):
    """Each band on the output grid as I/F, and each instrument's metadata. `r` is Earth's
    distance from the Sun, AU: AHI albedo is relative to 1 AU and becomes I/F times r^2."""
    ahi, ahi_meta = {}, {}
    for band in ahi_bands:
        image, meta = read_ahi([p for p in paths if f"_{band}_" in p.name], AHI_FACTOR[band])
        ahi[band], ahi_meta[band] = image * np.float32(r * r), meta
        print(f"  AHI {band} {meta['wavelength']:.3f} um: {image.shape}", flush=True)
    abi, abi_meta = {}, {}
    for band in abi_bands:
        (path,) = [p for p in paths if f"M6{band}_" in p.name]
        abi[band], abi_meta[band] = read_abi(path, ABI_FACTOR[band])
        print(f"  ABI {band} {abi_meta[band]['wavelength']:.3f} um: {abi[band].shape}", flush=True)
        if abs(abi_meta[band]["earth_sun_au"] - r) > 1e-4:
            raise ValueError(f"GOES says Earth was {abi_meta[band]['earth_sun_au']} AU from the Sun, not {r}")
    samplers = {}
    for band in ahi_bands:
        samplers[f"ahi_{band}"] = lambda lon, lat, b=band: ahi_sample(ahi[b], ahi_meta[b], lon, lat)[0]
    for band in abi_bands:
        samplers[f"abi_{band}"] = lambda lon, lat, b=band: abi_sample(abi[b], abi_meta[b], lon, lat)[0]
    return sample_all(samplers), ahi_meta, abi_meta


def looks(meta: dict, sun: np.ndarray, to_moon: np.ndarray | None = None) -> dict:
    """A satellite's view of every output-grid place: the cosine of the view zenith, the phase
    angle (Sun-place-satellite), and the angle between its line of sight and the Moon's."""
    normal = unit_grid()
    place = normal * 6371.0
    lon = math.radians(meta["sub_lon"])
    satellite = np.array([math.cos(lon), math.sin(lon), 0.0]) * meta["distance_km"]
    v = satellite - place
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    mu0 = normal @ sun
    mirror = 2 * mu0[..., None] * normal - sun
    out = {
        "cz": (v * normal).sum(-1),
        "phase": np.degrees(np.arccos(np.clip(v @ sun, -1, 1))),
        # Angle between the line of sight and the Sun's mirror reflection: small is sun glint.
        "glint": np.degrees(np.arccos(np.clip((v * mirror).sum(-1), -1, 1))),
    }
    if to_moon is not None:
        out["from_moon"] = np.degrees(np.arccos(np.clip((v * to_moon).sum(-1), -1, 1)))
    return out


def cross_calibrate(files: list[dict]) -> dict:
    """Himawari-9 against GOES-18 where both saw the same place in mirror geometry: the same view
    zenith and phase angle within MIRROR_DEG, in daylight, both within FIT_MAX_ZENITH_DEG of
    straight down. The scans start at 00:10 UTC; the Sun is taken at mid-scan, 00:15, from SPICE
    with the ephemeris's pinned kernels. At the app's own instant no place is in mirror geometry
    (the Sun is far to Himawari's side), so a scan pair when the Sun stood between them is used."""
    import spiceypy as spice

    from ephemeris import load_kernels

    load_kernels()
    try:
        et = spice.str2et("2026-01-26T00:15:00")
        sun_vec, _ = spice.spkpos("SUN", et, "IAU_EARTH", "LT+S", "EARTH")
    finally:
        spice.kclear()
    r = float(np.linalg.norm(sun_vec)) / AU_KM
    sun = np.array(sun_vec) / np.linalg.norm(sun_vec)
    grid, ahi_meta, abi_meta = load_and_sample(fetch_all(files), ["B01", "B03"], ["C01", "C02"], r)
    mu0 = unit_grid() @ sun
    a = looks(ahi_meta["B03"], sun)
    b = looks(abi_meta["C02"], sun)
    za = np.degrees(np.arccos(np.clip(a["cz"], -1, 1)))
    zb = np.degrees(np.arccos(np.clip(b["cz"], -1, 1)))
    mirror = (
        (np.abs(za - zb) < MIRROR_DEG)
        & (np.abs(a["phase"] - b["phase"]) < MIRROR_DEG)
        & (mu0 > FIT_MIN_MU0)
        & (za < FIT_MAX_ZENITH_DEG)
        & (zb < FIT_MAX_ZENITH_DEG)
    )
    for name in ("ahi_B01", "ahi_B03", "abi_C01", "abi_C02"):
        mirror &= np.isfinite(grid[name])
    fits = {
        "red": fit(grid["ahi_B03"][mirror], [grid["abi_C02"][mirror]]),
        "blue": fit(grid["ahi_B01"][mirror], [grid["abi_C01"][mirror]]),
    }
    for name, f in fits.items():
        print(f"  mirror geometry {name}: AHI = {f['coefficients'][0]:.4f} ABI, r {f['r']:.4f}, RMS {f['rms']:.4f}, n {f['samples']}")
    return fits


def build_instant(epoch: dict, files: list[dict], calibration: dict) -> dict:
    r = epoch["earthSunDistanceKm"] / AU_KM
    grid, ahi_meta, abi_meta = load_and_sample(fetch_all(files), list(AHI_FACTOR), list(ABI_FACTOR), r)

    # Geometry on the output grid: the Sun, the Moon and each satellite as seen from each place.
    normal = unit_grid()
    sun = sun_earth_fixed(epoch)
    mu0 = normal @ sun
    moon_fixed = np.array(epoch["j2000ToEarthFixed"]) @ -np.array(epoch["earthDirectionJ2000"])
    to_moon = moon_fixed * epoch["earthDistanceKm"] - normal * 6371.0
    to_moon /= np.linalg.norm(to_moon, axis=-1, keepdims=True)
    a_look = looks(ahi_meta["B03"], sun, to_moon)
    b_look = looks(abi_meta["C02"], sun, to_moon)

    # GOES onto Himawari's scale, by the mirror-geometry fits.
    for band, channel in (("C02", "red"), ("C01", "blue")):
        f = calibration[channel]
        grid[f"abi_{band}"] = f["coefficients"][0] * grid[f"abi_{band}"]

    # GOES has no green band. Himawari's own bands, all seen through one geometry and perfectly
    # registered, give green from blue, red and near-infrared; GOES's matching bands then give
    # its green by the same relation.
    lit = (mu0 > FIT_MIN_MU0) & (a_look["cz"] > math.cos(math.radians(FIT_MAX_ZENITH_DEG)))
    for band in AHI_FACTOR:
        lit &= np.isfinite(grid[f"ahi_{band}"])
    green = fit(grid["ahi_B02"][lit], [grid["ahi_B01"][lit], grid["ahi_B03"][lit], grid["ahi_B04"][lit]])
    ga, gb, gc = green["coefficients"]
    grid["abi_green"] = ga * grid["abi_C01"] + gb * grid["abi_C02"] + gc * grid["abi_C03"]
    print(f"  green from AHI 0.47/0.64/0.86: {green['coefficients']}, r {green['r']:.4f}, RMS {green['rms']:.4f}")

    # Blend: each satellite counts by how directly it saw the place (fully to 65 degrees from
    # straight down, fading by 85) times how like the Moon's its line of sight was.
    # Inside its own glint a satellite keeps a trace of weight, so a place glinting for both is
    # still shown, from the less glinting.
    w_a = smoothstep(*BLEND, a_look["cz"]) * np.exp(-((a_look["from_moon"] / PREFER_SIGMA_DEG) ** 2))
    w_b = smoothstep(*BLEND, b_look["cz"]) * np.exp(-((b_look["from_moon"] / PREFER_SIGMA_DEG) ** 2))
    w_a *= np.maximum(smoothstep(*GLINT_DEG, a_look["glint"]), 1e-3)
    w_b *= np.maximum(smoothstep(*GLINT_DEG, b_look["glint"]), 1e-3)
    channels = []
    for a_name, b_name in (("ahi_B03", "abi_C02"), ("ahi_B02", "abi_green"), ("ahi_B01", "abi_C01")):
        a = grid[a_name]
        b = grid[b_name]
        wa = np.where(np.isfinite(a), w_a, 0)
        wb = np.where(np.isfinite(b), w_b, 0)
        total = wa + wb
        with np.errstate(invalid="ignore", divide="ignore"):
            value = (wa * np.nan_to_num(a) + wb * np.nan_to_num(b)) / total
        channels.append(np.where(total > 0, value, np.nan))
    rgb = np.stack(channels, -1)
    measured = np.isfinite(rgb).all(-1)
    share = float((w_b / np.maximum(w_a + w_b, 1e-30))[measured & (mu0 > 0) & (normal @ moon_fixed > 0)].mean())

    # Coverage of what the Moon sees lit (the Sun up), for the record.
    faces_moon = normal @ moon_fixed > 0
    area = np.cos(np.radians(90 - (np.arange(HEIGHT) + 0.5) / HEIGHT * 180))[:, None] * np.ones((1, WIDTH))
    seen = faces_moon & (mu0 > 0)
    projected = area * np.clip(normal @ moon_fixed, 0, None)  # as the disc shows it
    coverage = float((projected * (seen & measured)).sum() / (projected * seen).sum())
    clipped = float((rgb[measured] > 1).any(-1).mean())
    print(f"  measured over {100 * coverage:.3f}% of the lit disc the Moon sees; {100 * clipped:.3f}% clipped above I/F 1")

    value = linear_to_srgb(np.clip(np.nan_to_num(rgb), 0, 1))
    pixels = np.zeros((HEIGHT, WIDTH, 4), np.uint8)
    pixels[..., :3] = np.round(value * 255).astype(np.uint8)
    pixels[..., 3] = np.where(measured, 255, 0)
    OUT.mkdir(parents=True, exist_ok=True)
    name = f"{epoch['id']}.webp"
    Image.fromarray(pixels, "RGBA").save(OUT / name, "WEBP", lossless=True, quality=100, method=6, exact=True)
    return {
        "utc": epoch["utc"],
        "image": f"data/earth/{name}",
        "satellites": {
            "Himawari-9 AHI": {
                "scan": "full disc, start 2026-01-26 05:00 UTC",
                "subLongitudeDeg": ahi_meta["B03"]["sub_lon"],
                "bands": {b: round(m["wavelength"], 4) for b, m in ahi_meta.items()},
                "scale": "albedo = c' x radiance (JMA, relative to 1 AU), times r^2 to I/F",
            },
            "GOES-18 ABI": {
                "scan": "full disc, mode 6, start 2026-01-26 05:00:21 UTC",
                "subLongitudeDeg": abi_meta["C02"]["sub_lon"],
                "bands": {b: round(m["wavelength"], 4) for b, m in abi_meta.items()},
                "scale": "reflectance factor = kappa0 x radiance, already I/F",
            },
        },
        "earthSunDistanceAu": r,
        "greenForGoes": {
            "note": f"Himawari-9 0.51 um fitted to its own 0.47, 0.64 and 0.86 um bands (daylight, mu0 > {FIT_MIN_MU0}, within {FIT_MAX_ZENITH_DEG} degrees of straight down), applied to GOES-18 0.47, 0.64 and 0.865 um",
            **green,
        },
        "crossCalibration": {
            "note": f"GOES-18 0.47 and 0.64 um put on Himawari-9's scale by fits where both saw the same place in mirror geometry (view zenith and phase angle within {MIRROR_DEG} degrees, daylight, within {FIT_MAX_ZENITH_DEG} degrees of straight down), from their scans at 2026-01-26 00:10 UTC. GOES 0.865 um (weight 0.014 in green) is used as measured",
            **calibration,
        },
        "blend": f"each satellite weighted smoothstep(cos 85, cos 65, cos view zenith) x exp(-(angle between its line of sight and the Moon's / {PREFER_SIGMA_DEG:.0f} deg)^2) x max(smoothstep({GLINT_DEG[0]:.0f}, {GLINT_DEG[1]:.0f} deg, its sun-glint angle), 0.001)",
        "goesShareOfLitDisc": share,
        "measuredFractionOfLitDiscSeenFromMoon": coverage,
        "clippedFraction": clipped,
    }


def main() -> None:
    sources = json.loads(SOURCES.read_text())
    ephemeris = json.loads(EPHEMERIS.read_text())
    epochs = {e["id"]: e for e in ephemeris["epochs"]}
    print("cross-calibration", flush=True)
    calibration = cross_calibrate(sources["crossCalibration"]["files"])
    instants = {}
    for instant, files in sources["instants"].items():
        print(instant, flush=True)
        instants[instant] = build_instant(epochs[instant], files, calibration)
    faces = {
        "note": "Earth as the geostationary satellites measured it at the app's instants (docs/stories/SS-13c.md). Built by pipeline/earth.py from the files in pipeline/earth_sources.json.",
        "attribution": "Himawari-9 data: JMA, distributed by NOAA. GOES-18 data: NOAA. Modified: resampled, cross-calibrated and blended; not original, unaltered data.",
        "conventions": "plate carree, pixel centres, longitude -180..180 east-positive left to right, geodetic latitude 90..-90 top to bottom (GRS80, as the satellites' navigation), IAU_EARTH. RGB: I/F at 0.64 / 0.51 / 0.47 um under that instant's Sun, clipped to 1, sRGB-encoded. Alpha 255 measured, 0 not measured.",
        "instants": instants,
    }
    (OUT / "faces.json").write_text(json.dumps(faces, indent=1, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
