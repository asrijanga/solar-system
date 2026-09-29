"""The Moon's albedo map against LRO's Hapke parameter maps: a consistency record.

    npm run pipeline:calibrate

Since SS-5b the map is LRO WAC's Hapke-normalised mosaic (moon.py), absolute I/F at the
standard geometry i = g = 60 deg, e = 0. No scale is fitted: the renderer draws
I/F = map I/F * Hapke(i, e, g; tile) / Hapke(60, 0, 60; tile) with the tile's parameters from
public/data/moon/hapke.bin (docs/stories/SS-8b.md, SS-5b.md).

The mosaic and the parameter maps come from the same WAC observations (Sato et al. 2014), so
each 1-degree tile's mean map I/F should equal the I/F its Hapke parameters give at the
standard geometry. This script measures that, per tile over 70 N to 70 S: the slope through
zero, the correlation and the residual are recorded. It is how a mistake in reading, placing
or encoding either product would show: a flipped or shifted map, or a wrong scale, spoils the
agreement. Deterministic: CI re-runs it and diffs.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "public/data/moon/albedo.json"
HAPKE_PATH = ROOT / "public/data/moon/hapke.json"
# Rows of hapke.bin the WAC product covers: 70N to 70S.
MEASURED_ROWS = (20, 160)


def disc_weighted_mean(values: np.ndarray, gap: np.ndarray) -> float:
    """Mean of values over the hemisphere facing (0, 0), weighted by projected area."""
    h, w = values.shape
    lat = np.radians(90 - (np.arange(h) + 0.5) * 180 / h)
    lon = np.radians((np.arange(w) + 0.5) * 360 / w - 180)
    mu = np.cos(lat)[:, None] * np.cos(lon)[None, :]  # cosine of the angle from (0, 0)
    weight = np.clip(mu, 0, None) * np.cos(lat)[:, None]
    weight = np.where(gap, 0, weight)
    return float(np.sum(values * weight) / np.sum(weight))


def tile_means(values: np.ndarray, gap: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Mean texture value per 1-degree tile, rows 90N to 90S, columns 0E to 360E, and whether
    the tile holds any gap. The texture's column 0 is at -180; each pixel goes to the tile its
    centre falls in."""
    h, w = values.shape
    lat = 90 - (np.arange(h) + 0.5) * 180 / h
    lon = ((np.arange(w) + 0.5) * 360 / w - 180) % 360
    row = np.minimum(np.floor(90 - lat).astype(int), 179)
    col = np.floor(lon).astype(int) % 360
    index = (row[:, None] * 360 + col[None, :]).ravel()
    total = np.bincount(index, weights=values.ravel(), minlength=180 * 360)
    count = np.bincount(index, minlength=180 * 360)
    gaps = np.bincount(index, weights=gap.ravel().astype(float), minlength=180 * 360)
    return (total / count).reshape(180, 360), (gaps > 0).reshape(180, 360)


def fit_through_zero(x: np.ndarray, y: np.ndarray) -> dict:
    """y = k x by least squares, with the statistics recorded beside it."""
    k = float(x @ y / (x @ x))
    residual = y - k * x
    slope, offset = np.polyfit(x, y, 1)
    return {
        "k": k,
        "r": float(np.corrcoef(x, y)[0, 1]),
        "rmsResidual": float(np.sqrt(np.mean(residual**2))),
        "relativeRmsResidual": float(np.sqrt(np.mean(residual**2)) / np.mean(y)),
        "withOffset": {"slope": float(slope), "offset": float(offset)},
    }


def standard_iof() -> np.ndarray:
    """I/F at Clementine's standard geometry per texel of hapke.bin: its RG texture's G."""
    hapke = json.loads(HAPKE_PATH.read_text())
    tex = hapke["texture"]
    w, h = tex["width"], tex["height"]
    halves = np.fromfile(HAPKE_PATH.parent / tex["file"], dtype="<f2")
    rg = halves[w * h * 4 :].reshape(h, w, 2)
    return rg[:, :, 1].astype(np.float64)


def decode(manifest: dict, decoded: np.ndarray) -> np.ndarray:
    """The texture's bytes as I/F (moon.py: byte = 255 sqrt(I/F / maxIOverF))."""
    encoding = manifest["texture"]["encoding"]
    if encoding["curve"] != "sqrt":
        raise RuntimeError(f"unknown encoding {encoding}")
    return encoding["maxIOverF"] * (decoded / 255.0) ** 2


def calibrate() -> dict:
    manifest = json.loads(MANIFEST_PATH.read_text())
    folder = MANIFEST_PATH.parent
    decoded = np.array(Image.open(folder / manifest["texture"]["file"]).convert("L"))
    iof = decode(manifest, decoded.astype(np.float64))
    gap = np.zeros(iof.shape, dtype=bool)
    means, gappy = tile_means(iof, gap)
    first, last = MEASURED_ROWS
    use = ~gappy[first:last]
    x = standard_iof()[first:last][use]
    y = means[first:last][use]
    fit = fit_through_zero(x, y)
    manifest["calibration"] = {
        "model": "I/F = map I/F at i = g = 60, e = 0, times Hapke(i, e, g; tile) / Hapke(60, 0, 60; tile), tile parameters from public/data/moon/hapke.bin; no scale fitted",
        "consistency": {
            "what": "per 1-degree tile, 70 N to 70 S: mean map I/F against the I/F the tile's Hapke parameters give at the standard geometry",
            "tiles": int(x.size),
            "slopeThroughZero": round(fit["k"], 4),
            "r": round(fit["r"], 4),
            "relativeRmsResidual": round(fit["relativeRmsResidual"], 4),
        },
        # Mean I/F over the disc facing (0, 0), weighted by projected area.
        "discMeanIOverF": round(disc_weighted_mean(iof, gap), 6),
        "script": "pipeline/calibrate.py",
        # Mean of every decoded byte. The capture harness compares the browser's decode
        # against it, so a colour-managed or resampled decode is caught.
        "decodedMean": round(float(decoded.mean()), 4),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    return manifest["calibration"]


if __name__ == "__main__":
    c = calibrate()["consistency"]
    print(f"map against parameters over {c['tiles']} tiles: slope {c['slopeThroughZero']}, r {c['r']}, relative rms {c['relativeRmsResidual']}")
