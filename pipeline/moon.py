"""The Moon's albedo texture, from the Clementine UVVIS 750 nm global mosaic.

    npm run pipeline:moon

Product chosen by the owner on 2026-09-24 (docs/stories/SS-5.md) over the LRO WAC
"morphology" mosaic, whose shading is baked in.

Source conventions, from the product's PDS3 label (Lunar_Clementine_UVVIS_750nm_Global_
Mosaic_118m_v2_pds3.lbl): equirectangular, planetocentric latitude, POSITIVE_LONGITUDE_
DIRECTION = EAST, CENTER_LONGITUDE = 0, sphere of radius 1737.4 km, 8-bit, nodata 0. The
label gives no scale from pixel value to reflectance: values are relative albedo only.

Output public/data/moon/albedo.webp, 8192 x 4096, one channel stored as grey:
- column 0 is longitude -180 deg (west edge), row 0 is latitude +90 deg (north edge);
- every source pixel is area-averaged into the output (GDAL "average" with fractional
  coverage), never decimated;
- 0 means no data (Clementine never imaged it). Valid pixels are 1 to 255;
- values are linear in the source's pixel values: no sRGB curve is applied, because the
  source is itself 8-bit and a transfer curve cannot add precision it does not have.
The encoding is chosen by measurement (format_trials): the smallest file under 6 MB whose
PSNR against the lossless master is at least 40 dB.
"""

from __future__ import annotations

import io
import json
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.windows import Window

from download import CACHE, fetch, sha256

SOURCE_URL = (
    "https://planetarymaps.usgs.gov/mosaic/Lunar_Clementine_UVVIS_750nm_Global_Mosaic_118m_v2.1.tif"
)
SOURCE_MD5 = "8f2709140f810b64b3d2703a53ab4074"  # published by USGS alongside the file
SOURCE_SHA256: str | None = "51b2367ecbcc939c03a92297ecff7e35c592b17c12141e4ff152dd7e30459120"  # pinned 2026-09-24 after the publisher MD5 matched
SOURCE_LABEL = (
    "https://planetarymaps.usgs.gov/mosaic/Lunar_Clementine_UVVIS_750nm_Global_Mosaic_118m_v2_pds3.lbl"
)

WIDTH, HEIGHT = 8192, 4096
BAND_ROWS = 128  # output rows per read: 1,440 source rows, about 130 MB

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "moon"
MASTER = CACHE / "moon-albedo-master.png"  # lossless, not committed

MAX_BYTES = 6 * 1024 * 1024
MIN_PSNR_DB = 40.0


def downsample(source: Path) -> np.ndarray:
    """Area-averages the whole mosaic to WIDTH x HEIGHT, band by band. Returns uint8, 0 = no data."""
    out = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    with rasterio.open(source) as ds:
        if (ds.width, ds.height) != (92160, 46080) or ds.nodata != 0:
            raise RuntimeError(f"unexpected source: {ds.width}x{ds.height}, nodata {ds.nodata}")
        scale = ds.height / HEIGHT  # 11.25 source rows per output row
        for r0 in range(0, HEIGHT, BAND_ROWS):
            r1 = min(HEIGHT, r0 + BAND_ROWS)
            window = Window(0, r0 * scale, ds.width, (r1 - r0) * scale)
            band = ds.read(
                1,
                window=window,
                out_shape=(r1 - r0, WIDTH),
                out_dtype="float32",
                resampling=Resampling.average,
                masked=True,
            )
            values = np.clip(np.rint(band.filled(0)), 0, 255).astype(np.uint8)
            # A partly imaged output pixel keeps its average; it must never round to the
            # no-data value, which would invent a gap.
            values[(~band.mask) & (values == 0)] = 1
            out[r0:r1] = values
            print(f"  rows {r1}/{HEIGHT}", end="\r", flush=True)
    print()
    return out


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    return math.inf if mse == 0 else 10 * math.log10(255**2 / mse)


def format_trials(master: np.ndarray) -> list[dict]:
    """Encodes the master several ways and measures each. Nothing is chosen here."""
    image = Image.fromarray(master, mode="L")
    trials = [("png", {"optimize": True}), ("webp", {"lossless": True, "method": 6})]
    trials += [("webp", {"quality": q, "method": 6}) for q in (95, 90, 85, 80, 70)]
    results = []
    for fmt, options in trials:
        buffer = io.BytesIO()
        image.save(buffer, format=fmt.upper(), **options)
        decoded = np.array(Image.open(io.BytesIO(buffer.getvalue())).convert("L"))
        label = fmt + ("-lossless" if options.get("lossless") or fmt == "png" else f"-q{options.get('quality')}")
        results.append(
            {
                "format": label,
                "bytes": buffer.tell(),
                "psnrDb": round(psnr(master, decoded), 2),
                "maxAbsError": int(np.max(np.abs(master.astype(int) - decoded.astype(int)))),
                # A lossy codec must not turn real data into the no-data value or back.
                "gapPixelsChanged": int(np.sum((master == 0) != (decoded == 0))),
                "_data": buffer.getvalue(),
            }
        )
    return results


def choose(trials: list[dict]) -> dict:
    eligible = [
        t for t in trials
        if t["bytes"] <= MAX_BYTES and t["psnrDb"] >= MIN_PSNR_DB and t["gapPixelsChanged"] == 0
    ]
    if not eligible:
        raise RuntimeError("no encoding meets the size, quality and gap rules; see the trials")
    return min(eligible, key=lambda t: t["bytes"])


def build() -> dict:
    source = fetch(SOURCE_URL, SOURCE_SHA256, "clementine-uvvis-750nm-118m-v2.1.tif", md5=SOURCE_MD5)
    if MASTER.exists():
        master = np.array(Image.open(MASTER))
    else:
        master = downsample(source)
        Image.fromarray(master, mode="L").save(MASTER, optimize=True)

    trials = format_trials(master)
    chosen = choose(trials)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "albedo.webp"
    out.write_bytes(chosen["_data"])

    missing = int(np.sum(master == 0))
    manifest = {
        "product": {
            "name": "Clementine UVVIS 750 nm Global Mosaic 118 m v2.1 (USGS Astrogeology)",
            "url": SOURCE_URL,
            "md5": SOURCE_MD5,
            "sha256": sha256(source),
            "label": SOURCE_LABEL,
            "chosen": "owner, 2026-09-24, over LRO WAC morphology mosaic (baked shading)",
        },
        "conventions": {
            "projection": "equirectangular (simple cylindrical), sphere R = 1737.4 km",
            "latitude": "planetocentric (identical to planetographic on a sphere)",
            "longitude": "east-positive; column 0 = -180 deg, last column ends at +180 deg",
            "rows": "row 0 = +90 deg latitude",
            "bodyFixedFrame": "MOON_ME (LRO-era mean Earth/polar axis); see ephemeris.json",
            "values": "relative albedo, linear in source pixel value; no reflectance scale in the label",
            "noData": 0,
        },
        "texture": {
            "file": out.name,
            "width": WIDTH,
            "height": HEIGHT,
            "kmPerPixelAtEquator": round(2 * math.pi * 1737.4 / WIDTH, 3),
            "missingPixels": missing,
            "missingFraction": round(missing / master.size, 6),
            "sha256": sha256(out),
            "gpuBytesR8WithMips": int(WIDTH * HEIGHT * 4 / 3),
        },
        "formatChoice": {
            "rule": f"smallest with bytes <= {MAX_BYTES}, PSNR >= {MIN_PSNR_DB} dB, and no gap pixels changed",
            "chosen": chosen["format"],
            "trials": [{k: v for k, v in t.items() if k != "_data"} for t in trials],
        },
        "masterSha256": sha256(MASTER),
    }
    (OUT_DIR / "albedo.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    m = build()
    print(f"chose {m['formatChoice']['chosen']}; missing {m['texture']['missingFraction']:.4%} of pixels")
    for t in m["formatChoice"]["trials"]:
        print(f"  {t['format']:18} {t['bytes'] / 1e6:6.2f} MB  PSNR {t['psnrDb']:>6} dB  max err {t['maxAbsError']:>3}  gap changes {t['gapPixelsChanged']}")
    sys.exit(0)
