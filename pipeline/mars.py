"""Mars's surface as seen in visible light, a long-term average, from the Mars Express HRSC
high-altitude global colour mosaic (SS-14 W3).

    npm run pipeline:mars

Python for GDAL's reprojection and the array maths (CLAUDE.md, Stack).

Owner decisions (docs/stories/SS-14.md):
- 2026-09-29: a long-term average, not one date's dust and clouds.
- 2026-10-02, after the colour comparison (docs/stories/ss14-colour-candidates.png): "HRSC for
  both". HRSC gives the brightness and the colour; OMEGA and TES, which made the first map
  (SS-14 W3 part 1), become independent checks.

Source (pipeline/hrsc_sources.json; docs/data/mars.md): Michael et al. 2025, Icarus 425, 116350,
data doi:10.17169/refubium-40624. Four filters used, blue 440, green 530, red 750 and infrared
970 nm, each as six orthographic faces (centred on the poles and on 0, 90, 180 and 270 E, each
reaching 55.6 deg from its centre), float32 reflectance on a 3396.0 km sphere, nodata -1e32.
From the paper: about 90 high-altitude images from 2019 on, with little dust and clouds cut out,
joined through a global colour model built from "only the relative colour information internal
to individual images" and each filter calibrated "to a single high quality observation area".
Images are used "with the illumination as acquired": shading from the source images remains,
most visibly on steep walls; band ratios cancel most of it.

Assembly: each face is warped (area average) onto one global grid, and every pixel takes the
face whose centre is nearest, where its projection is least stretched. Where faces overlap
their values are compared and recorded. The face centred on 180 E is warped onto a 0..360 grid
and rolled, because a warp across the antimeridian returns nothing.

Outputs in public/data/mars/, column 0 = longitude -180 deg (west edge), row 0 = latitude +90:
- albedo.webp, 8192 x 4096, grey: reflectance at 530 nm (the band nearest V), stored as
  byte = 255 sqrt(R / MAX_REFLECTANCE).
- albedo-colour.png, 2048 x 1024, lossless RGB: the ratios R(750)/R(530), R(440)/R(530) and
  R(970)/R(530) in red, green and blue, each linear over the range the manifest gives. Colour is
  four times coarser than brightness, as for the Moon (SS-5b).
- albedo.json, the manifest, with the faces' agreement and the checks against OMEGA and TES.

Not yet: the overall scale is the mosaic's own, anchored to one area. Checking it against Mars's
published brightness needs Mars drawn with its photometry (W7).
"""

from __future__ import annotations

import io
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject

from download import fetch, sha256
from moon import MAX_BYTES, MIN_PSNR_DB, psnr

SOURCES = json.loads((Path(__file__).resolve().parent / "hrsc_sources.json").read_text())
FILTERS = {"blue": ("03-bl", 440), "green": ("02-gr", 530), "red": ("01-re", 750), "infrared": ("04-ir", 970)}
FACES = {"000": (0.0, 0.0), "090": (90.0, 0.0), "180": (180.0, 0.0), "270": (-90.0, 0.0), "N": (0.0, 90.0), "S": (0.0, -90.0)}
SPHERE_M = 3396000.0

# Reflectance at byte 255. Above every value in the mosaic (the south polar ice reaches 1.07).
MAX_REFLECTANCE = 1.2

WIDTH, HEIGHT = 8192, 4096
COLOUR_WIDTH, COLOUR_HEIGHT = 2048, 1024
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "mars"

# The checks: OMEGA and TES, as in SS-14 W3 part 1 (docs/data/mars.md).
OMEGA_URL = "https://archives.esac.esa.int/psa/ftp/MARS-EXPRESS/OMEGA/MEX-M-OMEGA-5-DDR-GLOBAL-MAPS-V1.0/DATA/ALBEDO/ALBEDO_R1080_EQU_MAP.IMG"
OMEGA_SHA256 = "3fc99ad4190ba509492e2d2435f561c37f87251a96d037b596526e45c801e9c5"
TES_URL = "https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-special-v1/global_albedo_8ppd.img"
TES_SHA256 = "47ee17fc9aca6aa9fd5d49e383c1acc366d4cb31cab4635bc823bc27a33283c7"


def face_path(code: str, face: str) -> Path:
    name = f"{code}-face_{face}.tif"
    return fetch(SOURCES["base"] + name, SOURCES["files"][name]["sha256"], f"mars-hrsc-{name}")


def angular_distance(lon_c: float, lat_c: float, width: int, height: int) -> np.ndarray:
    lon = np.radians((np.arange(width) + 0.5) / width * 360 - 180)
    lat = np.radians(90 - (np.arange(height) + 0.5) / height * 180)
    c, cl = math.radians(lat_c), math.radians(lon_c)
    cos = np.sin(lat)[:, None] * math.sin(c) + np.cos(lat)[:, None] * math.cos(c) * np.cos(lon[None, :] - cl)
    return np.arccos(np.clip(cos, -1, 1)).astype(np.float32)


def warp_face(path: Path, face: str, width: int, height: int) -> np.ndarray:
    crs = CRS.from_proj4(f"+proj=longlat +R={SPHERE_M} +no_defs")
    west = 0 if face == "180" else -180
    out = np.full((height, width), np.nan, dtype=np.float32)
    with rasterio.open(path) as src:
        reproject(
            rasterio.band(src, 1),
            out,
            dst_transform=from_bounds(west, -90, west + 360, 90, width, height),
            dst_crs=crs,
            src_nodata=src.nodata,
            dst_nodata=np.nan,
            resampling=Resampling.average,
        )
    out[~(out > 0)] = np.nan
    return np.roll(out, -width // 2, axis=1) if face == "180" else out


def sample_face(path: Path, lon: float, lat: float) -> float | None:
    """The face's own pixel under a point, by its projection (nearest pixel)."""
    from rasterio.warp import transform as transform_points

    with rasterio.open(path) as src:
        xs, ys = transform_points(CRS.from_proj4(f"+proj=longlat +R={SPHERE_M} +no_defs"), src.crs, [lon], [lat])
        row, col = src.index(xs[0], ys[0])
        if not (0 <= row < src.height and 0 <= col < src.width):
            return None
        value = float(src.read(1, window=((row, row + 1), (col, col + 1)))[0, 0])
    return value if value > 0 else None


def mosaic(code: str, width: int, height: int, distances: dict[str, np.ndarray]) -> tuple[np.ndarray, dict]:
    """One filter on the global grid, each pixel from the face whose centre is nearest."""
    faces = {f: warp_face(face_path(code, f), f, width, height) for f in FACES}
    best = np.full((height, width), np.inf, dtype=np.float32)
    out = np.full((height, width), np.nan, dtype=np.float32)
    for f, values in faces.items():
        d = np.where(np.isfinite(values), distances[f], np.inf)
        take = d < best
        out[take] = values[take]
        best[take] = d[take]
    # The warp leaves the pixel at each pole empty, a singular point of the reprojection though it
    # is the centre of the polar face: those few are read from the nearest face directly.
    missing = np.argwhere(~np.isfinite(out))
    direct = 0
    for row, col in missing:
        lat = 90 - (row + 0.5) / height * 180
        lon = (col + 0.5) / width * 360 - 180
        face = min(FACES, key=lambda f: float(distances[f][row, col]))
        value = sample_face(face_path(code, face), lon, lat)
        if value is not None:
            out[row, col] = value
            direct += 1
    # Where two faces both measured a pixel, how far apart are they?
    names = list(faces)
    ratios = []
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            both = np.isfinite(faces[a]) & np.isfinite(faces[b])
            if both.sum() > 1000:
                ratios.append(faces[a][both] / faces[b][both] - 1)
    r = np.concatenate(ratios)
    agreement = {
        "overlappingPixelPairs": int(r.size),
        "medianAbsoluteRelativeDifference": round(float(np.median(np.abs(r))), 5),
        "meanRelativeDifference": round(float(r.mean()), 5),
        "pixelsReadDirectlyFromAFace": direct,
    }
    return out, agreement


def block_mean(a: np.ndarray, k: int) -> np.ndarray:
    h, w = a.shape
    return np.nanmean(a.reshape(h // k, k, w // k, k), axis=(1, 3))


def omega_8ppd() -> np.ndarray:
    path = fetch(OMEGA_URL, OMEGA_SHA256, "mars-omega-albedo-r1080.img")
    dn = np.fromfile(path, dtype="<i2").reshape(7200, 14400)
    a = np.where(dn == -32768, np.nan, 0.52414565669 + 1.4522365285e-05 * dn.astype(np.float64))
    cells = a.reshape(1440, 5, 2880, 5)
    count = np.isfinite(cells).sum(axis=(1, 3))
    # Only cells OMEGA measured completely, as in part 1's checks.
    return np.where(count == 25, np.nansum(cells, axis=(1, 3)) / 25, np.nan)


def tes_8ppd() -> np.ndarray:
    path = fetch(TES_URL, TES_SHA256, "mars-tes-albedo-8ppd.img")
    return np.fromfile(path, dtype="<f4").reshape(1440, 2880).astype(np.float64)


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
    """Exact area average of a global equirectangular grid onto another, rows then columns."""
    ri, rw = overlaps(values.shape[0], height)
    rows = sum(rw[:, k, None] * values[ri[:, k], :] for k in range(ri.shape[1]))
    ci, cw = overlaps(values.shape[1], width)
    return sum(cw[None, :, k] * rows[:, ci[:, k]] for k in range(ci.shape[1]))


def compare(green: np.ndarray, other: np.ndarray, name: str) -> dict:
    """HRSC's 530 nm reflectance against another instrument's map, on its 8 px/deg grid."""
    g = area_average(green, 2880, 1440)
    lat = 90 - (np.arange(1440) + 0.5) / 8
    out = {"instrument": name}
    for limit in (60, 90):
        m = np.isfinite(g) & np.isfinite(other) & (np.abs(lat) <= limit)[:, None]
        x, y = other[m], g[m]
        out[f"withinLatitude{limit}"] = {
            "cells": int(m.sum()),
            "correlation": round(float(np.corrcoef(x, y)[0, 1]), 4),
            "hrscOverItThroughZero": round(float(np.sum(x * y) / np.sum(x * x)), 4),
        }
    return out


def encode(r: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(255 * np.sqrt(np.clip(r, 0, MAX_REFLECTANCE) / MAX_REFLECTANCE)), 1, 255).astype(np.uint8)


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


def encode_ratio(r: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return np.clip(np.rint((r - lo) / (hi - lo) * 255), 0, 255).astype(np.uint8)


def build() -> dict:
    distances = {f: angular_distance(*c, WIDTH, HEIGHT) for f, c in FACES.items()}
    bands: dict[str, np.ndarray] = {}
    agreement: dict[str, dict] = {}
    for name, (code, _) in FILTERS.items():
        bands[name], agreement[name] = mosaic(code, WIDTH, HEIGHT, distances)
        print(f"{name}: {np.isfinite(bands[name]).mean():.4%} covered, faces agree to {agreement[name]['medianAbsoluteRelativeDifference']:.2%}", flush=True)
    green = bands["green"]
    if not all(np.isfinite(b).all() for b in bands.values()):
        raise RuntimeError("a pixel is unmeasured in some filter")

    master = encode(green)
    trials = format_trials(master)
    chosen = choose(trials)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    albedo_out = OUT_DIR / "albedo.webp"
    albedo_out.write_bytes(chosen["_data"])
    (OUT_DIR / "albedo-source.png").unlink(missing_ok=True)

    k = WIDTH // COLOUR_WIDTH
    coarse = {n: block_mean(b, k) for n, b in bands.items()}
    ratios = {n: coarse[n] / coarse["green"] for n in ("red", "blue", "infrared")}
    ranges = {
        f"{FILTERS[n][1]}/530": [math.floor(float(r.min()) * 100) / 100, math.ceil(float(r.max()) * 100) / 100]
        for n, r in ratios.items()
    }
    rgb = np.zeros((COLOUR_HEIGHT, COLOUR_WIDTH, 3), dtype=np.uint8)
    for c, n in enumerate(("red", "blue", "infrared")):
        rgb[:, :, c] = encode_ratio(ratios[n], *ranges[f"{FILTERS[n][1]}/530"])
    colour_out = OUT_DIR / "albedo-colour.png"
    Image.fromarray(rgb, mode="RGB").save(colour_out, optimize=True)

    green8 = green.astype(np.float64)
    checks = [compare(green8, omega_8ppd(), "OMEGA 1.08 um Lambert albedo (SS-14 W3 part 1)"), compare(green8, tes_8ppd(), "TES bolometric albedo")]

    manifest = {
        "product": {
            "name": SOURCES["source"],
            "base": SOURCES["base"],
            "files": "pipeline/hrsc_sources.json: 4 filters x 6 faces, SHA-256 pinned",
            "licence": SOURCES["licence"],
            "quantity": "reflectance per filter from a global colour model of relative colour within images, each filter calibrated to one observation area (Michael et al. 2025)",
            "chosen": "owner: 2026-09-29 a long-term average; 2026-10-02 'HRSC for both' brightness and colour (docs/stories/SS-14.md)",
            "faceAgreement": agreement,
            "shading": "images used with the illumination as acquired: some shading remains in the brightness, most on steep walls; the colour ratios cancel most of it",
        },
        "checks": checks,
        "conventions": {
            "projection": "equirectangular (simple cylindrical), sphere R = 3396.0 km (the source faces')",
            "latitude": "planetocentric",
            "longitude": "east-positive; column 0 = -180 deg, last column ends at +180 deg",
            "rows": "row 0 = +90 deg latitude",
            "bodyFixedFrame": "IAU_MARS; see ephemeris.json",
            "assembly": "each pixel from the face whose centre is nearest, after an area-average warp of every face",
        },
        "texture": {
            "file": albedo_out.name,
            "width": WIDTH,
            "height": HEIGHT,
            "values": f"HRSC reflectance at 530 nm, stored as byte = 255 sqrt(R / {MAX_REFLECTANCE})",
            "encoding": {"curve": "sqrt", "maxReflectance": MAX_REFLECTANCE},
            "clippedPixels": int(np.sum(green > MAX_REFLECTANCE)),
            "medianReflectance": round(float(np.median(green)), 4),
            "meanReflectance": round(float(green.mean()), 4),
            "kmPerPixelAtEquator": round(2 * math.pi * 3396.19 / WIDTH, 3),
            "sha256": sha256(albedo_out),
            "gpuBytesR8WithMips": int(WIDTH * HEIGHT * 4 / 3),
        },
        "colour": {
            "file": colour_out.name,
            "width": COLOUR_WIDTH,
            "height": COLOUR_HEIGHT,
            "bandsNm": [FILTERS[n][1] for n in ("blue", "green", "red", "infrared")],
            "channels": "red = R(750)/R(530), green = R(440)/R(530), blue = R(970)/R(530), each byte linear over its range",
            "ranges": ranges,
            "medianRatios": {f"{FILTERS[n][1]}/530": round(float(np.median(r)), 4) for n, r in ratios.items()},
            "sha256": sha256(colour_out),
            "gpuBytesRGBA8WithMips": int(COLOUR_WIDTH * COLOUR_HEIGHT * 4 * 4 / 3),
        },
        "formatChoice": {
            "rule": f"smallest albedo at most {MAX_BYTES} bytes with PSNR >= {MIN_PSNR_DB} dB over all pixels (the Moon's rule)",
            "chosen": chosen["format"],
            "trials": [{k2: v for k2, v in t.items() if k2 != "_data"} for t in trials],
        },
    }
    (OUT_DIR / "albedo.json").write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    return manifest


if __name__ == "__main__":
    m = build()
    print(json.dumps({"agreement": m["product"]["faceAgreement"], "checks": m["checks"], "colour": m["colour"]["medianRatios"]}, indent=1))
    print(f"chose {m['formatChoice']['chosen']}; clipped {m['texture']['clippedPixels']}; median {m['texture']['medianReflectance']}")
