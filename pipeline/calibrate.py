"""Absolute scale for the Moon's relative albedo map.

    npm run pipeline:calibrate

Neither Clementine label gives a reflectance scale (docs/stories/SS-5.md), so the map is
scaled so that the Moon it draws has the Moon's measured visual geometric albedo, 0.12 (NASA
Moon Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html).

The renderer shades with Lommel-Seeliger, I/F = (w/4) mu0 / (mu0 + mu), with w = k * v and v
the texture value in [0, 1]. At zero phase mu0 = mu everywhere, so I/F = w/8 at every point of
the disc. Geometric albedo is the disc's mean I/F at zero phase, the mean taken over the
projected disc, so

    p = (k/8) * mean(v over the Earth-facing hemisphere, weighted by mu * dA)

and k = 8p / that mean. The hemisphere is centred on longitude 0, latitude 0, the mean
sub-Earth point; dA is proportional to cos(latitude) on the equirectangular grid. Pixels a
mask marks as never measured, if there are any, are left out.

The 750 nm map supplies the pattern of relative albedo; the absolute scale is visual (V band),
because the display shows visible brightness. Deterministic: CI re-runs it and diffs.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "public/data/moon/albedo.json"
GEOMETRIC_ALBEDO = 0.12
SOURCE = "NASA Moon Fact Sheet, 'Visual geometric albedo 0.12' (https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html)"


def disc_weighted_mean(values: np.ndarray, gap: np.ndarray) -> float:
    """Mean of values over the hemisphere facing (0, 0), weighted by projected area."""
    h, w = values.shape
    lat = np.radians(90 - (np.arange(h) + 0.5) * 180 / h)
    lon = np.radians((np.arange(w) + 0.5) * 360 / w - 180)
    mu = np.cos(lat)[:, None] * np.cos(lon)[None, :]  # cosine of the angle from (0, 0)
    weight = np.clip(mu, 0, None) * np.cos(lat)[:, None]
    weight = np.where(gap, 0, weight)
    return float(np.sum(values * weight) / np.sum(weight))


def calibrate() -> dict:
    manifest = json.loads(MANIFEST_PATH.read_text())
    folder = MANIFEST_PATH.parent
    decoded = np.array(Image.open(folder / manifest["texture"]["file"]).convert("L"))
    values = decoded / 255.0
    mask = manifest["texture"]["mask"]
    gap = (
        np.zeros(values.shape, dtype=bool)
        if mask is None
        else np.array(Image.open(folder / mask).convert("L")) > 0
    )
    mean = disc_weighted_mean(values, gap)
    manifest["calibration"] = {
        "geometricAlbedo": GEOMETRIC_ALBEDO,
        "source": SOURCE,
        "model": "Lommel-Seeliger, I/F = (w/4) mu0/(mu0+mu), w = albedoScale * texture value in [0, 1]",
        "method": "zero-phase disc mean of I/F equals the geometric albedo: albedoScale = 8p / mean(v), v weighted by projected area over the hemisphere facing longitude 0, latitude 0, gaps excluded",
        "discMeanTextureValue": round(mean, 6),
        "albedoScale": round(8 * GEOMETRIC_ALBEDO / mean, 6),
        "script": "pipeline/calibrate.py",
        # Mean of every decoded byte, gaps included. The capture harness compares the
        # browser's decode against it, so a colour-managed or resampled decode is caught.
        "decodedMean": round(float(decoded.mean()), 4),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    return manifest["calibration"]


if __name__ == "__main__":
    c = calibrate()
    print(f"disc mean texture value {c['discMeanTextureValue']}, albedo scale {c['albedoScale']}")
