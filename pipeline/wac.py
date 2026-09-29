"""LRO WAC Hapke-normalised mosaic tiles, read and area-averaged onto the app's grids.

Product: WAC_HAPKE (PDS data set LRO-L-LROC-5-RDR, volume LROLRC_2001, DATA/MDR/WAC_HAPKE),
photometrically normalised radiance factor I/F, "Normalized to the angles of phase (g) =
incidence (i) = 60 deg, emission (e) = 0 deg by Hapke bidirectional reflectance function" with
the Hapke parameter maps of Sato et al. (2014), from about 124,300 WAC images, each pixel the
median of about 40 months of observations (docs/stories/SS-5b.md).

Conventions, from each tile's attached PDS3 header and PDS4 label:
- **Layout:** 8 tiles per band, 90 deg of longitude by 70 deg of latitude, 0-70 N or 0-70 S.
  RECORD_BYTES 27360, ^IMAGE 2, so the image starts at byte 27360 (the PDS4 offset agrees).
  6840 samples by 5321 lines (north) or 5320 (south), IEEE 754 little-endian 32-bit floats,
  missing value 0xFF7FFFFB.
- **Map:** EQUIRECTANGULAR, CENTER_LATITUDE 0, CENTER_LONGITUDE 0, sphere of A_AXIS_RADIUS
  1737.4 km, MAP_RESOLUTION 76 pixels per degree (400 m at the equator),
  POSITIVE_LONGITUDE_DIRECTION EAST. PROJECTION_LATITUDE_TYPE is PLANETOGRAPHIC, which on a
  sphere is the planetocentric latitude the app uses.
- **Pixel centres:** the header's note: "The center of the upper left pixel is defined as line
  and sample (1.0,1.0)", and the projection offsets are from there to the projection origin,
  positive when the origin is right of or below it. So 1-based line L is at latitude
  (LINE_PROJECTION_OFFSET - (L - 1)) / MAP_RESOLUTION and sample S at longitude
  ((S - 1) - SAMPLE_PROJECTION_OFFSET) / MAP_RESOLUTION.

Every file is pinned (wac_sources.json): MD5 from its label, SHA-256 recorded after the MD5
matched.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

from download import fetch

HERE = Path(__file__).resolve().parent
SOURCES = json.loads((HERE / "wac_sources.json").read_text())
TILES = [
    f"E350{h}{c}" for h in ("N", "S") for c in ("0450", "1350", "2250", "3150")
]
MISSING_BITS = 0xFF7FFFFB
LINES_PER_CHUNK = 400


def tile_path(band: str, tile: str) -> Path:
    name = f"WAC_HAPKE_{band}_{tile}"
    pin = SOURCES["files"][name]
    return fetch(SOURCES["base"] + name + ".IMG", pin["sha256"], name + ".IMG", md5=pin["md5"])


def header(path: Path) -> dict:
    """The keywords this module relies on, from the tile's attached PDS3 header."""
    text = path.open("rb").read(27360).decode("latin-1")

    def value(key: str) -> str:
        m = re.search(rf"^\s*{key}\s*=\s*([^\s<]+)", text, re.MULTILINE)
        if m is None:
            raise RuntimeError(f"{path.name}: no {key} in its header")
        return m.group(1).strip('"')

    h = {
        "recordBytes": int(value("RECORD_BYTES")),
        "image": int(value(r"\^IMAGE")),
        "lines": int(value("LINES")),
        "samples": int(value("LINE_SAMPLES")),
        "sampleType": value("SAMPLE_TYPE"),
        "sampleBits": int(value("SAMPLE_BITS")),
        "resolution": float(value("MAP_RESOLUTION")),
        "lineOffset": float(value("LINE_PROJECTION_OFFSET")),
        "sampleOffset": float(value("SAMPLE_PROJECTION_OFFSET")),
        "radiusKm": float(value("A_AXIS_RADIUS")),
        "projection": value("MAP_PROJECTION_TYPE"),
        "longitudeDirection": value("POSITIVE_LONGITUDE_DIRECTION"),
    }
    expected = {
        "sampleType": "PC_REAL",
        "sampleBits": 32,
        "radiusKm": 1737.4,
        "projection": "EQUIRECTANGULAR",
        "longitudeDirection": "EAST",
    }
    for k, v in expected.items():
        if h[k] != v:
            raise RuntimeError(f"{path.name}: {k} is {h[k]}, expected {v}")
    offset = (h["image"] - 1) * h["recordBytes"]
    if path.stat().st_size != offset + h["lines"] * h["samples"] * 4:
        raise RuntimeError(f"{path.name}: size does not match its header")
    h["offset"] = offset
    return h


def centres(h: dict) -> tuple[np.ndarray, np.ndarray]:
    """Latitude of every line and longitude (0-360 E) of every sample, pixel centres."""
    lat = (h["lineOffset"] - np.arange(h["lines"])) / h["resolution"]
    lon = (np.arange(h["samples"]) - h["sampleOffset"]) / h["resolution"]
    return lat, np.mod(lon, 360.0)


def accumulate(band: str, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """Sum and count of every valid source pixel whose centre falls in each cell of a
    width x height grid (column 0 at -180 deg, row 0 at +90 deg). Each output cell averages
    about (76 * 360 / width)^2 source pixels: area averaging, never decimation."""
    total = np.zeros(height * width)
    count = np.zeros(height * width)
    for tile in TILES:
        path = tile_path(band, tile)
        h = header(path)
        lat, lon = centres(h)
        col = np.floor(np.mod(lon + 180.0, 360.0) * width / 360.0).astype(np.int64) % width
        row_all = np.clip(np.floor((90.0 - lat) * height / 180.0).astype(np.int64), 0, height - 1)
        data = np.memmap(path, dtype="<f4", mode="r", offset=h["offset"], shape=(h["lines"], h["samples"]))
        bits = np.memmap(path, dtype="<u4", mode="r", offset=h["offset"], shape=(h["lines"], h["samples"]))
        for l0 in range(0, h["lines"], LINES_PER_CHUNK):
            l1 = min(h["lines"], l0 + LINES_PER_CHUNK)
            v = np.asarray(data[l0:l1], dtype=np.float64)
            ok = (np.asarray(bits[l0:l1]) != MISSING_BITS) & np.isfinite(v)
            rows = row_all[l0:l1]
            index = (rows[:, None] * width + col[None, :])[ok]
            total += np.bincount(index, weights=v[ok], minlength=height * width)
            count += np.bincount(index, minlength=height * width)
        print(f"  {band} {tile}", flush=True)
    return total.reshape(height, width), count.reshape(height, width)
