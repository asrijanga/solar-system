"""The Moon's albedo texture, from the Clementine UVVIS 750 nm global mosaic.

    npm run pipeline:moon

Product chosen by the owner on 2026-09-24 (docs/stories/SS-5.md) over the LRO WAC
"morphology" mosaic, whose shading is baked in.

Source conventions, from the product's PDS3 label (Lunar_Clementine_UVVIS_750nm_Global_
Mosaic_118m_v2_pds3.lbl): equirectangular, planetocentric latitude, POSITIVE_LONGITUDE_
DIRECTION = EAST, CENTER_LONGITUDE = 0, sphere of radius 1737.4 km, 8-bit, nodata 0. The
label gives no scale from pixel value to reflectance: values are relative albedo only.

Outputs in public/data/moon/, both 8192 x 4096, column 0 = longitude -180 deg (west edge),
row 0 = latitude +90 deg (north edge):
- albedo-mask.png: lossless 1-bit, white where Clementine never imaged the surface. It is
  the only authority on gaps.
- albedo.webp: relative albedo, one channel stored as grey, lossy. Every source pixel is
  area-averaged in (GDAL "average" with fractional coverage), never decimated. Values are
  linear in the source's pixel values: no sRGB curve, because the source is itself 8-bit and
  a transfer curve cannot add precision it does not have. Inside gaps the values are a
  smooth pull-push fill so the codec does not spend bits on hard edges; they are filler, and
  the mask says never to show them.
The split exists because a lossy codec cannot carry an exact no-data value: encoded as 0 in
a single WebP, 50,000 to 130,000 pixels flipped between gap and data (docs/stories/SS-5.md).
The albedo encoding is chosen by measurement: the smallest quality whose albedo plus mask is
at most 6 MB with PSNR >= 40 dB over imaged pixels only.
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
from lola_poles import combine

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


def pull_push_fill(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Fills invalid pixels smoothly from valid neighbours at every scale (pull-push).

    Filler for compression only. Deterministic, and valid pixels are returned unchanged.
    """
    if valid.all():
        return values.astype(np.float64)
    h, w = values.shape
    v = np.where(valid, values, 0).astype(np.float64)
    wgt = valid.astype(np.float64)
    ph, pw = h + h % 2, w + w % 2  # pad to even so 2x2 blocks tile exactly
    v = np.pad(v, ((0, ph - h), (0, pw - w)))
    wgt = np.pad(wgt, ((0, ph - h), (0, pw - w)))
    sum_v = v.reshape(ph // 2, 2, pw // 2, 2).sum(axis=(1, 3))
    sum_w = wgt.reshape(ph // 2, 2, pw // 2, 2).sum(axis=(1, 3))
    coarse_valid = sum_w > 0
    coarse = np.where(coarse_valid, sum_v / np.maximum(sum_w, 1), 0)
    coarse = pull_push_fill(coarse, coarse_valid)
    up = np.repeat(np.repeat(coarse, 2, axis=0), 2, axis=1)[:h, :w]
    return np.where(valid, values, up)


def albedo_for_encoding(master: np.ndarray) -> np.ndarray:
    valid = master > 0
    return np.clip(np.rint(pull_push_fill(master, valid)), 1, 255).astype(np.uint8)


def format_trials(master: np.ndarray) -> list[dict]:
    """Encodes the albedo several ways and measures each over imaged pixels. Nothing is chosen here."""
    valid = master > 0
    filled = Image.fromarray(albedo_for_encoding(master), mode="L")
    trials = [("webp", {"lossless": True, "method": 6})]
    trials += [("webp", {"quality": q, "method": 6}) for q in (95, 90, 85, 80, 70)]
    results = []
    for fmt, options in trials:
        buffer = io.BytesIO()
        filled.save(buffer, format=fmt.upper(), **options)
        decoded = np.array(Image.open(io.BytesIO(buffer.getvalue())).convert("L"))
        error = np.abs(master[valid].astype(int) - decoded[valid].astype(int))
        results.append(
            {
                "format": "webp-lossless" if options.get("lossless") else f"webp-q{options['quality']}",
                "bytes": buffer.tell(),
                # Lossless is infinite PSNR, which JSON cannot hold: recorded as null.
                "psnrDb": None if math.isinf(p := psnr(master[valid], decoded[valid])) else round(p, 2),
                "maxAbsError": int(error.max()),
                "_data": buffer.getvalue(),
            }
        )
    return results


def encode_mask(master: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(master == 0).convert("1").save(buffer, format="PNG", optimize=True)
    decoded = np.array(Image.open(io.BytesIO(buffer.getvalue())).convert("L")) > 0
    if not np.array_equal(decoded, master == 0):
        raise RuntimeError("gap mask did not survive encoding exactly")
    return buffer.getvalue()


def choose(trials: list[dict], mask_bytes: int) -> dict:
    eligible = [
        t
        for t in trials
        if t["bytes"] + mask_bytes <= MAX_BYTES and (t["psnrDb"] is None or t["psnrDb"] >= MIN_PSNR_DB)
    ]
    if not eligible:
        raise RuntimeError("no encoding meets the size and quality rules; see the trials")
    return min(eligible, key=lambda t: t["bytes"])


def build() -> dict:
    source = fetch(SOURCE_URL, SOURCE_SHA256, "clementine-uvvis-750nm-118m-v2.1.tif", md5=SOURCE_MD5)
    if MASTER.exists():
        master = np.array(Image.open(MASTER))
    else:
        master = downsample(source)
        Image.fromarray(master, mode="L").save(MASTER, optimize=True)

    clementine_missing = int(np.sum(master == 0))
    # Every available source (README): LOLA's laser albedo at the poles (lola_poles.py).
    master, poles = combine(master)

    mask_data = encode_mask(master)
    trials = format_trials(master)
    chosen = choose(trials, len(mask_data))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "albedo.webp"
    out.write_bytes(chosen["_data"])
    mask_out = OUT_DIR / "albedo-mask.png"
    mask_out.write_bytes(mask_data)

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
        "poles": {
            "source": "LOLA LDAM polar normal albedo, Lemelin et al. (2016), PDS LRO-L-LOLA-4-GDR-V1.0",
            "chosen": "owner, 2026-09-25: replace Clementine poleward of ~70 deg (docs/stories/SS-6b.md)",
            "conventions": "polar stereographic, R = 1737.4 km, 1000 m/px, planetocentric, east-positive, MEAN EARTH/POLAR AXIS OF DE421, 1064 nm normal albedo",
            "clementineMissingPixels": clementine_missing,
            **poles,
        },
        "conventions": {
            "projection": "equirectangular (simple cylindrical), sphere R = 1737.4 km",
            "latitude": "planetocentric (identical to planetographic on a sphere)",
            "longitude": "east-positive; column 0 = -180 deg, last column ends at +180 deg",
            "rows": "row 0 = +90 deg latitude",
            "bodyFixedFrame": "MOON_ME (LRO-era mean Earth/polar axis); see ephemeris.json",
            "values": "relative albedo 1-255 on Clementine's scale, linear; LOLA mapped onto it by the fits under poles",
            "gaps": "albedo-mask.png is authoritative: white = never imaged. Albedo values there are compression filler",
        },
        "texture": {
            "file": out.name,
            "width": WIDTH,
            "height": HEIGHT,
            "kmPerPixelAtEquator": round(2 * math.pi * 1737.4 / WIDTH, 3),
            "missingPixels": missing,
            "missingFraction": round(missing / master.size, 6),
            "sha256": sha256(out),
            "mask": mask_out.name,
            "maskSha256": sha256(mask_out),
            "gpuBytesR8WithMips": int(WIDTH * HEIGHT * 4 / 3),
        },
        "formatChoice": {
            "rule": f"smallest albedo with albedo + mask <= {MAX_BYTES} bytes and PSNR >= {MIN_PSNR_DB} dB over imaged pixels",
            "maskBytes": len(mask_data),
            "chosen": chosen["format"],
            "trials": [{k: v for k, v in t.items() if k != "_data"} for t in trials],
        },
        "masterSha256": sha256(MASTER),
    }
    (OUT_DIR / "albedo.json").write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    return manifest


if __name__ == "__main__":
    m = build()
    print(f"chose {m['formatChoice']['chosen']}; missing {m['texture']['missingFraction']:.4%} of pixels")
    for t in m["formatChoice"]["trials"]:
        print(f"  {t['format']:18} {t['bytes'] / 1e6:6.2f} MB  PSNR {'lossless' if t['psnrDb'] is None else t['psnrDb']:>6} dB  max err {t['maxAbsError']:>3}")
    print(f"  mask {m['formatChoice']['maskBytes'] / 1e6:.3f} MB")
    sys.exit(0)
