"""Cesium quantized-mesh 1.0 terrain tiles for the Moon, from LOLA (SS-10 spike).

Format: https://github.com/CesiumGS/quantized-mesh (header, zig-zag delta u/v/height,
high-water-mark indices, edge lists). Geographic tiling (EPSG:4326, TMS: y = 0 at the south),
two tiles at level 0. Positions are body-fixed MOON_ME metres on the 1737.4 km sphere plus
the LOLA height, the frame LDEM_64 is in (pipeline/terrain.py).

Spike scope: levels 0-3 everywhere, deeper levels only inside a box, from LDEM_64 (474 m).
"""

from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

import numpy as np

from terrain import SRC_H, SRC_W, load_source

R_M = 1737400.0
MAX = 32767


def heights_m(km: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Bilinear LOLA height (m) at planetocentric lat/lon (deg, lon -180..180 east).

    `km` has column 0 at -180 deg (load_source rolls the source), pixel-registered.
    """
    col = (lon + 180.0) * (SRC_W / 360.0) - 0.5
    row = (90.0 - lat) * (SRC_H / 180.0) - 0.5
    c0 = np.floor(col).astype(np.int64)
    r0 = np.clip(np.floor(row).astype(np.int64), 0, SRC_H - 2)
    fc = col - c0
    fr = np.clip(row - r0, 0, 1)
    c0 %= SRC_W
    c1 = (c0 + 1) % SRC_W
    v = (
        km[r0, c0] * (1 - fc) * (1 - fr)
        + km[r0, c1] * fc * (1 - fr)
        + km[r0 + 1, c0] * (1 - fc) * fr
        + km[r0 + 1, c1] * fc * fr
    )
    return v.astype(np.float64) * 1000.0


def ecef(lat: np.ndarray, lon: np.ndarray, h: np.ndarray) -> np.ndarray:
    la = np.radians(lat)
    lo = np.radians(lon)
    r = R_M + h
    return np.stack([r * np.cos(la) * np.cos(lo), r * np.cos(la) * np.sin(lo), r * np.sin(la)], -1)


def zigzag(values: np.ndarray) -> np.ndarray:
    deltas = np.diff(values.astype(np.int64), prepend=0)
    return ((deltas << 1) ^ (deltas >> 63)).astype(np.uint16)


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    size = 180.0 / (1 << z)
    west = -180.0 + x * size
    south = -90.0 + y * size
    return west, south, west + size, south + size


def encode_tile(km: np.ndarray, z: int, x: int, y: int, grid: int) -> bytes:
    west, south, east, north = tile_bounds(z, x, y)
    t = np.linspace(0.0, 1.0, grid)
    uu, vv = np.meshgrid(t, t)  # vv rows go south -> north
    lon = west + uu * (east - west)
    lat = south + vv * (north - south)
    h = heights_m(km, lat, lon)
    hmin, hmax = float(h.min()), float(h.max())
    span = max(hmax - hmin, 1.0)

    # Triangles, counter-clockwise in (east, north): outward-facing.
    idx = np.arange(grid * grid).reshape(grid, grid)
    a = idx[:-1, :-1].ravel()
    b = idx[:-1, 1:].ravel()
    c = idx[1:, 1:].ravel()
    d = idx[1:, :-1].ravel()
    tris = np.stack([np.stack([a, b, c], 1), np.stack([a, c, d], 1)], 1).reshape(-1)

    # Reorder vertices by first use, as high-water-mark encoding requires.
    order = []
    seen = np.full(grid * grid, -1, dtype=np.int64)
    for i in tris:
        if seen[i] < 0:
            seen[i] = len(order)
            order.append(i)
    order = np.array(order)
    remapped = seen[tris]
    highest = 0
    codes = np.empty_like(remapped)
    for k, i in enumerate(remapped):
        codes[k] = highest - i
        if i == highest:
            highest += 1

    u = np.rint(uu.ravel()[order] * MAX).astype(np.int64)
    v = np.rint(vv.ravel()[order] * MAX).astype(np.int64)
    hq = np.rint((h.ravel()[order] - hmin) / span * MAX).astype(np.int64)

    positions = ecef(lat.ravel()[order], lon.ravel()[order], h.ravel()[order])
    lo_, hi_ = positions.min(0), positions.max(0)
    centre = (lo_ + hi_) / 2
    radius = float(np.sqrt(((positions - centre) ** 2).sum(1)).max())
    mid = ecef(np.array([(south + north) / 2]), np.array([(west + east) / 2]), np.array([(hmin + hmax) / 2]))[0]

    out = bytearray()
    out += struct.pack("<3d", *mid)
    out += struct.pack("<2f", hmin, hmax)
    out += struct.pack("<4d", *centre, radius)
    out += struct.pack("<3d", *centre)  # horizon occlusion point: not used by the renderer
    n = len(order)
    out += struct.pack("<I", n)
    for arr in (u, v, hq):
        out += zigzag(arr).tobytes()
    if len(out) % 2:
        out += b"\0"
    out += struct.pack("<I", len(codes) // 3)
    out += codes.astype(np.uint16).tobytes()
    for edge in (u == 0, v == 0, u == MAX, v == MAX):  # west, south, east, north
        ids = np.nonzero(edge)[0].astype(np.uint16)
        out += struct.pack("<I", len(ids)) + ids.tobytes()
    return bytes(out)


def build(out_dir: Path, max_global: int, box: tuple[float, float, float, float], max_box: int, grid: int) -> None:
    km = np.asarray(load_source())
    available = []
    count = 0
    for z in range(max_box + 1):
        nx, ny = 2 << z, 1 << z
        size = 180.0 / (1 << z)
        if z <= max_global:
            xs, ys = (0, nx - 1), (0, ny - 1)
        else:
            w, s, e, n = box
            xs = (int((w + 180) // size), int((e + 180) // size))
            ys = (int((s + 90) // size), int((n + 90) // size))
        available.append([{"startX": xs[0], "startY": ys[0], "endX": xs[1], "endY": ys[1]}])
        for x in range(xs[0], xs[1] + 1):
            for y in range(ys[0], ys[1] + 1):
                path = out_dir / str(z) / str(x) / f"{y}.terrain"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(encode_tile(km, z, x, y, grid))
                count += 1
    layer = {
        "tilejson": "2.1.0",
        "name": "moon-lola-ldem64-spike",
        "format": "quantized-mesh-1.0",
        "version": "1.0.0",
        "scheme": "tms",
        "projection": "EPSG:4326",
        "bounds": [-180, -90, 180, 90],
        "tiles": ["{z}/{x}/{y}.terrain"],
        "available": available,
        "attribution": "LOLA LDEM_64 (PDS LRO-L-LOLA-4-GDR-V1.0)",
    }
    (out_dir / "layer.json").write_text(json.dumps(layer, indent=1))
    print(f"{count} tiles in {out_dir}")


if __name__ == "__main__":
    out = Path(sys.argv[1])
    # Around Albategnius (4.0 E, 11.2 S): a 12 x 12 degree box.
    build(out, max_global=3, box=(-2.0, -17.0, 10.0, -5.0), max_box=7, grid=65)
