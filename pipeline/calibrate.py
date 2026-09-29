"""Absolute scale for the Moon's relative albedo map.

    npm run pipeline:calibrate

Neither Clementine label gives a reflectance scale (docs/stories/SS-5.md). Its values are
reflectance at one standard geometry, incidence 30, emission 0, phase 30 degrees ("R30",
Clementine UVVIS mosaic VOLINFO.HTM, section 8), up to an unknown factor. That factor comes
from LRO's Wide Angle Camera (docs/stories/SS-8b.md): Sato et al. (2014) fitted Hapke's model
to the WAC's calibrated I/F in every 1-degree tile, so each tile's I/F at the standard geometry
is known absolutely (tools/data/hapke.ts writes it into public/data/moon/hapke.bin).

The factor k is the least-squares fit, through zero, of

    I/F at the standard geometry (WAC, 566 nm)  =  k * mean texture value in the tile

over every tile the product covers (70N to 70S) with no never-imaged pixel in it. The fit is
recorded, with its correlation and residual, and the fit with an offset is reported beside it
but not used: an offset would add light that neither instrument measured. The renderer then
draws I/F = k v(x) * Hapke(i, e, g; tile) / Hapke(30, 0, 30; tile).

The 750 nm map supplies the pattern of relative albedo; the absolute scale is 566 nm, the WAC
band nearest the V band the display shows. Deterministic: CI re-runs it and diffs.
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
    means, gappy = tile_means(values, gap)
    first, last = MEASURED_ROWS
    use = ~gappy[first:last]
    x = means[first:last][use]
    y = standard_iof()[first:last][use]
    fit = fit_through_zero(x, y)
    manifest["calibration"] = {
        "model": "Hapke (src/core/hapke.ts): I/F = albedoScale * v * Hapke(i, e, g; tile) / Hapke(30, 0, 30; tile), v the texture value in [0, 1], tile parameters from public/data/moon/hapke.bin",
        "reference": "LRO WAC 566 nm Hapke parameter maps, Sato et al. (2014), doi:10.1002/2013JE004580: each tile's absolute I/F at Clementine's standard geometry i = 30, e = 0, g = 30",
        "method": "least squares through zero of the WAC I/F at the standard geometry against the mean texture value, per 1-degree tile, 70N to 70S, tiles with never-imaged pixels left out",
        "fit": {
            "tiles": int(x.size),
            "albedoScale": round(fit["k"], 6),
            "r": round(fit["r"], 4),
            "rmsResidual": round(fit["rmsResidual"], 6),
            "relativeRmsResidual": round(fit["relativeRmsResidual"], 4),
            "withOffsetNotUsed": {
                "slope": round(fit["withOffset"]["slope"], 6),
                "offset": round(fit["withOffset"]["offset"], 6),
            },
        },
        "albedoScale": round(fit["k"], 6),
        # The mean texture value over the disc facing (0, 0), weighted by projected area: never-
        # imaged pixels, if any, are shaded with it.
        "discMeanTextureValue": round(disc_weighted_mean(values, gap), 6),
        "script": "pipeline/calibrate.py",
        # Mean of every decoded byte, gaps included. The capture harness compares the
        # browser's decode against it, so a colour-managed or resampled decode is caught.
        "decodedMean": round(float(decoded.mean()), 4),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    return manifest["calibration"]


if __name__ == "__main__":
    c = calibrate()
    f = c["fit"]
    print(f"albedo scale {c['albedoScale']} over {f['tiles']} tiles, r {f['r']}, relative rms {f['relativeRmsResidual']}")
