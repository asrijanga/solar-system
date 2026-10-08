"""MESSENGER MDIS map tiles (MD3, MDR) streamed from PDS Imaging, checked against their published
MD5 and reduced as they arrive (docs/stories/SS-16.md, W3).

Each tile is a PDS3 band-sequential cube of little-endian float32 (its detached label: SAMPLE_TYPE
PC_REAL, BAND_STORAGE_TYPE BAND_SEQUENTIAL). A whole MD3 tile is up to 371 MB and the 100 tiles
about 27 GB, more than this machine's disk, so each file is read once, in order, hashed as it
streams, and only its three colour bands are kept, block-averaged by BLOCK pixels into a small
array cached in pipeline/.cache/mercury/. A tile whose MD5 does not match is discarded.

Colour bands, by the labels' BAND_NAME: MD3 bands 1-3 are "WAC FILTER 6 430 BP 40", "WAC FILTER 7
750 BP 5", "WAC FILTER 9 1000 BP 15"; MDR bands 1, 5 and 8 are the same three filters. Values are
"Reflectance" (the label's UNIT): I/F corrected to i = 30, e = 0, g = 30 deg (MDIS_CDR_RDRSIS.PDF
2.4). Missing pixels are any value not finite or not above zero (the archive's NULL is a large
negative float).
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.request
from pathlib import Path

import numpy as np

from download import CACHE, USER_AGENT

SOURCES = json.loads((Path(__file__).resolve().parent / "mercury_sources.json").read_text())
TILE_CACHE = CACHE / "mercury"
CHUNK = 1 << 22
ATTEMPTS = 4

# Which of a cube's bands are 430, 750 and 1000 nm (0-based), and the block that brings each tile
# to 32 px/deg, about 3 times finer than the website's 22.76 px/deg texture.
BANDS = {"md3": (0, 1, 2), "mdr": (0, 4, 7)}


def label(path: str) -> dict:
    """The PDS3 label's keywords this module needs, read as text."""
    request = urllib.request.Request(SOURCES["base"] + path + ".LBL", headers={"User-Agent": USER_AGENT})
    text = urllib.request.urlopen(request, timeout=120).read().decode("latin1").replace("\r", "")
    def value(key: str) -> str:
        m = re.search(rf"^\s*{key}\s*=\s*\"?([^\"\n<]+)", text, re.M)
        if m is None:
            raise ValueError(f"{path}.LBL has no {key}")
        return m.group(1).strip()
    out = {
        "lines": int(value("LINES")),
        "samples": int(value("LINE_SAMPLES")),
        "bands": int(value("BANDS")),
        "recordBytes": int(value("RECORD_BYTES")),
        "sampleType": value("SAMPLE_TYPE"),
        "storage": value("BAND_STORAGE_TYPE"),
        "projection": value("MAP_PROJECTION_TYPE"),
        "centerLatitude": float(value("CENTER_LATITUDE")),
        "centerLongitude": float(value("CENTER_LONGITUDE")),
        "lineOffset": float(value("LINE_PROJECTION_OFFSET")),
        "sampleOffset": float(value("SAMPLE_PROJECTION_OFFSET")),
        "mapScaleM": float(value("MAP_SCALE")),
        "resolution": float(value("MAP_RESOLUTION")),
        "radiusKm": float(value("A_AXIS_RADIUS")),
        "maximumLatitude": float(value("MAXIMUM_LATITUDE")),
        "minimumLatitude": float(value("MINIMUM_LATITUDE")),
    }
    if out["sampleType"] != "PC_REAL" or out["storage"] != "BAND_SEQUENTIAL":
        raise ValueError(f"{path}: {out['sampleType']} {out['storage']}, not PC_REAL BAND_SEQUENTIAL")
    if out["recordBytes"] != out["samples"] * 4:
        raise ValueError(f"{path}: RECORD_BYTES {out['recordBytes']} is not 4 x {out['samples']}")
    return out


def block_of(meta: dict) -> int:
    return max(1, int(round(meta["resolution"] / 32)))


def reduce_tile(kind: str, entry: dict) -> dict:
    """The tile's three colour bands block-averaged, cached; streams and MD5-checks the file."""
    TILE_CACHE.mkdir(parents=True, exist_ok=True)
    name = Path(entry["path"]).name
    cached = TILE_CACHE / f"{name}.npz"
    if cached.exists():
        with np.load(cached, allow_pickle=False) as z:
            if str(z["md5"]) == entry["imgMd5"]:
                return {"meta": json.loads(str(z["meta"])), "bands": z["bands"]}
    meta = label(entry["path"])
    k = block_of(meta)
    lines, samples = meta["lines"], meta["samples"]
    rows_out, cols_out = lines // k, samples // k
    wanted = BANDS[kind]
    out = np.full((3, rows_out, cols_out), np.nan, np.float32)
    band_bytes = lines * meta["recordBytes"]
    for attempt in range(1, ATTEMPTS + 1):
        try:
            md5 = hashlib.md5()
            request = urllib.request.Request(SOURCES["base"] + entry["path"] + ".IMG", headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=300) as response:
                buffer = b""
                offset = 0  # bytes of the file consumed into whole rows
                block = []
                while True:
                    chunk = response.read(CHUNK)
                    if not chunk:
                        break
                    md5.update(chunk)
                    buffer += chunk
                    rows = len(buffer) // meta["recordBytes"]
                    if rows == 0:
                        continue
                    data = buffer[: rows * meta["recordBytes"]]
                    buffer = buffer[rows * meta["recordBytes"] :]
                    first = offset // meta["recordBytes"]
                    offset += rows * meta["recordBytes"]
                    arr = np.frombuffer(data, "<f4").reshape(rows, samples)
                    for r in range(rows):
                        row = first + r
                        band, line = divmod(row, lines)
                        if band not in wanted:
                            continue
                        block.append(arr[r])
                        if len(block) == k:
                            b = np.stack(block)[:, : cols_out * k].astype(np.float64)
                            b[~np.isfinite(b) | (b <= 0)] = np.nan
                            with np.errstate(invalid="ignore"):
                                mean = np.nanmean(b.reshape(k, cols_out, k), axis=(0, 2))
                            out[wanted.index(band), line // k] = mean
                            block = []
                        if line == lines - 1:
                            block = []
            if offset < band_bytes * meta["bands"]:
                raise OSError(f"{name}: stream ended at {offset} of {band_bytes * meta['bands']} bytes")
            if md5.hexdigest() != entry["imgMd5"]:
                raise OSError(f"{name}: md5 {md5.hexdigest()}, published {entry['imgMd5']}")
            break
        except OSError as error:
            if attempt == ATTEMPTS:
                raise
            print(f"  {name}: attempt {attempt} failed ({error}); retrying", flush=True)
            time.sleep(2**attempt)
    meta["block"] = k
    np.savez_compressed(cached, bands=out, meta=json.dumps(meta), md5=entry["imgMd5"])
    return {"meta": meta, "bands": out}
