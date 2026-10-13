"""The colour check of SS-16 W7: does a straight line from 430 to 750 nm predict Mercury's measured
reflectance between them?

    npm run pipeline:mercury:colour-check

Mercury's page draws colour from MD3's three bands, 430, 750 and 1000 nm (docs/stories/SS-16.md,
W3), joining them with straight lines (core/moonColour.ts colourWeights): no MD3 band lies between
430 and 750 nm, where the eye's green and most of its red are. MDR measured five bands there, 430,
480, 560, 630 and 750 nm (its label's BAND_NAME), from the same camera with the same normalisation.
So within MDR alone, at every pixel where all five were measured, the straight line through its own
430 and 750 nm values is compared with what it measured at 480, 560 and 630 nm.

Region by region: each of MDR's 55 tiles (a quarter of an H-quadrangle, or a polar cap) is a
region; the pixel ratios measured / line are summarised per tile and over all pixels.

Python for the array maths on about 10 GB of tiles, streamed (pipeline/mercury_tiles.py). Too large
for CI: the record is committed, public/data/mercury/colour-check.json.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

import mercury_tiles as tiles

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "mercury" / "colour-check.json"
BANDS_NM = (430, 480, 560, 630, 750)
CHECKED_NM = (480, 560, 630)


def line(r430: np.ndarray, r750: np.ndarray, nm: float) -> np.ndarray:
    return r430 + (r750 - r430) * (nm - 430) / (750 - 430)


def summary(ratios: np.ndarray) -> dict:
    p = np.percentile(ratios, [5, 25, 50, 75, 95])
    return {
        "median": round(float(p[2]), 4),
        "p5": round(float(p[0]), 4),
        "p25": round(float(p[1]), 4),
        "p75": round(float(p[3]), 4),
        "p95": round(float(p[4]), 4),
    }


def main() -> dict:
    per_tile = []
    pooled: dict[int, list[np.ndarray]] = {nm: [] for nm in CHECKED_NM}
    for entry in tiles.SOURCES["mdr"]:
        t = tiles.reduce_tile("mdrvis", entry)
        bands = t["bands"].astype(np.float64)
        ok = np.all(np.isfinite(bands), axis=0)
        if ok.sum() < 1000:
            continue
        r = {nm: bands[k][ok] for k, nm in enumerate(BANDS_NM)}
        record = {"tile": Path(entry["path"]).name, "pixels": int(ok.sum())}
        for nm in CHECKED_NM:
            ratio = r[nm] / line(r[430], r[750], nm)
            pooled[nm].append(ratio)
            record[f"{nm}nm"] = round(float(np.median(ratio)), 4)
        per_tile.append(record)
        print(record, flush=True)
    result = {
        "story": "docs/stories/SS-16.md (W7, the colour check)",
        "what": "MDR's measured reflectance at 480, 560 and 630 nm over the straight line through its own 430 and 750 nm values, at every pixel (32 px/deg block means) where all five bands were measured",
        "source": "PDS MSGRMDS_5001 (MDR v4), bands 1-5 (WAC filters 6, 3, 4, 5, 7), every file MD5-checked as it streams (pipeline/mercury_sources.json)",
        "allPixels": {f"{nm}nm": summary(np.concatenate(pooled[nm])) for nm in CHECKED_NM},
        "tileMedians": {
            f"{nm}nm": summary(np.array([t[f"{nm}nm"] for t in per_tile])) for nm in CHECKED_NM
        },
        "tiles": per_tile,
    }
    OUT.write_text(json.dumps(result, indent=1, allow_nan=False) + "\n")
    return result


if __name__ == "__main__":
    m = main()
    print(json.dumps({k: m[k] for k in ("allPixels", "tileMedians")}, indent=1))
