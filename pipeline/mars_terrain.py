"""Mars's relief for the website: MOLA laser altimetry with HRSC stereo between its tracks
(SS-14 W4, docs/stories/SS-14.md).

    npm run pipeline:mars:terrain

Python for GDAL's reprojection of 1,370 sinusoidal strips and the array maths on 265 million
samples (CLAUDE.md, Stack).

Owner decisions, 2026-10-02: Mars's tiles go to a data repository of its own at 1.3 km ("Own
data repo, 1.3 km"); the composite of this file, with a strip left out when its fit to MOLA is
more than 3x the median RMS ("Approve, 3x median RMS").

Sources (docs/data/mars.md), all heights above the same areoid, MOLA's GMM3 (mgm1025) to degree
and order 50:
- MOLA MEGDR at 64 px/deg (PDS MGS-M-MOLA-5-MEGDR-L3-V1.0, meg064): four tiles each of
  megt (median topography, MSB 16-bit metres), megc (shots per bin, 8-bit) and megr (radius,
  metres + 3396000). From the labels: SIMPLE CYLINDRICAL on a 3396.0 km sphere,
  planetocentric, east-positive, pixel-registered; "Where no observations lie within the area,
  an interpolated value is supplied."
- HRSC DTMs (PDS MEX-M-HRSC-5-REFDR-DTM-V1.0, volume mexhrs_2001 of 2016-10-28): every DA4
  strip, "Height above equipotential surface described by potential model GMM3 (PDS dataset
  MGS-M-MOLA-5-MEGDR-L3-V1.0)", 16-bit metres, missing -32768, SINUSOIDAL on a 3396.0 km sphere.
  Each is verified against the volume's MD5 list and pinned by SHA-256 in
  pipeline/hrsc_dtm_sources.json.

The composite, at MOLA's 64 px/deg (0.93 km), best source first:
1. HRSC: each strip is averaged onto the grid, registered to MOLA by one height offset (the
   median of MOLA minus HRSC over the bins with laser shots inside it) and, where strips overlap,
   their median is taken. A strip whose fit RMS is more than REJECT_RMS_FACTOR times the median
   over all strips is left out. Every fit is recorded.
2. MOLA where it has shots in the bin (megc > 0).
3. MOLA's own interpolation between tracks, where nothing measured: allowed (SS-10), and marked.
HRSC fades into MOLA across BLEND_KM inside the edge of the HRSC coverage.

Outputs:
- pipeline/.cache/mars-terrain-64.img: the composite heights, little-endian int16 metres above
  the areoid, 23040 x 11520, column 0 = -180 deg, row 0 = +90 deg; and
  mars-terrain-64-areoid.img, the areoid radius in metres (int32), on the same grid. Too large
  to commit; the tile build reads them.
- public/data/mars/terrain-source.png: provenance at 16 px/deg, the share of each pixel from
  HRSC (red), MOLA measured (green) and MOLA interpolated (blue).
- public/data/mars/terrain.json: the manifest, with every strip's fit.
"""

from __future__ import annotations

import json
import math
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject
from scipy.ndimage import distance_transform_edt

from download import CACHE, fetch, sha256

PPD = 64
WIDTH, HEIGHT = 360 * PPD, 180 * PPD
SPHERE_M = 3396000.0
KM_PER_PIXEL = 2 * math.pi * SPHERE_M / 1000 / WIDTH
BLEND_KM = 5.0
REJECT_RMS_FACTOR = 3.0
BAND_ROWS = 256

MOLA_BASE = (
    "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg064/"
)
MOLA_TILES = ("90n000", "90n180", "00n000", "00n180")
HRSC_BASE = (
    "https://pds-geosciences.wustl.edu/mex/mex-m-hrsc-5-refdr-dtm-v1/mexhrs_2001/"
)
HRSC_MD5_LIST = "https://pds-geosciences.wustl.edu/mex/mex-m-hrsc-5-refdr-dtm-v1/mexhrs_2001_161028.md5"

ROOT = Path(__file__).resolve().parent.parent
SOURCES = Path(__file__).resolve().parent / "hrsc_dtm_sources.json"
MOLA_SOURCES = Path(__file__).resolve().parent / "mola64_sources.json"
OUT_DIR = ROOT / "public" / "data" / "mars"
WARPED = CACHE / "hrscdtm-warped"


def mola(product: str) -> np.ndarray:
    """One MEGDR product as a global grid, column 0 = 0 E (as the tiles), row 0 = +90."""
    pinned = json.loads(MOLA_SOURCES.read_text())["files"]
    dtype = {"megt": ">i2", "megr": ">i2", "megc": "u1"}[product]
    rows = []
    for half in (MOLA_TILES[:2], MOLA_TILES[2:]):
        tiles = []
        for t in half:
            name = f"{product}{t}gb.img"
            path = fetch(MOLA_BASE + name, pinned[name], f"mola64/{name}")
            tiles.append(
                np.fromfile(path, dtype=dtype).reshape(HEIGHT // 2, WIDTH // 2)
            )
        rows.append(np.concatenate(tiles, axis=1))
    return np.concatenate(rows, axis=0)


def strip_list() -> dict:
    return json.loads(SOURCES.read_text())


def label_bounds(path: Path) -> tuple[float, float, float, float]:
    """West, east (0..360, east may exceed 360 across 0 E), south, north, from the label."""
    head = path.open("rb").read(65536).decode("latin-1")
    value = {
        k: float(re.search(rf"\b{k}\s*=\s*([-0-9.eE+]+)", head).group(1))
        for k in (
            "WESTERNMOST_LONGITUDE",
            "EASTERNMOST_LONGITUDE",
            "MINIMUM_LATITUDE",
            "MAXIMUM_LATITUDE",
        )
    }
    west, east = (
        value["WESTERNMOST_LONGITUDE"] % 360,
        value["EASTERNMOST_LONGITUDE"] % 360,
    )
    if east < west:
        east += 360
    return west, east, value["MINIMUM_LATITUDE"], value["MAXIMUM_LATITUDE"]


def warp_strip(path: Path) -> tuple[int, int, np.ndarray]:
    """The strip area-averaged onto the 64 px/deg grid: (first row, first column, values), the
    column possibly past the grid's east edge, to be taken modulo WIDTH."""
    west, east, south, north = label_bounds(path)
    c0, c1 = math.floor(west * PPD) - 2, math.ceil(east * PPD) + 2
    if (
        c1 - c0 >= WIDTH
    ):  # a strip around a pole: one turn of longitude, no column twice
        c0, c1 = 0, WIDTH
    r0, r1 = (
        max(0, math.floor((90 - north) * PPD) - 2),
        min(HEIGHT, math.ceil((90 - south) * PPD) + 2),
    )
    centre = (c0 + c1) / 2 / PPD
    # Longitudes continuous across the strip, wherever it is: wrapped around its own centre.
    crs = CRS.from_proj4(f"+proj=longlat +R={SPHERE_M} +lon_wrap={centre} +no_defs")
    out = np.full((r1 - r0, c1 - c0), np.nan, dtype=np.float32)
    with rasterio.open(path) as src:
        reproject(
            rasterio.band(src, 1),
            out,
            dst_transform=from_bounds(
                c0 / PPD, 90 - r1 / PPD, c1 / PPD, 90 - r0 / PPD, c1 - c0, r1 - r0
            ),
            dst_crs=crs,
            src_nodata=src.nodata,
            dst_nodata=np.nan,
            resampling=Resampling.average,
        )
    return r0, c0, out


def window(grid: np.ndarray, r0: int, c0: int, shape: tuple[int, int]) -> np.ndarray:
    cols = np.arange(c0, c0 + shape[1]) % WIDTH
    return grid[r0 : r0 + shape[0]][:, cols]


def process(name: str, entry: dict, topo: np.ndarray, counts: np.ndarray) -> dict:
    """Downloads one strip, warps it, fits it to MOLA, keeps the warped grid, deletes the file.
    The fit carries the file's SHA-256 and size, for pinning."""
    target = WARPED / (name + ".npz")
    if target.exists():
        return json.loads(str(np.load(target)["fit"]))
    path = fetch(
        HRSC_BASE + entry["path"],
        entry.get("sha256"),
        f"hrscdtm/{name}.img",
        md5=entry["md5"],
    )
    pin = {"sha256": sha256(path), "bytes": path.stat().st_size}
    r0, c0, h = warp_strip(path)
    t = window(topo, r0, c0, h.shape).astype(np.float64)
    c = window(counts, r0, c0, h.shape)
    shots = np.isfinite(h) & (c > 0)
    fit = {
        **pin,
        "row": r0,
        "col": c0,
        "cells": int(np.isfinite(h).sum()),
        "cellsWithShots": int(shots.sum()),
    }
    if shots.sum() > 0:
        d = t[shots] - h[shots]
        offset = float(np.median(d))
        fit["offsetM"] = round(offset, 2)
        fit["rmsM"] = round(float(np.sqrt(np.mean((d - offset) ** 2))), 2)
    WARPED.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(target, h=h, fit=json.dumps(fit))
    path.unlink()
    return fit


def combine(names: list[str], fits: dict, height: int) -> tuple[np.ndarray, dict]:
    """The median of the registered strips in every bin they cover (NaN where none does)."""
    out = np.full((height, WIDTH), np.nan, dtype=np.float32)
    spreads = []
    strips = []
    for name in names:
        z = np.load(WARPED / (name + ".npz"))
        f = fits[name]
        strips.append((f["row"], f["col"], z["h"] + np.float32(f["offsetM"])))
    for b0 in range(0, height, BAND_ROWS):
        b1 = min(height, b0 + BAND_ROWS)
        idx, val = [], []
        for r0, c0, h in strips:
            lo, hi = max(r0, b0), min(r0 + h.shape[0], b1)
            if lo >= hi:
                continue
            part = h[lo - r0 : hi - r0]
            rr, cc = np.nonzero(np.isfinite(part))
            idx.append((rr + lo - b0) * WIDTH + (cc + c0) % WIDTH)
            val.append(part[rr, cc])
        if not idx:
            continue
        i, v = np.concatenate(idx), np.concatenate(val)
        order = np.lexsort((v, i))
        i, v = i[order], v[order]
        cells, start, n = np.unique(i, return_index=True, return_counts=True)
        median = np.where(
            n % 2 == 1,
            v[start + n // 2],
            0.5 * (v[start + np.maximum(n // 2 - 1, 0)] + v[start + n // 2]),
        )
        band = out[b0:b1].reshape(-1)
        band[cells] = median
        many = n > 1
        spreads.append((v[start + n - 1] - v[start])[many])
    s = np.concatenate(spreads) if spreads else np.zeros(0)
    return out, {
        "binsWithTwoOrMoreStrips": int(s.size),
        "spreadM": {
            "median": round(float(np.median(s)), 1),
            "p95": round(float(np.percentile(s, 95)), 1),
        }
        if s.size
        else None,
    }


def blend_weight(hrsc: np.ndarray) -> np.ndarray:
    """1 deep inside HRSC coverage, falling linearly to 0 at its edge across BLEND_KM, by the
    distance on the sphere to the nearest bin HRSC does not cover."""
    covered = np.isfinite(hrsc)
    weight = np.zeros(covered.shape, dtype=np.float32)
    margin = math.ceil(BLEND_KM / KM_PER_PIXEL) + 2
    for b0 in range(0, HEIGHT, PPD):
        b1 = min(HEIGHT, b0 + PPD)
        r0, r1 = max(0, b0 - margin), min(HEIGHT, b1 + margin)
        lat = math.radians(90 - (b0 + b1) / 2 / PPD)
        dx = max(KM_PER_PIXEL * math.cos(lat), 1e-3)
        pad = min(WIDTH // 2, math.ceil(BLEND_KM / dx) + 2)
        block = covered[r0:r1]
        if not block.any():
            continue
        wrapped = np.concatenate([block[:, -pad:], block, block[:, :pad]], axis=1)
        dist = distance_transform_edt(wrapped, sampling=(KM_PER_PIXEL, dx))[
            b0 - r0 : b1 - r0, pad:-pad
        ]
        weight[b0:b1] = np.clip(dist / BLEND_KM, 0, 1)
    return weight


def provenance_png(weight: np.ndarray, counts: np.ndarray, path: Path) -> dict:
    measured = (counts > 0).astype(np.float32)
    shares = [weight, (1 - weight) * measured, (1 - weight) * (1 - measured)]
    k = 4
    rgb = np.stack(
        [
            np.rint(255 * s.reshape(HEIGHT // k, k, WIDTH // k, k).mean(axis=(1, 3)))
            for s in shares
        ],
        axis=-1,
    ).astype(np.uint8)
    Image.fromarray(rgb, mode="RGB").save(path, optimize=True)
    lat = np.radians(90 - (np.arange(HEIGHT) + 0.5) / PPD)
    area = np.cos(lat)[:, None] / np.cos(lat).sum() / WIDTH
    return {
        name: round(float((s * area).sum()), 4)
        for name, s in zip(("hrsc", "molaMeasured", "molaInterpolated"), shares)
    }


BLEND_URL = "/vsicurl/https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"


def checks() -> dict:
    """The composite against MOLA's measured bins and against the USGS HRSC-MOLA blend (an
    independent combination of nearly the same HRSC strips), read from the written outputs."""
    roll = lambda a: np.roll(a, -WIDTH // 2, axis=1)  # noqa: E731
    out = np.fromfile(CACHE / "mars-terrain-64.img", dtype="<i2").reshape(HEIGHT, WIDTH)
    topo = roll(mola("megt"))
    shots = roll(mola("megc")) > 0
    source = np.array(Image.open(OUT_DIR / "terrain-source.png"))
    # The provenance is at 16 px/deg; HRSC's share of each 4 x 4 block.
    hrsc = np.repeat(np.repeat(source[:, :, 0], 4, axis=0), 4, axis=1)
    record = {}
    for name, zone in (("outsideHrsc", hrsc == 0), ("insideHrsc", hrsc == 255)):
        m = shots & zone
        d = out[m].astype(np.float64) - topo[m]
        record[f"molaMeasuredBins.{name}"] = {
            "bins": int(m.sum()),
            "medianM": round(float(np.median(d)), 2),
            "rmsM": round(float(np.sqrt(np.mean(d**2))), 2),
            "maxAbsM": int(np.abs(d).max()),
        }
    k = PPD // 16
    coarse = (
        out.astype(np.float64).reshape(HEIGHT // k, k, WIDTH // k, k).mean(axis=(1, 3))
    )
    with rasterio.open(BLEND_URL) as src:
        blend = src.read(
            1, out_shape=coarse.shape, resampling=Resampling.average, masked=True
        )
    blend = blend.astype(np.float64).filled(np.nan)
    hrsc16 = source[:, :, 0]
    for name, zone in (
        ("everywhere", np.ones_like(hrsc16, dtype=bool)),
        ("insideHrsc", hrsc16 == 255),
        ("outsideHrsc", hrsc16 == 0),
    ):
        m = zone & np.isfinite(blend)
        d = coarse[m] - blend[m]
        record[f"usgsBlend16ppd.{name}"] = {
            "pixels": int(m.sum()),
            "medianM": round(float(np.median(d)), 1),
            "rmsM": round(float(np.sqrt(np.mean(d**2))), 1),
            "p99AbsM": round(float(np.percentile(np.abs(d), 99)), 1),
        }
    for name, f in (("max", np.argmax), ("min", np.argmin)):
        r, c = np.unravel_index(f(out), out.shape)
        record[f"{name}Height"] = {
            "m": int(out[r, c]),
            "latDeg": round(90 - (r + 0.5) / PPD, 3),
            "lonDeg": round((c + 0.5) / PPD - 180, 3),
        }
    return record


def build() -> dict:
    topo = mola("megt")
    counts = mola("megc")
    listing = strip_list()
    entries = listing["strips"]
    names = sorted(entries)
    fits: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for k, (name, fit) in enumerate(
            zip(names, pool.map(lambda n: process(n, entries[n], topo, counts), names))
        ):
            pin = {"sha256": fit.pop("sha256"), "bytes": fit.pop("bytes")}
            if entries[name].get("sha256") not in (None, pin["sha256"]):
                raise RuntimeError(f"{name}: SHA-256 differs from its pin")
            entries[name].update(pin)
            fits[name] = fit
            if k % 50 == 0:
                print(f"{k + 1}/{len(names)} {name}: {fit}", flush=True)
                SOURCES.write_text(json.dumps(listing, indent=1) + "\n")
    SOURCES.write_text(json.dumps(listing, indent=1) + "\n")

    fitted = [n for n in names if "rmsM" in fits[n]]
    median_rms = float(np.median([fits[n]["rmsM"] for n in fitted]))
    used = [n for n in fitted if fits[n]["rmsM"] <= REJECT_RMS_FACTOR * median_rms]
    left_out = {n: fits[n] for n in names if n not in used}
    print(
        f"{len(used)} strips used, {len(left_out)} left out; median fit RMS {median_rms:.1f} m",
        flush=True,
    )

    hrsc, overlap = combine(used, fits, HEIGHT)
    weight = blend_weight(hrsc)
    composite = np.where(
        weight > 0, weight * np.nan_to_num(hrsc) + (1 - weight) * topo, topo
    )
    radius = mola("megr").astype(np.int32) + 3396000
    areoid = radius - topo.astype(np.int32)

    # Column 0 at -180 deg, like every other Mars product here.
    roll = lambda a: np.roll(a, -WIDTH // 2, axis=1)  # noqa: E731
    out = roll(np.rint(composite)).astype("<i2")
    out.tofile(CACHE / "mars-terrain-64.img")
    roll(areoid).astype("<i4").tofile(CACHE / "mars-terrain-64-areoid.img")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    source_png = OUT_DIR / "terrain-source.png"
    shares = provenance_png(roll(weight), roll(counts), source_png)

    manifest = {
        "story": "docs/stories/SS-14.md, W4",
        "grid": {
            "pixelsPerDegree": PPD,
            "width": WIDTH,
            "height": HEIGHT,
            "kmPerPixelAtEquator": round(KM_PER_PIXEL, 4),
            "columns": "column 0 = -180 deg, east-positive; row 0 = +90 deg; pixel-registered",
            "latitude": "planetocentric",
            "heights": "metres above MOLA's areoid (GMM3 mgm1025 to degree and order 50); radius = areoid + height",
        },
        "sources": {
            "mola": {
                "product": "MGS-M-MOLA-5-MEGDR-L3-V1.0 meg064 megt, megc, megr",
                "base": MOLA_BASE,
                "files": "pipeline/mola64_sources.json",
            },
            "hrsc": {
                "product": "MEX-M-HRSC-5-REFDR-DTM-V1.0 mexhrs_2001 (2016-10-28), DA4",
                "base": HRSC_BASE,
                "files": "pipeline/hrsc_dtm_sources.json",
                "licence": "ESA/DLR/FU Berlin (CC BY-SA 3.0 IGO)",
            },
        },
        "composite": {
            "order": [
                "HRSC stereo, median of registered strips",
                "MOLA where it has laser shots in the bin",
                "MOLA's interpolation between tracks",
            ],
            "blendKm": BLEND_KM,
            "registration": "one height offset per strip: the median of MOLA minus HRSC over the bins with shots inside it",
            "rejection": f"fit RMS more than {REJECT_RMS_FACTOR} x the median over all strips (owner, 2026-10-02)",
            "stripsUsed": len(used),
            "medianFitRmsM": round(median_rms, 2),
            "offsetsM": {
                q: round(float(np.percentile([fits[n]["offsetM"] for n in used], p)), 1)
                for q, p in (("p5", 5), ("median", 50), ("p95", 95))
            },
            "overlap": overlap,
            "leftOut": left_out,
            "areaShares": shares,
            "extremesM": {"max": int(out.max()), "min": int(out.min())},
        },
        "provenance": {
            "file": source_png.name,
            "pixelsPerDegree": PPD // 4,
            "channels": "red = HRSC, green = MOLA measured, blue = MOLA interpolated; each the share of the pixel, 0-255",
            "sha256": sha256(source_png),
        },
        "fits": fits,
    }
    (OUT_DIR / "terrain.json").write_text(
        json.dumps(manifest, indent=1, allow_nan=False) + "\n"
    )
    manifest["checks"] = checks()
    (OUT_DIR / "terrain.json").write_text(
        json.dumps(manifest, indent=1, allow_nan=False) + "\n"
    )
    return manifest


if __name__ == "__main__":
    if sys.argv[1:] == ["--checks"]:
        path = OUT_DIR / "terrain.json"
        m = json.loads(path.read_text())
        m["checks"] = checks()
        path.write_text(json.dumps(m, indent=1, allow_nan=False) + "\n")
        print(json.dumps(m["checks"], indent=1))
        sys.exit()
    m = build()
    c = m["composite"]
    print(
        json.dumps(
            {
                k: c[k]
                for k in (
                    "stripsUsed",
                    "medianFitRmsM",
                    "offsetsM",
                    "overlap",
                    "areaShares",
                    "extremesM",
                )
            },
            indent=1,
        )
    )
    print(f"left out: {sorted(c['leftOut'])}", file=sys.stderr)
