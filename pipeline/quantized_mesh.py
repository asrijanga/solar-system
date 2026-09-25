"""Cesium quantized-mesh 1.0 terrain tiles for the Moon (SS-10), from measured elevation.

Format: https://github.com/CesiumGS/quantized-mesh (header, zig-zag delta u/v/height,
high-water-mark indices, edge lists). Geographic tiling (EPSG:4326, TMS: y = 0 at the south),
two tiles at level 0. Positions are body-fixed MOON_ME metres on the 1737.4 km sphere plus
the measured height, the frame LDEM_64 is in (pipeline/terrain.py). Which sources and levels
are built where is pipeline/terrain_tiles.py's choice.
"""

from __future__ import annotations

import json
import math
import struct
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


class Region:
    """A finer measured grid over part of the Moon (LOLA LDEM_512, 59 m), used where it exists.

    `rows` holds km heights for latitudes lat_top downwards at 512 px/deg, pixel-registered,
    first column at lon_west. Outside it, callers fall back to the global grid.
    """

    def __init__(self, rows: np.ndarray, lat_top: float, lon_west: float, ppd: int = 512) -> None:
        self.rows, self.lat_top, self.lon_west, self.ppd = rows, lat_top, lon_west, ppd
        self.lat_bottom = lat_top - rows.shape[0] / ppd
        self.lon_east = lon_west + rows.shape[1] / ppd

    def contains(self, west: float, south: float, east: float, north: float) -> bool:
        return west >= self.lon_west and east <= self.lon_east and south >= self.lat_bottom and north <= self.lat_top

    def heights_m(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        col = (lon - self.lon_west) * self.ppd - 0.5
        row = (self.lat_top - lat) * self.ppd - 0.5
        h, w = self.rows.shape
        c0 = np.clip(np.floor(col).astype(np.int64), 0, w - 2)
        r0 = np.clip(np.floor(row).astype(np.int64), 0, h - 2)
        fc = np.clip(col - c0, 0, 1)
        fr = np.clip(row - r0, 0, 1)
        g = self.rows
        v = g[r0, c0] * (1 - fc) * (1 - fr) + g[r0, c0 + 1] * fc * (1 - fr) + g[r0 + 1, c0] * (1 - fc) * fr + g[r0 + 1, c0 + 1] * fc * fr
        return v.astype(np.float64) * 1000.0


class Blend:
    """A finer source over a box, blended into a base source across a band at the box's edge.

    Inside the box, `band_deg` or more from its edge, heights are the fine source's; at the
    edge and outside, the base's; linear between. Where the fine source has no measurement
    (NaN: the producer's no-data value), the base's measurement is used instead, never an
    interpolation across the hole.
    """

    def __init__(self, fine: Region, base: Region, box: tuple[float, float, float, float], band_deg: float) -> None:
        self.fine, self.base, self.box, self.band = fine, base, box, band_deg

    def contains(self, west: float, south: float, east: float, north: float) -> bool:
        return self.base.contains(west, south, east, north)

    def weight(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        w, s, e, n = self.box
        inside = np.minimum(np.minimum(lon - w, e - lon), np.minimum(lat - s, n - lat))
        return np.clip(inside / self.band, 0.0, 1.0)

    def heights_m(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        base = self.base.heights_m(lat, lon)
        fine = self.fine.heights_m(lat, lon)
        weight = np.where(np.isnan(fine), 0.0, self.weight(lat, lon))
        return base + weight * (np.nan_to_num(fine) - base)


def ecef(lat: np.ndarray, lon: np.ndarray, h: np.ndarray) -> np.ndarray:
    la = np.radians(lat)
    lo = np.radians(lon)
    r = R_M + h
    return np.stack([r * np.cos(la) * np.cos(lo), r * np.cos(la) * np.sin(lo), r * np.sin(la)], -1)


def enu_to_body(lat: np.ndarray, lon: np.ndarray, e: np.ndarray, n: np.ndarray, u: np.ndarray) -> np.ndarray:
    la = np.radians(lat)
    lo = np.radians(lon)
    east = np.stack([-np.sin(lo), np.cos(lo), np.zeros_like(lo)], -1)
    north = np.stack([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)], -1)
    up = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)
    return e[..., None] * east + n[..., None] * north + u[..., None] * up


def vertex_normals(sample, lat: np.ndarray, lon: np.ndarray, step_m: float) -> np.ndarray:
    """Unit body-frame normals of the measured surface at each vertex.

    Central differences over `step_m` (the tile's vertex spacing, so every level describes the
    surface at its own scale). Offsets are taken as distances on the sphere, not longitude
    increments, so they stay well defined towards the poles. Adjacent tiles evaluate the same
    function at shared vertices, so their normals agree exactly along the edge.
    """
    dlat = np.degrees(step_m / R_M)
    coslat = np.maximum(np.cos(np.radians(lat)), 1e-6)
    dlon = np.degrees(step_m / (R_M * coslat))
    wrap = lambda x: (x + 180.0) % 360.0 - 180.0  # noqa: E731
    he = sample(lat, wrap(lon + dlon)) - sample(lat, wrap(lon - dlon))
    hn = sample(np.minimum(lat + dlat, 90.0), lon) - sample(np.maximum(lat - dlat, -90.0), lon)
    ge = he / (2 * step_m)
    gn = hn / (2 * step_m)
    length = np.sqrt(1 + ge * ge + gn * gn)
    body = enu_to_body(lat, lon, -ge / length, -gn / length, 1 / length)
    pole = np.abs(lat) > 89.9999
    body[pole] = enu_to_body(lat[pole], lon[pole], np.zeros(pole.sum()), np.zeros(pole.sum()), np.ones(pole.sum()))
    return body


def oct_encode(v: np.ndarray) -> np.ndarray:
    """Cesium's 8-bit octahedral normal encoding (AttributeCompression.octEncode)."""
    v = v / np.abs(v).sum(-1, keepdims=True)
    x, y, z = v[..., 0], v[..., 1], v[..., 2]
    sx = np.where(x >= 0, 1.0, -1.0)
    sy = np.where(y >= 0, 1.0, -1.0)
    ox = np.where(z < 0, (1 - np.abs(y)) * sx, x)
    oy = np.where(z < 0, (1 - np.abs(x)) * sy, y)
    return np.stack([np.rint((ox * 0.5 + 0.5) * 255), np.rint((oy * 0.5 + 0.5) * 255)], -1).astype(np.uint8)


def zigzag(values: np.ndarray) -> np.ndarray:
    deltas = np.diff(values.astype(np.int64), prepend=0)
    return ((deltas << 1) ^ (deltas >> 63)).astype(np.uint16)


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    size = 180.0 / (1 << z)
    west = -180.0 + x * size
    south = -90.0 + y * size
    return west, south, west + size, south + size


def encode_tile(km: np.ndarray, z: int, x: int, y: int, grid: int, regions: list[tuple[int, Region | Blend]] = []) -> bytes:  # noqa: B006
    """One tile. `regions` are (lowest level, source), finest first: the first source used at
    this level that covers the whole tile supplies every height; otherwise the global grid."""
    west, south, east, north = tile_bounds(z, x, y)
    t = np.linspace(0.0, 1.0, grid)
    uu, vv = np.meshgrid(t, t)  # vv rows go south -> north
    lon = west + uu * (east - west)
    lat = south + vv * (north - south)
    sample = lambda la, lo: heights_m(km, la, lo)  # noqa: E731
    for level, region in regions:
        if z >= level and region.contains(west, south, east, north):
            sample = region.heights_m
            break
    h = sample(lat, lon)
    step_m = math.radians(north - south) / (grid - 1) * R_M
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
    # Extension 1, octvertexnormals: body-frame unit normals, 2 bytes each.
    normals = vertex_normals(sample, lat.ravel()[order], lon.ravel()[order], step_m)
    payload = oct_encode(normals).tobytes()
    out += struct.pack("<BI", 1, len(payload)) + payload
    return bytes(out)


def build(
    out_dir: Path,
    max_global: int,
    boxes: list[tuple[int, tuple[float, float, float, float]]],
    grid: int,
    regions: list[tuple[int, Region | Blend]] = [],  # noqa: B006
    attribution: str = "LOLA LDEM_64 and LDEM_512 (PDS LRO-L-LOLA-4-GDR-V1.0)",
) -> None:
    """Levels 0..max_global everywhere; then each (max level, box) adds deeper tiles."""
    km = np.asarray(load_source())
    max_box = max([max_global, *[level for level, _ in boxes]])
    available = []
    count = 0
    for z in range(max_box + 1):
        nx, ny = 2 << z, 1 << z
        size = 180.0 / (1 << z)
        if z <= max_global:
            ranges = [((0, nx - 1), (0, ny - 1))]
        else:
            ranges = []
            for level, (w, s_, e, n) in boxes:
                if z <= level:
                    ranges.append(((int((w + 180) // size), int((e + 180) // size)), (int((s_ + 90) // size), int((n + 90) // size))))
        available.append([{"startX": xs[0], "startY": ys[0], "endX": xs[1], "endY": ys[1]} for xs, ys in ranges])
        done = set()
        for xs, ys in ranges:
            for x in range(xs[0], xs[1] + 1):
                for y in range(ys[0], ys[1] + 1):
                    if (x, y) in done:
                        continue
                    done.add((x, y))
                    path = out_dir / str(z) / str(x) / f"{y}.terrain"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(encode_tile(km, z, x, y, grid, regions))
                    count += 1
    layer = {
        "tilejson": "2.1.0",
        "name": "moon-lola",
        "format": "quantized-mesh-1.0",
        "version": "1.0.0",
        "scheme": "tms",
        "projection": "EPSG:4326",
        "bounds": [-180, -90, 180, 90],
        "tiles": ["{z}/{x}/{y}.terrain"],
        "available": available,
        "extensions": ["octvertexnormals"],
        "attribution": attribution,
    }
    (out_dir / "layer.json").write_text(json.dumps(layer, indent=1))
    print(f"{count} tiles in {out_dir}")
