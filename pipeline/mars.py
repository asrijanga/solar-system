"""Mars's albedo texture, a long-term average, from Mars Express OMEGA with TES in its gaps (SS-14 W3).

    npm run pipeline:mars

Python for the array maths on 100 million samples (CLAUDE.md, Stack).

Owner decisions, 2026-09-29 (docs/stories/SS-14.md): Mars is shown as a long-term average, not
the dust and clouds of one date, and its brightness is built from OMEGA, checked by TES, after
the side-by-side comparison (docs/stories/ss14-albedo-candidates.png).

Sources (docs/data/mars.md), both pinned by SHA-256 at first retrieval on 2026-09-29, their sizes
checked against their labels (neither publisher gives a checksum next to the file):
- OMEGA 1.08 um Lambert albedo R1080 (Ody et al. 2012; ESA PSA MEX-M-OMEGA-5-DDR-GLOBAL-MAPS-V1.0,
  ALBEDO_R1080_EQU_MAP). Label: I/F / cos(i) at 1.08 um "assuming a lambertian surface", each
  sample the average over January 2004 to August 2010; 7200 x 14400 LSB 16-bit, value =
  OFFSET + SCALING_FACTOR * DN, missing -32768; SIMPLE CYLINDRICAL, 40 px/deg, planetocentric,
  east-positive, line 1 centred at 89.9875 N and sample 1 at 179.9875 W (projection offsets
  3600.5 and 7200.5).
- TES bolometric albedo (Christensen; PDS MGS-M-TES-SPECIAL-V1, global_albedo_8ppd). Label: "the
  TES-derived bolometric albedo"; 1440 x 2880 PC_REAL; SIMPLE CYLINDRICAL, 8 px/deg,
  planetocentric, east-positive, projection offsets 720.5 and 1440.5. Each TES cell holds exactly
  5 x 5 OMEGA cells.

Where OMEGA has no value (2.9% of the map), a second measurement fills it (README, "Combine every
available source"): TES, scaled to OMEGA by the ratio of the two over the surrounding 5 x 5 deg
where both measured. The two are different quantities (1.08 um against bolometric), so the
scale is local, not global. The fill is checked by predicting OMEGA cells that were measured,
held out, and recorded in the manifest. Filled pixels keep TES's 7.4 km resolution: nothing
finer is invented. Which pixels were filled is in albedo-source.png.

The values stay OMEGA's 1.08 um Lambert albedo. Scaling to visible light, and colour, are the
next part of W3; the renderer does not use this texture yet.

Outputs in public/data/mars/, column 0 = longitude -180 deg (west edge), row 0 = latitude +90 deg:
- albedo.webp, 8192 x 4096, grey: byte = 255 sqrt(A / MAX_ALBEDO), area-averaged from 40 px/deg.
- albedo-source.png, 8192 x 4096, lossless: 0 where every source sample was OMEGA, else the
  share of the pixel filled from TES, 1-255.
- albedo.json, the manifest.
"""

from __future__ import annotations

import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

from download import CACHE, fetch, sha256
from moon import MAX_BYTES, MIN_PSNR_DB, psnr, pull_push_fill

OMEGA_URL = "https://archives.esac.esa.int/psa/ftp/MARS-EXPRESS/OMEGA/MEX-M-OMEGA-5-DDR-GLOBAL-MAPS-V1.0/DATA/ALBEDO/ALBEDO_R1080_EQU_MAP.IMG"
OMEGA_SHA256 = "3fc99ad4190ba509492e2d2435f561c37f87251a96d037b596526e45c801e9c5"
OMEGA_SHAPE = (7200, 14400)
OMEGA_OFFSET = 5.2414565669e-01
OMEGA_SCALE = 1.4522365285e-05
OMEGA_MISSING = -32768

TES_URL = "https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-special-v1/global_albedo_8ppd.img"
TES_SHA256 = "47ee17fc9aca6aa9fd5d49e383c1acc366d4cb31cab4635bc823bc27a33283c7"
TES_SHAPE = (1440, 2880)
CELL = 5  # OMEGA cells per TES cell, each way

# Albedo at byte 255: the OMEGA label's MAXIMUM, so nothing is clipped.
MAX_ALBEDO = 1.0
# The window over which TES is scaled to OMEGA, in TES cells (41 = 5.1 deg).
RATIO_WINDOW = 41
# Share of fully measured TES cells held out to check the fill; fixed seed.
HOLDOUT_FRACTION = 0.01
HOLDOUT_SEED = 14

WIDTH, HEIGHT = 8192, 4096
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "mars"


def omega() -> np.ndarray:
    path = fetch(OMEGA_URL, OMEGA_SHA256, "mars-omega-albedo-r1080.img")
    dn = np.fromfile(path, dtype="<i2").reshape(OMEGA_SHAPE)
    return np.where(dn == OMEGA_MISSING, np.nan, OMEGA_OFFSET + OMEGA_SCALE * dn.astype(np.float64))


def tes() -> np.ndarray:
    path = fetch(TES_URL, TES_SHA256, "mars-tes-albedo-8ppd.img")
    return np.fromfile(path, dtype="<f4").reshape(TES_SHAPE).astype(np.float64)


def box_mean(values: np.ndarray, size: int) -> np.ndarray:
    """NaN-aware mean over a size x size box, wrapping in longitude and clamped in latitude."""
    valid = np.isfinite(values)
    v = np.where(valid, values, 0.0)
    w = valid.astype(np.float64)
    half = size // 2

    def box(a: np.ndarray) -> np.ndarray:
        a = np.pad(a, ((half, half), (0, 0)), mode="constant")
        a = np.concatenate([a[:, -half:], a, a[:, :half]], axis=1)
        c = np.cumsum(np.cumsum(np.pad(a, ((1, 0), (1, 0))), axis=0), axis=1)
        return c[size:, size:] - c[:-size, size:] - c[size:, :-size] + c[:-size, :-size]

    total, count = box(v), box(w)
    return np.where(count > 0, total / np.maximum(count, 1), np.nan)


def local_ratio(omega_cells: np.ndarray, full: np.ndarray, t: np.ndarray) -> np.ndarray:
    """OMEGA / TES over the surrounding window, from TES cells OMEGA measured completely."""
    ratio = np.where(full, omega_cells / t, np.nan)
    smooth = box_mean(ratio, RATIO_WINDOW)
    return pull_push_fill(np.nan_to_num(smooth), np.isfinite(smooth))


def fill_check(omega_cells: np.ndarray, full: np.ndarray, t: np.ndarray) -> dict:
    """Predicts held-out, measured OMEGA cells from TES and the ratio of their surroundings."""
    rng = np.random.default_rng(HOLDOUT_SEED)
    held = full & (rng.random(full.shape) < HOLDOUT_FRACTION)
    ratio = local_ratio(omega_cells, full & ~held, t)
    predicted = t * ratio
    lat = 90 - (np.arange(TES_SHAPE[0]) + 0.5) / 8
    record = {
        "method": f"{HOLDOUT_FRACTION:.0%} of the TES cells OMEGA measured completely, chosen with seed {HOLDOUT_SEED}, removed from the ratio and predicted",
    }
    for name, zone in (("within60", np.abs(lat) <= 60), ("poleward60", np.abs(lat) > 60)):
        m = held & zone[:, None]
        p, a = predicted[m], omega_cells[m]
        relative = p / a - 1
        record[name] = {
            "cells": int(m.sum()),
            "correlation": round(float(np.corrcoef(p, a)[0, 1]), 4),
            "meanRelativeError": round(float(relative.mean()), 4),
            "rmsRelativeError": round(float(np.sqrt(np.mean(relative**2))), 4),
        }
    return record


def agreement(omega_cells: np.ndarray, full: np.ndarray, t: np.ndarray) -> dict:
    lat = 90 - (np.arange(TES_SHAPE[0]) + 0.5) / 8
    out = {}
    for limit in (60, 90):
        m = full & (np.abs(lat) <= limit)[:, None]
        x, y = t[m], omega_cells[m]
        out[f"withinLatitude{limit}"] = {
            "cells": int(m.sum()),
            "correlation": round(float(np.corrcoef(x, y)[0, 1]), 4),
            "throughZeroSlope": round(float(np.sum(x * y) / np.sum(x * x)), 4),
        }
    return out


def overlaps(n_in: int, n_out: int) -> tuple[np.ndarray, np.ndarray]:
    """For each output cell, the input cells it overlaps and their area weights (rows sum to 1)."""
    edges_in = np.arange(n_in + 1) / n_in
    per = int(math.ceil(n_in / n_out)) + 1
    index = np.zeros((n_out, per), dtype=np.int64)
    weight = np.zeros((n_out, per))
    for j in range(n_out):
        lo, hi = j / n_out, (j + 1) / n_out
        first = int(math.floor(lo * n_in))
        for k in range(per):
            i = first + k
            if i >= n_in:
                break
            index[j, k] = i
            weight[j, k] = max(0.0, min(hi, edges_in[i + 1]) - max(lo, edges_in[i]))
    return index, weight / weight.sum(axis=1, keepdims=True)


def area_average(values: np.ndarray, width: int, height: int) -> np.ndarray:
    """Exact area average of a global equirectangular grid onto a coarser one, rows then columns."""
    ri, rw = overlaps(values.shape[0], height)
    rows = sum(rw[:, k, None] * values[ri[:, k], :] for k in range(ri.shape[1]))
    ci, cw = overlaps(values.shape[1], width)
    return sum(cw[None, :, k] * rows[:, ci[:, k]] for k in range(ci.shape[1]))


def encode(a: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(255 * np.sqrt(np.clip(a, 0, MAX_ALBEDO) / MAX_ALBEDO)), 1, 255).astype(np.uint8)


def format_trials(master: np.ndarray) -> list[dict]:
    image = Image.fromarray(master, mode="L")
    results = []
    for options in [{"lossless": True, "method": 6}] + [{"quality": q, "method": 6} for q in (95, 90, 85, 80, 70)]:
        buffer = io.BytesIO()
        image.save(buffer, format="WEBP", **options)
        decoded = np.array(Image.open(io.BytesIO(buffer.getvalue())).convert("L"))
        p = psnr(master, decoded)
        results.append(
            {
                "format": "webp-lossless" if options.get("lossless") else f"webp-q{options['quality']}",
                "bytes": buffer.tell(),
                "psnrDb": None if math.isinf(p) else round(p, 2),
                "maxAbsError": int(np.abs(master.astype(int) - decoded.astype(int)).max()),
                "_data": buffer.getvalue(),
            }
        )
    return results


def choose(trials: list[dict]) -> dict:
    eligible = [t for t in trials if t["bytes"] <= MAX_BYTES and (t["psnrDb"] is None or t["psnrDb"] >= MIN_PSNR_DB)]
    if not eligible:
        raise RuntimeError("no encoding meets the size and quality rules; see the trials")
    return min(eligible, key=lambda t: t["bytes"])


def build() -> dict:
    a = omega()
    t = tes()
    if not np.all(np.isfinite(t)) or t.min() <= 0:
        raise RuntimeError("TES has missing or non-positive values: the fill would need another source")
    missing = ~np.isfinite(a)

    cells = a.reshape(TES_SHAPE[0], CELL, TES_SHAPE[1], CELL)
    count = np.sum(np.isfinite(cells), axis=(1, 3))
    full = count == CELL * CELL
    omega_cells = np.where(count > 0, np.nansum(cells, axis=(1, 3)) / np.maximum(count, 1), np.nan)

    ratio = local_ratio(omega_cells, full, t)
    filled_cells = np.repeat(np.repeat(t * ratio, CELL, axis=0), CELL, axis=1)
    albedo = np.where(missing, filled_cells, a)

    lat = 90 - (np.arange(OMEGA_SHAPE[0]) + 0.5) / 40
    bands = {}
    for north, south in ((90, 60), (60, 30), (30, 0), (0, -30), (-30, -60), (-60, -90)):
        r = (lat <= north) & (lat > south)
        bands[f"{north}..{south}"] = round(float(missing[r].mean()), 4)

    out_albedo = area_average(albedo, WIDTH, HEIGHT)
    out_source = area_average(missing.astype(np.float64), WIDTH, HEIGHT)
    master = encode(out_albedo)
    source = np.where(out_source > 0, np.clip(np.ceil(out_source * 255), 1, 255), 0).astype(np.uint8)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    trials = format_trials(master)
    chosen = choose(trials)
    albedo_out = OUT_DIR / "albedo.webp"
    albedo_out.write_bytes(chosen["_data"])
    source_out = OUT_DIR / "albedo-source.png"
    Image.fromarray(source, mode="L").save(source_out, optimize=True)

    manifest = {
        "product": {
            "name": "Mars Express OMEGA 1.08 um Lambert albedo R1080, Ody et al. (2012), ESA PSA MEX-M-OMEGA-5-DDR-GLOBAL-MAPS-V1.0",
            "url": OMEGA_URL,
            "sha256": OMEGA_SHA256,
            "quantity": "I/F / cos(i) at 1.08 um, assuming a Lambertian surface; each sample the average of observations from 2004-01-08 to 2010-08-20 (label)",
            "chosen": "owner, 2026-09-29: a long-term average, built from OMEGA checked by TES (docs/stories/SS-14.md)",
            "missingFraction": round(float(missing.mean()), 5),
            "missingFractionByLatitude": bands,
        },
        "gapFill": {
            "source": "MGS TES bolometric albedo, Christensen; PDS MGS-M-TES-SPECIAL-V1 global_albedo_8ppd",
            "url": TES_URL,
            "sha256": TES_SHA256,
            "method": f"TES x (OMEGA / TES) averaged over the surrounding {RATIO_WINDOW} x {RATIO_WINDOW} TES cells ({RATIO_WINDOW / 8:.1f} deg) that OMEGA measured completely; filled pixels keep TES's 7.4 km cells",
            "agreementWithOmega": agreement(omega_cells, full, t),
            "check": fill_check(omega_cells, full, t),
        },
        "conventions": {
            "projection": "equirectangular (simple cylindrical); both sources on a 3396.0 km sphere (labels)",
            "latitude": "planetocentric",
            "longitude": "east-positive; column 0 = -180 deg, last column ends at +180 deg",
            "rows": "row 0 = +90 deg latitude",
            "bodyFixedFrame": "IAU_MARS; see ephemeris.json",
            "values": f"OMEGA 1.08 um Lambert albedo, stored as byte = 255 sqrt(A / {MAX_ALBEDO}). Not yet scaled to visible light",
        },
        "texture": {
            "file": albedo_out.name,
            "width": WIDTH,
            "height": HEIGHT,
            "encoding": {"curve": "sqrt", "maxAlbedo": MAX_ALBEDO},
            "clippedPixels": int(np.sum(out_albedo > MAX_ALBEDO)),
            "kmPerPixelAtEquator": round(2 * math.pi * 3396.19 / WIDTH, 3),
            "sha256": sha256(albedo_out),
            "source": {
                "file": source_out.name,
                "values": "0 = every source sample OMEGA; 1-255 = the share of the pixel filled from TES, rounded up",
                "pixelsWithFill": int(np.sum(source > 0)),
                "sha256": sha256(source_out),
            },
            "gpuBytesR8WithMips": int(WIDTH * HEIGHT * 4 / 3),
        },
        "formatChoice": {
            "rule": f"smallest albedo at most {MAX_BYTES} bytes with PSNR >= {MIN_PSNR_DB} dB over all pixels (the Moon's rule)",
            "chosen": chosen["format"],
            "trials": [{k: v for k, v in tr.items() if k != "_data"} for tr in trials],
        },
    }
    (OUT_DIR / "albedo.json").write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    return manifest


if __name__ == "__main__":
    m = build()
    print(json.dumps({k: m[k] for k in ("product", "gapFill")}, indent=1))
    print(f"chose {m['formatChoice']['chosen']}; clipped {m['texture']['clippedPixels']}")
    for tr in m["formatChoice"]["trials"]:
        print(f"  {tr['format']:14} {tr['bytes'] / 1e6:6.2f} MB  PSNR {tr['psnrDb']}  max err {tr['maxAbsError']}")
