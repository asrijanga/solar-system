"""The Moon's albedo and colour textures, from LRO WAC's Hapke-normalised mosaic.

    npm run pipeline:moon

Owner decisions, 2026-09-29 (docs/stories/SS-5b.md): the WAC Hapke-normalised mosaic replaces
Clementine between 70 N and 70 S, and the Moon is shown in its measured colour. The mosaic
(wac.py) is I/F at the standard geometry i = g = 60 deg, e = 0, normalised with the same Hapke
parameter maps the renderer uses (core/hapke.ts), so the app inverts exactly what LRO applied.

Other sources complete it (README, "Combine every available source"): LOLA's laser albedo at
the poles (lola_poles.py), blended in from 62 to 70 deg where the mosaic ends, then LOLA's
global laser albedo wherever neither measured (lola_global.py). Both are fitted to the mosaic.

Outputs in public/data/moon/, column 0 = longitude -180 deg (west edge), row 0 = latitude
+90 deg (north edge):
- albedo.webp, 8192 x 4096, one channel stored as grey, lossy: I/F at the standard geometry at
  566 nm, the WAC band nearest V. Area-averaged from 76 px/deg, never decimated. Stored as
  byte = 255 * sqrt(I/F / MAX_IOF): the source is floating point, and a square-root curve puts
  the 8 bits where the Moon's values are (median I/F 0.034), about 2% of I/F per step in the
  maria. The renderer squares it back.
- albedo-colour.png, 2048 x 1024, lossless RGB: red = I/F(643 nm) / I/F(566 nm), green =
  I/F(415 nm) / I/F(566 nm), each linear in the range the manifest gives; blue unused. The
  renderer's red, green and blue are 643, 566 and 415 nm. Colour is 4 times coarser than
  brightness (5.3 km at the equator), as in photographs, so the GPU memory stays within the
  mobile budget. Poleward of 70 deg, and in the mosaic's few gaps, no colour was measured:
  there the ratios are the Moon's median colour, blended in from 62 to 70 deg like the
  brightness, and the manifest and the About text say so.
The albedo encoding is chosen by measurement: the smallest lossy quality at most 6 MB with
PSNR >= 42 dB over all pixels and over the WAC region alone.
"""

from __future__ import annotations

import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from download import CACHE, sha256
from lola_global import fill
from lola_poles import BLEND_BAND, combine, smoothstep
from wac import SOURCES as WAC_SOURCES
from wac import accumulate

WIDTH, HEIGHT = 8192, 4096
COLOUR_WIDTH, COLOUR_HEIGHT = 2048, 1024

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "moon"
MASTER = CACHE / "moon-iof-master.npy"  # float I/F before encoding, not committed

# I/F at byte 255. Every value above it is clipped, and the manifest records how many.
MAX_IOF = 0.25
MAX_BYTES = 6 * 1024 * 1024
# Raised from 40 by the owner on 2026-09-25 (docs/stories/SS-6b.md): at 40 the rule chose q70,
# visibly blocky in smooth maria. Applied to the WAC region on its own as well, so LOLA's
# smooth polar rows cannot lift the average.
MIN_PSNR_DB = 42.0
WAC_REGION_DEG = BLEND_BAND[0]


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    return math.inf if mse == 0 else 10 * math.log10(255**2 / mse)


def pull_push_fill(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Fills invalid pixels smoothly from valid neighbours at every scale (pull-push).

    Deterministic, and valid pixels are returned unchanged.
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


def encode_iof(iof: np.ndarray) -> np.ndarray:
    """byte = 255 sqrt(I/F / MAX_IOF), rounded, at least 1."""
    return np.clip(np.rint(255 * np.sqrt(np.clip(iof, 0, MAX_IOF) / MAX_IOF)), 1, 255).astype(np.uint8)


def decode_iof(byte: np.ndarray) -> np.ndarray:
    return MAX_IOF * (byte.astype(np.float64) / 255) ** 2


def format_trials(master: np.ndarray) -> list[dict]:
    """Encodes the albedo several ways and measures each. Nothing is chosen here."""
    lat = 90 - (np.arange(master.shape[0]) + 0.5) * 180 / master.shape[0]
    low = np.broadcast_to((np.abs(lat) < WAC_REGION_DEG)[:, None], master.shape)
    image = Image.fromarray(master, mode="L")
    trials = [("webp", {"lossless": True, "method": 6})]
    trials += [("webp", {"quality": q, "method": 6}) for q in (95, 90, 85, 80, 70)]
    results = []
    for fmt, options in trials:
        buffer = io.BytesIO()
        image.save(buffer, format=fmt.upper(), **options)
        decoded = np.array(Image.open(io.BytesIO(buffer.getvalue())).convert("L"))
        error = np.abs(master.astype(int) - decoded.astype(int))
        results.append(
            {
                "format": "webp-lossless" if options.get("lossless") else f"webp-q{options['quality']}",
                "bytes": buffer.tell(),
                # Lossless is infinite PSNR, which JSON cannot hold: recorded as null.
                "psnrDb": None if math.isinf(p := psnr(master, decoded)) else round(p, 2),
                "psnrWacDb": None if math.isinf(q := psnr(master[low], decoded[low])) else round(q, 2),
                "maxAbsError": int(error.max()),
                "_data": buffer.getvalue(),
            }
        )
    return results


def choose(trials: list[dict]) -> dict:
    eligible = [
        t
        for t in trials
        if t["bytes"] <= MAX_BYTES and all(t[k] is None or t[k] >= MIN_PSNR_DB for k in ("psnrDb", "psnrWacDb"))
    ]
    if not eligible:
        raise RuntimeError("no encoding meets the size and quality rules; see the trials")
    return min(eligible, key=lambda t: t["bytes"])


def brightness() -> np.ndarray:
    """566 nm I/F at the standard geometry on the 8192 x 4096 grid, NaN where not measured."""
    if MASTER.exists():
        return np.load(MASTER)
    total, count = accumulate("566NM", WIDTH, HEIGHT)
    iof = np.where(count > 0, total / np.maximum(count, 1), np.nan)
    np.save(MASTER, iof)
    return iof


def colour() -> tuple[np.ndarray, np.ndarray, dict]:
    """643/566 and 415/566 ratios on the colour grid, with the median colour where none was
    measured, blended in over the brightness's polar band."""
    sums = {band: accumulate(band, COLOUR_WIDTH, COLOUR_HEIGHT) for band in ("566NM", "643NM", "415NM")}
    measured = np.all([c > 0 for _, c in sums.values()], axis=0)
    mean = {band: t / np.maximum(c, 1) for band, (t, c) in sums.items()}
    measured &= mean["566NM"] > 0
    red = np.where(measured, mean["643NM"] / np.where(measured, mean["566NM"], 1), np.nan)
    blue = np.where(measured, mean["415NM"] / np.where(measured, mean["566NM"], 1), np.nan)
    median_red = float(np.nanmedian(red))
    median_blue = float(np.nanmedian(blue))
    lat = 90 - (np.arange(COLOUR_HEIGHT) + 0.5) * 180 / COLOUR_HEIGHT
    w = smoothstep(BLEND_BAND[0], BLEND_BAND[1], np.abs(lat))[:, None]
    red = np.where(measured, (1 - w) * np.nan_to_num(red) + w * median_red, median_red)
    blue = np.where(measured, (1 - w) * np.nan_to_num(blue) + w * median_blue, median_blue)
    record = {
        "medianRatios": {"643/566": round(median_red, 6), "415/566": round(median_blue, 6)},
        "measuredCells": int(measured.sum()),
        "unmeasuredCells": int((~measured).sum()),
        "unmeasuredEquatorwardOf70": int((~measured & (np.abs(lat) < 70)[:, None]).sum()),
    }
    return red, blue, record


def encode_ratio(r: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return np.clip(np.rint((r - lo) / (hi - lo) * 255), 0, 255).astype(np.uint8)


def build() -> dict:
    base = brightness()
    wac_missing = int(np.sum(~np.isfinite(base)))
    lat = 90 - (np.arange(HEIGHT) + 0.5) * 180 / HEIGHT
    wac_missing_within_70 = int(np.sum(~np.isfinite(base) & (np.abs(lat) < 70)[:, None]))
    # Every available source (README): LOLA's laser albedo at the poles (lola_poles.py), then
    # LOLA's global laser albedo wherever no one else measured (lola_global.py).
    iof, poles = combine(base)
    iof, gap_fill = fill(iof, pull_push_fill)
    if not np.all(np.isfinite(iof)):
        raise RuntimeError("a pixel is still unmeasured")
    clipped = int(np.sum(iof > MAX_IOF))
    negative = int(np.sum(iof < 0))
    master = encode_iof(iof)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    trials = format_trials(master)
    chosen = choose(trials)
    out = OUT_DIR / "albedo.webp"
    out.write_bytes(chosen["_data"])
    (OUT_DIR / "albedo-mask.png").unlink(missing_ok=True)

    red, blue, colour_record = colour()
    ranges = {
        "643/566": [math.floor(float(red.min()) * 100) / 100, math.ceil(float(red.max()) * 100) / 100],
        "415/566": [math.floor(float(blue.min()) * 100) / 100, math.ceil(float(blue.max()) * 100) / 100],
    }
    rgb = np.zeros((COLOUR_HEIGHT, COLOUR_WIDTH, 3), dtype=np.uint8)
    rgb[:, :, 0] = encode_ratio(red, *ranges["643/566"])
    rgb[:, :, 1] = encode_ratio(blue, *ranges["415/566"])
    colour_out = OUT_DIR / "albedo-colour.png"
    Image.fromarray(rgb, mode="RGB").save(colour_out, optimize=True)

    manifest = {
        "product": {
            "name": "LRO WAC Hapke-normalised mosaic (WAC_HAPKE), PDS LRO-L-LROC-5-RDR, LROLRC_2001, DATA/MDR/WAC_HAPKE",
            "url": WAC_SOURCES["base"],
            "files": "pipeline/wac_sources.json: 8 tiles per band, MD5 from each label, SHA-256 pinned",
            "normalisation": "I/F normalised to phase = incidence = 60 deg, emission = 0 deg by the Hapke function with the Sato et al. (2014) parameter maps",
            "bands": {"brightness": "566 nm", "colour": "643 nm and 415 nm, as ratios to 566 nm"},
            "chosen": "owner, 2026-09-29: replace Clementine between 70 N and 70 S, and show the measured colour (docs/stories/SS-5b.md)",
            "wacMissingPixels": wac_missing,
            "wacMissingWithin70Deg": wac_missing_within_70,
        },
        "poles": {
            "source": "LOLA LDAM polar normal albedo, Lemelin et al. (2016), PDS LRO-L-LOLA-4-GDR-V1.0",
            "chosen": "owner, 2026-09-25: LOLA near the poles (docs/stories/SS-6b.md); blend band moved to 62-70 deg where the WAC mosaic ends (SS-5b)",
            "conventions": "polar stereographic, R = 1737.4 km, 1000 m/px, planetocentric, east-positive, MEAN EARTH/POLAR AXIS OF DE421, 1064 nm normal albedo",
            **poles,
        },
        "gapFill": {
            "source": "LOLA LDAM_10_FLOAT global normal albedo, Lemelin et al. (2016), PDS LRO-L-LOLA-4-GDR-V1.0",
            "chosen": "owner, 2026-09-26: 'drop purple and fill gaps' (docs/stories/SS-11c.md)",
            "conventions": "simple cylindrical, R = 1737.4 km, 10 px/deg (3032 m/px at the equator), planetocentric, east-positive, MEAN EARTH/POLAR AXIS OF DE421, 1064 nm normal albedo",
            **gap_fill,
        },
        "conventions": {
            "projection": "equirectangular (simple cylindrical), sphere R = 1737.4 km",
            "latitude": "planetocentric (the WAC headers say planetographic, identical on a sphere)",
            "longitude": "east-positive; column 0 = -180 deg, last column ends at +180 deg",
            "rows": "row 0 = +90 deg latitude",
            "bodyFixedFrame": "MOON_ME (LRO-era mean Earth/polar axis); see ephemeris.json",
            "values": f"566 nm I/F at i = g = 60 deg, e = 0, stored as byte = 255 sqrt(I/F / {MAX_IOF}); LOLA mapped onto it by the fits under poles and gapFill",
        },
        "texture": {
            "file": out.name,
            "width": WIDTH,
            "height": HEIGHT,
            "encoding": {"curve": "sqrt", "maxIOverF": MAX_IOF},
            "clippedPixels": clipped,
            "negativePixelsClampedToZero": negative,
            "kmPerPixelAtEquator": round(2 * math.pi * 1737.4 / WIDTH, 3),
            "missingPixels": 0,
            "missingFraction": 0.0,
            "sha256": sha256(out),
            "mask": None,
            "maskSha256": None,
            "gpuBytesR8WithMips": int(WIDTH * HEIGHT * 4 / 3),
        },
        "colour": {
            "file": colour_out.name,
            "width": COLOUR_WIDTH,
            "height": COLOUR_HEIGHT,
            "channels": "red = I/F(643 nm) / I/F(566 nm), green = I/F(415 nm) / I/F(566 nm), each byte linear over its range; blue unused",
            "ranges": ranges,
            "display": "the renderer's red, green and blue are 643, 566 and 415 nm",
            "unmeasured": "poleward of 70 deg and in the mosaic's gaps: the Moon's median ratios, blended in from 62 to 70 deg",
            **colour_record,
            "sha256": sha256(colour_out),
            "gpuBytesRGBA8WithMips": int(COLOUR_WIDTH * COLOUR_HEIGHT * 4 * 4 / 3),
        },
        "formatChoice": {
            "rule": f"smallest albedo at most {MAX_BYTES} bytes with PSNR >= {MIN_PSNR_DB} dB over all pixels and over the WAC region (|lat| < {WAC_REGION_DEG:g}) alone",
            "chosen": chosen["format"],
            "trials": [{k: v for k, v in t.items() if k != "_data"} for t in trials],
        },
        "masterSha256": sha256(MASTER),
    }
    old = OUT_DIR / "albedo.json"
    if old.exists():
        # The calibration section is pipeline/calibrate.py's; keep it until that re-runs.
        previous = json.loads(old.read_text())
        if "calibration" in previous:
            manifest["calibration"] = previous["calibration"]
    old.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    return manifest


if __name__ == "__main__":
    m = build()
    print(f"chose {m['formatChoice']['chosen']}; clipped {m['texture']['clippedPixels']} pixels")
    for t in m["formatChoice"]["trials"]:
        print(f"  {t['format']:18} {t['bytes'] / 1e6:6.2f} MB  PSNR {'lossless' if t['psnrDb'] is None else t['psnrDb']:>6} dB  max err {t['maxAbsError']:>3}")
    print(json.dumps(m["colour"], indent=1))
    sys.exit(0)
