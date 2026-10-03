"""Mars's large-scale visible brightness from Hubble (SS-14 W3 part 3; owner, 2026-10-03: "Fix W3
from HST first", "1999 only, fade south").

W7 found the W3 map's large-scale contrast at 530 nm 2.4 times Mars's measured light curve:
HRSC's colour ratios are flattened at large scale, so the visible map kept OMEGA's near-infrared
contrast. Hubble measured Mars's visible brightness directly. This module turns its four 1999
opposition cubes at 547 nm into a factor field the map is multiplied by: Hubble's level on
scales over SIGMA_DEG, OMEGA's and HRSC's detail within them.

Source (pipeline/hst_sources.json, docs/data/mars.md): Bell (2004), HST-M-WFPC2-3-V1.0,
doi:10.17189/1519478. Daily cubes "calibrated to radiance factor, or I/F", simple cylindrical,
1200 x 600 at 0.3 deg, "Mars areocentric, west positive", the first pixel at (90 S, 180 W), FITS
big-endian float32 after a 23,040-byte header; planes in the order the header's WAVEn lists them,
then the emission and incidence angle backplanes (degrees). Pixel centres are taken at
(-90 + 0.3 k) deg latitude and (-180 + 0.3 c) deg east longitude, as the label puts the first
pixel; a cross-correlation with the map was flat to within half a pixel, 0.15 deg, immaterial at
SIGMA_DEG.

Method:
1. Each cube's F547M plane, where emission and incidence are under MAX_ANGLE_DEG, is normalised
   to the map's geometry (e = 0, g = i = 30 deg: the map is I/F / cos i seen near nadir, Ody et al.
   2012) by the law in hst_sources.json: A = I/F x R(30, 0, 30) / (cos 30 x R(i, e, g)), with g the
   cube's own phase angle from its header's sub-Earth and sub-solar points.
2. The four days are averaged, each pixel weighted by mu mu0, and resampled onto the map's 0.3 deg
   pixel centres.
3. The ratio of that to the map at 0.3 deg is smoothed by a Gaussian of SIGMA_DEG (normalised
   convolution with the same weights, wrapping in longitude).
4. Where Hubble did not see, the factor fades to the ratio's median over the covered planet within
   FADE_DEG of the coverage edge: there the map keeps its own contrast, and albedo-hst.png says so.
"""

from __future__ import annotations

import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates

from download import fetch
from hapke import hapke

SOURCES = json.loads((Path(__file__).resolve().parent / "hst_sources.json").read_text())
HEADER_BYTES = 23040
WIDTH, HEIGHT = 1200, 600
STEP_DEG = 0.3
# The filter nearest the map's 530 nm band and Johnson V: F547M, 546.78 nm, 48 nm wide.
WAVELENGTH_NM = 546.78
# Limb and terminator are left out: there the law's normalisation is least certain.
MAX_ANGLE_DEG = 60.0
# The scale above which Hubble sets the level (owner-approved spec: 2 deg, part 2's blend scale),
# and the width over which the factor fades to its median outside Hubble's coverage.
SIGMA_DEG = 2.0
FADE_DEG = 2.0
# A 0.3 deg pixel counts as covered when the smoothed weight there is at least this fraction of
# the weight of fully covered ground.
COVERED = 0.5


def header_cards(raw: bytes) -> dict[str, str]:
    text = raw[:HEADER_BYTES].decode("ascii", "replace")
    cards = {}
    for i in range(0, HEADER_BYTES, 80):
        card = text[i : i + 80]
        if "=" in card[:10]:
            cards[card[:8].strip()] = card[10:].split("/")[0].strip().strip("'").strip()
    return cards


def unit_west(lon_west: float, lat: float) -> np.ndarray:
    lon = math.radians(-lon_west)
    lat = math.radians(lat)
    return np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])


def normalised_day(day: str) -> tuple[np.ndarray, np.ndarray, dict]:
    """One day's F547M brightness at the map's geometry, and its weights, north up."""
    pinned = SOURCES["cubes"][day]
    path = fetch(SOURCES["base"] + pinned["path"], pinned["sha256"], f"hst/{day}_cyl.cub")
    raw = path.read_bytes()
    cards = header_cards(raw)
    planes = int(cards["PLANENUM"])
    band = next(k for k in range(1, planes + 1) if abs(float(cards[f"WAVE{k}"]) - WAVELENGTH_NM) < 0.01)
    if cards[f"FILTER{band}"] != "F547M":
        raise ValueError(f"{day}: plane {band} is {cards[f'FILTER{band}']}, not F547M")
    count = planes + int(cards["BPLANENM"])
    cube = np.frombuffer(raw[HEADER_BYTES : HEADER_BYTES + count * WIDTH * HEIGHT * 4], dtype=">f4")
    cube = cube.reshape(count, HEIGHT, WIDTH)[:, ::-1, :].astype(np.float64)
    value, emission, incidence = cube[band - 1], cube[planes], cube[planes + 1]
    earth = unit_west(float(cards["POINT03"]), float(cards["POINT02"]))
    sun = unit_west(float(cards["POINT05"]), float(cards["POINT04"]))
    cos_g = float(earth @ sun)
    law = SOURCES["law"]
    norm = law["normalisation"]
    mu0s = math.cos(math.radians(norm["incidenceDeg"]))
    standard = float(hapke(mu0s, math.cos(math.radians(norm["emissionDeg"])), math.cos(math.radians(norm["phaseDeg"])), law, law["thetaBarDeg"]))
    ok = (
        np.isfinite(value)
        & (value > 0)
        & (emission >= 0)
        & (emission < MAX_ANGLE_DEG)
        & (incidence >= 0)
        & (incidence < MAX_ANGLE_DEG)
    )
    mu = np.cos(np.radians(np.where(ok, emission, 0)))
    mu0 = np.cos(np.radians(np.where(ok, incidence, 0)))
    here = hapke(mu0, mu, cos_g, law, law["thetaBarDeg"])
    a = np.where(ok, value * standard / (mu0s * np.maximum(here, 1e-12)), 0.0)
    record = {
        "day": day,
        "phaseAngleDeg": round(math.degrees(math.acos(cos_g)), 3),
        "subEarth": {"lonWestDeg": float(cards["POINT03"]), "latDeg": float(cards["POINT02"])},
        "subSolar": {"lonWestDeg": float(cards["POINT05"]), "latDeg": float(cards["POINT04"])},
        "pixelsUsed": int(ok.sum()),
        "medianAtMapGeometry": round(float(np.median(a[ok])), 4),
    }
    return a, np.where(ok, mu * mu0, 0.0), record


def to_map_centres(field: np.ndarray) -> np.ndarray:
    """From Hubble's pixel centres (lat 89.7 - 0.3 r after the flip, lon -180 + 0.3 c) to the map's
    0.3 deg centres (lat 89.85 - 0.3 r, lon -180 + 0.3 (c + 0.5)): half a pixel each way."""
    rows, cols = np.meshgrid(np.arange(HEIGHT) - 0.5, np.arange(WIDTH) + 0.5, indexing="ij")
    rows = np.clip(rows, 0, HEIGHT - 1)
    return map_coordinates(field, [rows, cols], order=1, mode="grid-wrap")


def smooth(values: np.ndarray, sigma_px: float) -> np.ndarray:
    return gaussian_filter(values, sigma_px, mode=["nearest", "wrap"])


def factor_field(
    map_03: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, dict, np.ndarray, np.ndarray]:
    """The factor at 0.3 deg, the coverage fade (1 where Hubble sets the level), and the record."""
    total = np.zeros((HEIGHT, WIDTH))
    weights = np.zeros((HEIGHT, WIDTH))
    days = []
    for day in SOURCES["cubes"]:
        a, w, record = normalised_day(day)
        total += a * w
        weights += w
        days.append(record)
    hst_sum = to_map_centres(total)
    hst_w = to_map_centres(weights)
    hst = np.where(hst_w > 0, hst_sum / np.maximum(hst_w, 1e-12), np.nan)
    seen = hst_w > 0

    sigma_px = SIGMA_DEG / STEP_DEG
    ratio = np.where(seen, hst / map_03, 0.0)
    num = smooth(ratio * hst_w, sigma_px)
    den = smooth(hst_w, sigma_px)
    smoothed = num / np.maximum(den, 1e-12)
    # Full weight: the smoothed weight over ground every day saw well, its 90th percentile.
    full = float(np.percentile(den[seen], 90))
    covered = den >= COVERED * full
    median = float(np.median((hst / map_03)[seen]))
    distance = distance_transform_edt(~covered) * STEP_DEG
    fade = np.clip(1 - distance / FADE_DEG, 0, 1)
    factor = median + fade * (np.where(covered | (fade > 0), smoothed, median) - median)

    lat = 90 - (np.arange(HEIGHT) + 0.5) * STEP_DEG
    bands = {}
    for lo, hi in [(60, 90), (30, 60), (0, 30), (-30, 0), (-60, -30), (-90, -60)]:
        rows = (lat >= lo) & (lat < hi)
        bands[f"{hi}..{lo}"] = round(float(covered[rows].mean()), 3)
    record = {
        "source": SOURCES["source"],
        "filter": "F547M, 546.78 nm, 48.32 nm wide",
        "days": days,
        "maxAngleDeg": MAX_ANGLE_DEG,
        "law": SOURCES["law"],
        "sigmaDeg": SIGMA_DEG,
        "fadeDeg": FADE_DEG,
        "coveredFraction": round(float(covered.mean()), 4),
        "coveredFractionByLatitude": bands,
        "medianRatioHubbleOverMap": round(median, 4),
        "correlationWithMap": round(float(np.corrcoef(hst[seen], map_03[seen])[0, 1]), 4),
        "contrast": {
            "hubble": round(float(np.std(hst[seen]) / np.mean(hst[seen])), 4),
            "mapBefore": round(float(np.std(map_03[seen]) / np.mean(map_03[seen])), 4),
        },
        "factor": {
            "p1": round(float(np.percentile(factor, 1)), 4),
            "median": round(float(np.median(factor)), 4),
            "p99": round(float(np.percentile(factor, 99)), 4),
        },
    }
    return factor, fade, record, hst, hst_w


def upsample(field: np.ndarray, width: int, height: int) -> np.ndarray:
    """Bilinear from the 0.3 deg centres to a width x height grid's centres, wrapping in longitude."""
    rows = (np.arange(height) + 0.5) * HEIGHT / height - 0.5
    cols = (np.arange(width) + 0.5) * WIDTH / width - 0.5
    rr, cc = np.meshgrid(np.clip(rows, 0, HEIGHT - 1), cols, indexing="ij")
    return map_coordinates(field, [rr, cc], order=1, mode="grid-wrap")


def coverage_png(fade: np.ndarray) -> bytes:
    """albedo-hst.png: 255 where Hubble sets the large-scale level, 0 where the map keeps its own."""
    out = io.BytesIO()
    Image.fromarray(np.rint(255 * fade).astype(np.uint8), "L").save(out, format="PNG", optimize=True)
    return out.getvalue()
