"""The Moon's relief from LOLA: a surface-normal map for lighting and a height map for shape.

    npm run pipeline:terrain

SS-8 (docs/stories/SS-8.md). Source: LOLA gridded shape map LDEM_64_FLOAT, PDS data set
LRO-L-LOLA-4-GDR-V1.0. From its label: 23040 x 11520 32-bit little-endian floats, SIMPLE
CYLINDRICAL, 64 pixels/degree (0.4738 km/pixel), pixel-registered, CENTER_LONGITUDE = 180
(column 0 starts at 0 E), POSITIVE_LONGITUDE_DIRECTION = EAST, planetocentric latitude, row 0
at +90. Values are height in km relative to a 1737.4 km sphere (PLANETARY_RADIUS = DN +
OFFSET, OFFSET = 1737.4). Frame "MEAN EARTH/POLAR AXIS OF DE421", the frame MOON_ME is aligned
to, so no rotation is needed between the albedo and the relief.

Outputs in public/data/moon/, all with column 0 at -180 deg and row 0 at +90 deg, like the
albedo:
- normal-east.webp, normal-north.webp (4096 x 2048): the east and north components of the
  unit surface normal in the local east-north-up frame, each stored as
  byte = round((sign(c) * sqrt(|c|) / 2 + 0.5) * 255). The square root spends the 8 bits
  where lunar slopes are (median 3 deg at this scale) instead of on steep slopes that barely
  exist. Up is sqrt(1 - e^2 - n^2).
- height.webp (1024 x 512): height in metres + 32768, 16-bit, split into two bytes (red =
  high, green = low) in a lossless WebP, so the browser decodes it exactly.

Slopes use central differences on the 4096 grid. The east step widens near the poles, where
longitude pixels shrink towards nothing, so it is never shorter than the north step.
The normal encoding is chosen by measurement: the smallest quality whose mean angular error
is at most a fifth of the median slope.
"""

from __future__ import annotations

import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from rasterio.enums import Resampling
from rasterio.io import MemoryFile

from download import fetch, sha256

SOURCE_URL = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/float_img/ldem_64_float.img"
SOURCE_LABEL = SOURCE_URL.replace(".img", ".lbl")
SOURCE_SHA256 = "4dd151f230984316602f13df36214563ff575683cb5612f1a7bc4699188ec25b"
SRC_W, SRC_H = 23040, 11520
REFERENCE_RADIUS_M = 1737400.0

NORMAL_W, NORMAL_H = 4096, 2048
HEIGHT_W, HEIGHT_H = 1024, 512
HEIGHT_STEP_M = 1.0
HEIGHT_OFFSET = 32768
QUALITIES = (80, 85, 90, 95)
ERROR_FRACTION_OF_MEDIAN_SLOPE = 0.2

# Independent ground truth: Chang'E-1 laser altimetry (Li et al. 2010, Science China Earth
# Sciences 53(11):1582-1593, doi:10.1007/s11430-010-4020-1), a different mission and
# instrument from LOLA. East longitudes.
EXTREMES = {
    "highest": {"latDeg": 5.441, "lonDeg": -158.656, "heightKm": 10.629},
    "lowest": {"latDeg": -70.368, "lonDeg": -172.413, "heightKm": -9.178},
}

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "moon"


def load_source() -> np.ndarray:
    """Heights in km, column 0 at -180 deg (the source starts at 0 E)."""
    path = fetch(SOURCE_URL, SOURCE_SHA256, "ldem_64_float.img")
    data = np.fromfile(path, dtype="<f4")
    if data.size != SRC_W * SRC_H:
        raise RuntimeError(f"LDEM_64: {data.size} samples, expected {SRC_W * SRC_H}")
    return np.roll(data.reshape(SRC_H, SRC_W), -SRC_W // 2, axis=1)


def area_average(km: np.ndarray, width: int, height: int) -> np.ndarray:
    """Area-averaged downsample (GDAL "average"), in metres."""
    with MemoryFile() as mf:
        with mf.open(driver="GTiff", width=SRC_W, height=SRC_H, count=1, dtype="float32") as ds:
            ds.write(km.astype(np.float32), 1)
            out = ds.read(1, out_shape=(height, width), resampling=Resampling.average)
    return out.astype(np.float64) * 1000.0


def extreme_check(km: np.ndarray, radius_km: float = 2.0) -> dict:
    """The full-resolution source against Chang'E-1's highest and lowest points."""
    result = {}
    r_km = REFERENCE_RADIUS_M / 1000
    for name, point in EXTREMES.items():
        row = int((90 - point["latDeg"]) * 64)
        col = int(((point["lonDeg"] + 180) % 360) * 64)
        dr = int(radius_km / r_km * 180 / math.pi * 64) + 1
        dc = int(dr / math.cos(math.radians(point["latDeg"]))) + 1
        block = km[row - dr : row + dr + 1][:, np.arange(col - dc, col + dc + 1) % SRC_W]
        value = float(block.max() if name == "highest" else block.min())
        result[name] = {
            **point,
            "lolaKm": round(value, 3),
            "differenceKm": round(value - point["heightKm"], 3),
            "searchRadiusKm": radius_km,
        }
    return result


def enu_normals(h_m: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unit normals (east, north, up) of a height grid on the reference sphere."""
    rows, cols = h_m.shape
    lat = np.radians(90 - (np.arange(rows) + 0.5) * 180 / rows)
    dy = math.pi * REFERENCE_RADIUS_M / rows
    dx0 = 2 * math.pi * REFERENCE_RADIUS_M / cols
    dh_de = np.empty_like(h_m)
    for r in range(rows):
        dx = dx0 * math.cos(lat[r])
        k = max(1, math.ceil(dy / dx))  # never a shorter east step than the north step
        dh_de[r] = (np.roll(h_m[r], -k) - np.roll(h_m[r], k)) / (2 * k * dx)
    dh_dn = np.empty_like(h_m)
    dh_dn[1:-1] = (h_m[:-2] - h_m[2:]) / (2 * dy)  # row 0 is north
    dh_dn[0] = dh_dn[1]
    dh_dn[-1] = dh_dn[-2]
    length = np.sqrt(1 + dh_de**2 + dh_dn**2)
    return -dh_de / length, -dh_dn / length, 1 / length


def encode_component(c: np.ndarray) -> np.ndarray:
    return np.clip(np.rint((np.sign(c) * np.sqrt(np.abs(c)) * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)


def decode_component(b: np.ndarray) -> np.ndarray:
    v = b.astype(np.float64) / 255 * 2 - 1
    return np.sign(v) * v * v


def normal_trials(east: np.ndarray, north: np.ndarray, up: np.ndarray) -> list[dict]:
    trials = []
    for q in QUALITIES:
        data = {}
        decoded = []
        for name, comp in (("east", east), ("north", north)):
            buffer = io.BytesIO()
            Image.fromarray(encode_component(comp)).save(buffer, format="WEBP", quality=q, method=6)
            data[name] = buffer.getvalue()
            decoded.append(decode_component(np.array(Image.open(io.BytesIO(data[name])).convert("L"))))
        de, dn = decoded
        du = np.sqrt(np.clip(1 - de * de - dn * dn, 0, 1))
        angle = np.degrees(np.arccos(np.clip(de * east + dn * north + du * up, -1, 1)))
        trials.append(
            {
                "quality": q,
                "bytes": sum(len(v) for v in data.values()),
                "meanErrorDeg": round(float(angle.mean()), 3),
                "p99ErrorDeg": round(float(np.percentile(angle, 99)), 3),
                "maxErrorDeg": round(float(angle.max()), 3),
                "_data": data,
            }
        )
    return trials


def encode_height(h_m: np.ndarray) -> bytes:
    u = (np.rint(h_m / HEIGHT_STEP_M) + HEIGHT_OFFSET).astype(np.int64)
    if u.min() < 0 or u.max() > 65535:
        raise RuntimeError("heights out of the 16-bit range")
    u = u.astype(np.uint16)
    rgb = np.stack([(u >> 8).astype(np.uint8), (u & 255).astype(np.uint8), np.zeros_like(u, np.uint8)], -1)
    buffer = io.BytesIO()
    Image.fromarray(rgb).save(buffer, format="WEBP", lossless=True, method=6)
    decoded = np.array(Image.open(io.BytesIO(buffer.getvalue())).convert("RGB")).astype(np.uint16)
    if not np.array_equal((decoded[..., 0] << 8) | decoded[..., 1], u):
        raise RuntimeError("height did not survive lossless encoding")
    return buffer.getvalue()


def build() -> dict:
    km = load_source()
    extremes = extreme_check(km)
    h4 = area_average(km, NORMAL_W, NORMAL_H)
    east, north, up = enu_normals(h4)
    slope = np.degrees(np.arccos(up))
    median_slope = float(np.median(slope))
    trials = normal_trials(east, north, up)
    limit = ERROR_FRACTION_OF_MEDIAN_SLOPE * median_slope
    eligible = [t for t in trials if t["meanErrorDeg"] <= limit]
    if not eligible:
        raise RuntimeError("no normal encoding meets the error rule")
    chosen = min(eligible, key=lambda t: t["bytes"])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "normal-east.webp").write_bytes(chosen["_data"]["east"])
    (OUT_DIR / "normal-north.webp").write_bytes(chosen["_data"]["north"])

    h1 = area_average(km, HEIGHT_W, HEIGHT_H)
    (OUT_DIR / "height.webp").write_bytes(encode_height(h1))
    u = (np.rint(h1 / HEIGHT_STEP_M) + HEIGHT_OFFSET).astype(np.int64)

    manifest = {
        "source": {
            "product": "LOLA LDEM_64_FLOAT, PDS LRO-L-LOLA-4-GDR-V1.0",
            "url": SOURCE_URL,
            "label": SOURCE_LABEL,
            "sha256": SOURCE_SHA256,
        },
        "conventions": {
            "source": "simple cylindrical, 64 px/deg, pixel-registered, column 0 at 0 E, east-positive, planetocentric; km above a 1737.4 km sphere; MEAN EARTH/POLAR AXIS OF DE421",
            "outputs": "equirectangular, column 0 at -180 deg, row 0 at +90 deg, like the albedo",
            "normals": "east and north components of the unit normal in local east-north-up; byte = round((sign(c)*sqrt(|c|)/2 + 0.5)*255); up = sqrt(1 - e^2 - n^2)",
            "height": f"metres above 1737.4 km in {HEIGHT_STEP_M:g} m steps + {HEIGHT_OFFSET}, 16-bit as red (high byte) and green (low byte) of a lossless WebP",
            "slopes": "central differences on the 4096 x 2048 grid; east step widened near the poles to at least the north step",
        },
        "normals": {
            "files": ["normal-east.webp", "normal-north.webp"],
            "width": NORMAL_W,
            "height": NORMAL_H,
            "kmPerPixelAtEquator": round(2 * math.pi * REFERENCE_RADIUS_M / 1000 / NORMAL_W, 3),
            "sha256": {n: sha256(OUT_DIR / n) for n in ("normal-east.webp", "normal-north.webp")},
            "slopeDeg": {
                "median": round(median_slope, 3),
                "p99": round(float(np.percentile(slope, 99)), 2),
                "max": round(float(slope.max()), 2),
            },
            "choice": {
                "rule": f"smallest WebP quality with mean angular error <= {ERROR_FRACTION_OF_MEDIAN_SLOPE:g} x median slope ({limit:.3f} deg)",
                "chosen": chosen["quality"],
                "trials": [{k: v for k, v in t.items() if k != "_data"} for t in trials],
            },
        },
        "height": {
            "file": "height.webp",
            "width": HEIGHT_W,
            "height": HEIGHT_H,
            "stepM": HEIGHT_STEP_M,
            "offset": HEIGHT_OFFSET,
            "sha256": sha256(OUT_DIR / "height.webp"),
            "rangeM": [round(float(h1.min()), 1), round(float(h1.max()), 1)],
            # Sum of the decoded 16-bit values; the capture harness checks the browser's
            # decode against it exactly.
            "decodedSum": int(u.sum()),
        },
        "groundTruth": {
            "source": "Chang'E-1 laser altimetry, Li et al. (2010), Science China Earth Sciences 53(11):1582-1593, doi:10.1007/s11430-010-4020-1",
            "extremes": extremes,
        },
    }
    (OUT_DIR / "terrain.json").write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    return manifest


if __name__ == "__main__":
    m = build()
    print(f"normals q{m['normals']['choice']['chosen']}; slopes {m['normals']['slopeDeg']}")
    for t in m["normals"]["choice"]["trials"]:
        print(f"  q{t['quality']}: {t['bytes'] / 1e6:.2f} MB, mean {t['meanErrorDeg']} deg, p99 {t['p99ErrorDeg']} deg")
    print(f"  height {m['height']['rangeM']} m; extremes {m['groundTruth']['extremes']}")
