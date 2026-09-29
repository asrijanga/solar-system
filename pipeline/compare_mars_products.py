"""Side-by-side crops of candidate Mars albedo products, for SS-14 W3's map decision.

    uv run python compare_mars_products.py OUT.png

Python for GDAL's remote reads (CLAUDE.md, Stack). Reads only the rows it needs over HTTP: the
sources are strip-organised GeoTIFFs of up to 12.7 GB on planetarymaps.usgs.gov. Every panel
covers the same region and is resampled by area averaging to the same size, from the product's
own grid (east-positive longitude, as each header states).

Each albedo panel gets its own linear 0.5-99.5 percentile stretch, so compare shading and
texture, not absolute brightness. The relief panel is not a candidate. It is the HRSC-MOLA DEM,
lit from the west at 30 degrees by this script, only so that shading baked into a candidate
can be recognised: a slope that is bright or dark in a candidate the way it is here.
"""

from __future__ import annotations

import math
import sys

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

BASE = "/vsicurl/https://planetarymaps.usgs.gov/mosaic/"
# Central Valles Marineris: Candor, Ophir and Melas Chasmata. Canyon walls several km high face
# north and south, so any shading baked into a map shows on them.
LON = (-78.0, -66.0)
LAT = (-12.0, -3.0)
PANEL = (720, 540)  # 12 deg x 9 deg

PRODUCTS = [
    ("Viking MDIM 2.1 colour, 232 m", "Mars_Viking_MDIM21_ClrMosaic_global_232m.tif"),
    ("MGS TES Lambert albedo, 7.4 km", "Mars_MGS_TES_Albedo_mosaic_global_7410m.tif"),
]
DEM = ("Relief for reference (HRSC-MOLA DEM, lit from the west)", "Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif")


def bounds(ds) -> tuple[float, float, float, float]:
    """Window bounds in the product's own CRS: degrees, or metres on its own sphere."""
    if ds.crs.is_geographic:
        return LON[0], LAT[0], LON[1], LAT[1]
    r = ds.crs.to_dict().get("R") or float(ds.crs.to_wkt().split("SPHEROID[")[1].split(",")[1])
    k = math.pi / 180 * r
    return LON[0] * k, LAT[0] * k, LON[1] * k, LAT[1] * k


def read(path: str) -> np.ma.MaskedArray:
    with rasterio.open(BASE + path) as ds:
        window = from_bounds(*bounds(ds), ds.transform)
        return ds.read(
            window=window,
            out_shape=(ds.count, PANEL[1], PANEL[0]),
            resampling=Resampling.average,
            masked=True,
        ).astype("float64")


def stretch(data: np.ma.MaskedArray) -> np.ndarray:
    values = data.compressed()
    lo, hi = np.percentile(values, [0.5, 99.5])
    return (np.clip((data.filled(lo) - lo) / (hi - lo), 0, 1) * 255).astype("uint8")


def relief(dem: np.ma.MaskedArray) -> np.ndarray:
    h = dem[0].filled(float(dem.mean()))
    dx = 12.0 / PANEL[0] * math.pi / 180 * 3396190 * math.cos(math.radians(7.5))
    dy = 9.0 / PANEL[1] * math.pi / 180 * 3396190
    gy, gx = np.gradient(h, dy, dx)
    # Sun from the west (-x) at 30 degrees elevation; rows run north to south, so -gy is north.
    sun = np.array([-math.cos(math.radians(30)), 0.0, math.sin(math.radians(30))])
    n = np.stack([-gx, gy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=0)
    shade = np.clip(np.tensordot(sun, n, axes=1), 0, 1)
    return (shade / shade.max() * 255).astype("uint8")


def main(out: str) -> None:
    panels = []
    for label, path in PRODUCTS:
        data = read(path)
        rgb = np.stack([stretch(b) for b in data]) if data.shape[0] == 3 else np.repeat(stretch(data[0])[None], 3, 0)
        panels.append((label, rgb.transpose(1, 2, 0)))
        print(f"{label}: {data.shape[0]} band(s), {data.count()} valid values")
    shade = relief(read(DEM[1]))
    panels.append((DEM[0], np.repeat(shade[..., None], 3, 2)))

    header = 26
    sheet = Image.new("RGB", (PANEL[0], len(panels) * (PANEL[1] + header)), "black")
    draw = ImageDraw.Draw(sheet)
    for i, (label, rgb) in enumerate(panels):
        y = i * (PANEL[1] + header)
        draw.text((6, y + 6), f"{label}: 66-78 W, 3-12 S", fill="white")
        sheet.paste(Image.fromarray(rgb), (0, y + header))
    sheet.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv[1])
