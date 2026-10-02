"""Mars's measured near-infrared albedo, OMEGA with TES in its gaps (SS-14 W3 part 1), for
pipeline/mars.py, which takes its large-scale light and dark from it.

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
finer is invented here (pipeline/mars.py takes the edges within them from HRSC). Which pixels
were filled is in albedo-source.png.

The values stay OMEGA's 1.08 um Lambert albedo. pipeline/mars.py writes the outputs: this
module only measures, fills and checks.
"""

from __future__ import annotations

import math

import numpy as np

from download import fetch
from moon import pull_push_fill

OMEGA_URL = "https://archives.esac.esa.int/psa/ftp/MARS-EXPRESS/OMEGA/MEX-M-OMEGA-5-DDR-GLOBAL-MAPS-V1.0/DATA/ALBEDO/ALBEDO_R1080_EQU_MAP.IMG"
OMEGA_SHA256 = "3fc99ad4190ba509492e2d2435f561c37f87251a96d037b596526e45c801e9c5"
OMEGA_SHAPE = (7200, 14400)
OMEGA_OFFSET = 5.2414565669e-01
OMEGA_SCALE = 1.4522365285e-05
OMEGA_MISSING = -32768

TES_URL = (
    "https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-special-v1/global_albedo_8ppd.img"
)
TES_SHA256 = "47ee17fc9aca6aa9fd5d49e383c1acc366d4cb31cab4635bc823bc27a33283c7"
TES_SHAPE = (1440, 2880)
CELL = 5  # OMEGA cells per TES cell, each way

# The window over which TES is scaled to OMEGA, in TES cells (41 = 5.1 deg).
RATIO_WINDOW = 41
# Share of fully measured TES cells held out to check the fill; fixed seed.
HOLDOUT_FRACTION = 0.01
HOLDOUT_SEED = 14


def omega() -> np.ndarray:
    path = fetch(OMEGA_URL, OMEGA_SHA256, "mars-omega-albedo-r1080.img")
    dn = np.fromfile(path, dtype="<i2").reshape(OMEGA_SHAPE)
    return np.where(
        dn == OMEGA_MISSING, np.nan, OMEGA_OFFSET + OMEGA_SCALE * dn.astype(np.float64)
    )


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
    for name, zone in (
        ("within60", np.abs(lat) <= 60),
        ("poleward60", np.abs(lat) > 60),
    ):
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


def filled_albedo(width: int, height: int) -> tuple[np.ndarray, np.ndarray, dict]:
    """OMEGA's albedo with its gaps filled from TES, area-averaged onto a width x height grid; the
    share of each pixel that came from TES; and the record of the fill and its check."""
    a = omega()
    t = tes()
    if not np.all(np.isfinite(t)) or t.min() <= 0:
        raise RuntimeError(
            "TES has missing or non-positive values: the fill would need another source"
        )
    missing = ~np.isfinite(a)

    cells = a.reshape(TES_SHAPE[0], CELL, TES_SHAPE[1], CELL)
    count = np.sum(np.isfinite(cells), axis=(1, 3))
    full = count == CELL * CELL
    omega_cells = np.where(
        count > 0, np.nansum(cells, axis=(1, 3)) / np.maximum(count, 1), np.nan
    )

    ratio = local_ratio(omega_cells, full, t)
    filled_cells = np.repeat(np.repeat(t * ratio, CELL, axis=0), CELL, axis=1)
    albedo = np.where(missing, filled_cells, a)

    lat = 90 - (np.arange(OMEGA_SHAPE[0]) + 0.5) / 40
    bands = {}
    for north, south in ((90, 60), (60, 30), (30, 0), (0, -30), (-30, -60), (-60, -90)):
        r = (lat <= north) & (lat > south)
        bands[f"{north}..{south}"] = round(float(missing[r].mean()), 4)
    record = {
        "omega": {
            "name": "Mars Express OMEGA 1.08 um Lambert albedo R1080, Ody et al. (2012), ESA PSA MEX-M-OMEGA-5-DDR-GLOBAL-MAPS-V1.0",
            "url": OMEGA_URL,
            "sha256": OMEGA_SHA256,
            "quantity": "I/F / cos(i) at 1.08 um, assuming a Lambertian surface; each sample the average of observations from 2004-01-08 to 2010-08-20 (label)",
            "missingFraction": round(float(missing.mean()), 5),
            "missingFractionByLatitude": bands,
        },
        "gapFill": {
            "source": "MGS TES bolometric albedo, Christensen; PDS MGS-M-TES-SPECIAL-V1 global_albedo_8ppd",
            "url": TES_URL,
            "sha256": TES_SHA256,
            "method": f"TES x (OMEGA / TES) averaged over the surrounding {RATIO_WINDOW} x {RATIO_WINDOW} TES cells ({RATIO_WINDOW / 8:.1f} deg) that OMEGA measured completely",
            "agreementWithOmega": agreement(omega_cells, full, t),
            "check": fill_check(omega_cells, full, t),
        },
    }
    return (
        area_average(albedo, width, height),
        area_average(missing.astype(np.float64), width, height),
        record,
    )
