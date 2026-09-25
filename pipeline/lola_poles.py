"""The Moon's polar albedo from LOLA, combined with Clementine (docs/stories/SS-6b.md).

Owner decision, 2026-09-25: replace Clementine poleward of about 70 degrees with LOLA's
laser albedo. Near the poles the Sun is always low, so Clementine's 750 nm mosaic records
shading as much as albedo, and never saw the crater floors the Sun never reaches. LOLA lights
the surface with its own laser, so it measures albedo with no shading, everywhere.

Source: LOLA LDAM polar albedo maps, Lemelin et al. (2016), PDS data set
LRO-L-LOLA-4-GDR-V1.0, products LDAM_50S_1000M_FLOAT and LDAM_50N_1000M_FLOAT. From their
labels: 32-bit little-endian floats, 2532 x 2532, polar stereographic (spherical,
R = 1737.4 km), 1000 m/pixel true at the pole, LINE_PROJECTION_OFFSET = SAMPLE_PROJECTION_OFFSET
= 1265.5, planetocentric latitude, POSITIVE_LONGITUDE_DIRECTION = EAST, frame "MEAN
EARTH/POLAR AXIS OF DE421", values are 1064 nm normal albedo (0.15 to 0.58). The publisher
interpolated between laser ground tracks (the label says so); that is their product.

Orientation. The data set's DSMAP_POLAR.CAT says in prose: "In the north, Longitude 0 extends
straight down from the center and Longitude 90 East extends to the right. In the south,
Longitude 0 extends straight up from the center, and Longitude 90 East extends to the
right." Its inverse formulas disagree with that prose for the south pole. The prose is used:
against Clementine at 50-60 degrees it correlates at r = 0.73 (south) and 0.77 (north),
and the formula's orientation does not (docs/stories/SS-6b.md). pipeline/test_lola_poles.py
asserts the orientation and the sub-pixel origin.

Combination (README, "Combine every available source"):
- Calibration: Clementine value = gain * LOLA albedo + offset, least squares, fitted per pole
  over 50-60 degrees where both are valid. There the Sun is high enough for Clementine to be
  albedo-like, and the fit's r and RMS residual are recorded.
- Blend: weight w rises smoothly (smoothstep) from 0 at |latitude| 65 to 1 at 75. Output =
  (1 - w) * Clementine + w * calibrated LOLA. Where Clementine never imaged a point and w > 0,
  the calibrated LOLA value is used as is: it is a measurement.
- Equatorward of 65 degrees nothing changes, and Clementine's gaps there stay gaps.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from download import fetch

BASE = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/float_img/"
PRODUCTS = {
    "south": ("ldam_50s_1000m_float.img", "cd35ca62d322d48b2b809041e9baa086242842c25a50f8bff70936929910079a"),
    "north": ("ldam_50n_1000m_float.img", "f795fd56e19718e31885fb79f7d9cd197302df91741a4f39e3aa13f053a73273"),
}
N = 2532
OFFSET = 1265.5  # 0-based pixel coordinate of the pole, from the label
SCALE_M = 1000.0
RADIUS_M = 1737400.0

FIT_BAND = (50.0, 60.0)  # |latitude|, degrees
BLEND_BAND = (65.0, 75.0)


def load(pole: str) -> np.ndarray:
    name, sha = PRODUCTS[pole]
    path: Path = fetch(BASE + name, sha, name)
    data = np.fromfile(path, dtype="<f4")
    if data.size != N * N:
        raise RuntimeError(f"{name}: {data.size} samples, expected {N * N}")
    return data.reshape(N, N).astype(np.float64)


def pixel_coordinates(pole: str, lat_deg: np.ndarray, lon_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """0-based (line, sample) in the polar map for planetocentric east longitudes."""
    lat = np.radians(np.abs(lat_deg))
    lon = np.radians(lon_deg)
    rho = 2 * RADIUS_M * np.tan(np.pi / 4 - lat / 2) / SCALE_M  # pixels from the pole
    sample = OFFSET + rho * np.sin(lon)  # 90 E to the right at both poles
    # South: longitude 0 straight up (towards line 0). North: straight down.
    up = 1.0 if pole == "south" else -1.0
    line = OFFSET - up * rho * np.cos(lon)
    return line, sample


def bilinear(image: np.ndarray, line: np.ndarray, sample: np.ndarray) -> np.ndarray:
    """Bilinear interpolation at 0-based pixel-centre coordinates; NaN outside the map."""
    l0 = np.floor(line).astype(np.int64)
    s0 = np.floor(sample).astype(np.int64)
    inside = (l0 >= 0) & (s0 >= 0) & (l0 < N - 1) & (s0 < N - 1)
    fl = line - l0
    fs = sample - s0
    l0 = np.clip(l0, 0, N - 2)
    s0 = np.clip(s0, 0, N - 2)
    v = (
        image[l0, s0] * (1 - fl) * (1 - fs)
        + image[l0, s0 + 1] * (1 - fl) * fs
        + image[l0 + 1, s0] * fl * (1 - fs)
        + image[l0 + 1, s0 + 1] * fl * fs
    )
    return np.where(inside, v, np.nan)


def sample_pole(image: np.ndarray, pole: str, lat_deg: np.ndarray, lon_deg: np.ndarray) -> np.ndarray:
    line, sample = pixel_coordinates(pole, lat_deg, lon_deg)
    return bilinear(image, line, sample)


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def grid(height: int, width: int, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Latitude and longitude (degrees) of texel centres for the given rows of the texture."""
    lat = 90.0 - (rows + 0.5) * 180.0 / height
    lon = (np.arange(width) + 0.5) * 360.0 / width - 180.0
    return np.repeat(lat[:, None], width, axis=1), np.repeat(lon[None, :], len(rows), axis=0)


def combine(master: np.ndarray) -> tuple[np.ndarray, dict]:
    """Clementine master (uint8, 0 = never imaged) with LOLA at the poles.

    Returns the combined uint8 image (0 = still missing) and a record of the fits.
    """
    height, width = master.shape
    out = master.astype(np.float64)
    valid = master > 0
    record: dict = {}
    for pole in ("south", "north"):
        lola = load(pole)
        sign = -1.0 if pole == "south" else 1.0
        lat_all = 90.0 - (np.arange(height) + 0.5) * 180.0 / height
        rows = np.nonzero(sign * lat_all >= FIT_BAND[0])[0]
        lat, lon = grid(height, width, rows)
        l_vals = sample_pole(lola, pole, lat, lon)
        c_vals = out[rows]
        c_valid = valid[rows]

        # Calibration where both measure albedo.
        abs_lat = np.abs(lat)
        fit = (abs_lat >= FIT_BAND[0]) & (abs_lat < FIT_BAND[1]) & c_valid & np.isfinite(l_vals)
        x = l_vals[fit]
        y = c_vals[fit]
        gain, offset = np.polyfit(x, y, 1)
        residual = y - (gain * x + offset)
        r = float(np.corrcoef(x, y)[0, 1])

        calibrated = gain * l_vals + offset
        w = smoothstep(BLEND_BAND[0], BLEND_BAND[1], abs_lat)
        w = np.where(np.isfinite(l_vals), w, 0.0)
        blended = np.where(c_valid, (1 - w) * c_vals + w * np.nan_to_num(calibrated), np.nan_to_num(calibrated))
        use = w > 0
        filled_gaps = int(np.sum(use & ~c_valid))
        c_vals = np.where(use, blended, c_vals)
        out[rows] = c_vals
        valid[rows] = c_valid | use

        record[pole] = {
            "product": PRODUCTS[pole][0].upper().replace(".IMG", ""),
            "url": BASE + PRODUCTS[pole][0],
            "sha256": PRODUCTS[pole][1],
            "fit": {
                "model": "clementine = gain * lola_albedo + offset",
                "band": f"|latitude| {FIT_BAND[0]:g} to {FIT_BAND[1]:g} deg, both valid",
                "pixels": int(fit.sum()),
                "gain": round(float(gain), 4),
                "offset": round(float(offset), 4),
                "r": round(r, 4),
                "rmsResidual": round(float(np.sqrt(np.mean(residual**2))), 3),
            },
            "clementineGapsFilled": filled_gaps,
        }

    combined = np.where(valid, np.clip(np.rint(out), 1, 255), 0).astype(np.uint8)
    record["blend"] = (
        f"smoothstep weight from 0 at |latitude| {BLEND_BAND[0]:g} to 1 at {BLEND_BAND[1]:g} deg; "
        "LOLA alone poleward, Clementine alone equatorward"
    )
    record["orientation"] = (
        "DSMAP_POLAR.CAT prose (90 E to the right at both poles; south lon 0 up, north lon 0 down); "
        "its south-pole inverse formula disagrees and was not used"
    )
    return combined, record


def provenance(lat_deg: float) -> str:
    """Which source a latitude's albedo comes from."""
    a = abs(lat_deg)
    if a < BLEND_BAND[0]:
        return "clementine"
    if a >= BLEND_BAND[1]:
        return "lola"
    return "blend"

