"""Side-by-side crops of candidate lunar imagery products, for the SS-5 product decision.

    uv run python compare_moon_products.py OUT.png

Reads only the rows it needs over HTTP (the source files are strip-organised GeoTIFFs of
4 to 6 GB). Every panel covers the same region and is resampled by area averaging to the
same size. Each panel gets its own linear 0.5-99.5 percentile stretch, so compare shading
and texture, not absolute brightness.
"""

from __future__ import annotations

import math
import sys

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

R = 1737400.0  # metres, as in each product's CRS
BASE = "/vsicurl/https://planetarymaps.usgs.gov/mosaic/"
# Around Copernicus crater (9.62 N, 20.08 W, IAU Gazetteer), east-positive longitude.
LON = (-25.0, -15.0)
LAT = (5.0, 14.0)
PANEL = (560, 504)  # width, height: same aspect as 10 deg x 9 deg at this latitude-free projection

PRODUCTS = [
    ("LRO WAC global mosaic, 100 m (2013)", "Lunar_LRO_LROC-WAC_Mosaic_global_100m_June2013.tif", 0.0),
    ("Clementine UVVIS 750 nm, 118 m (v2.1)", "Lunar_Clementine_UVVIS_750nm_Global_Mosaic_118m_v2.1.tif", 0.0),
    ("Kaguya TC ortho, 64 ppd (v02)", "Lunar_Kaguya_TC_Ortho_Global_64ppd_v02.tif", 0.0),
    ("LOLA 1064 nm albedo, 10 ppd", "Lunar_LRO_LOLA_Albedo_Global_10ppd.tif", 180.0),
]


def x_of(lon_deg: float, lon_0: float) -> float:
    """Equirectangular easting for a longitude, wrapped into the map centred on lon_0."""
    d = (lon_deg - lon_0 + 180.0) % 360.0 - 180.0
    return R * math.radians(d)


def crop(path: str, lon_0: float) -> np.ndarray:
    with rasterio.open(BASE + path) as ds:
        left, right = x_of(LON[0], lon_0), x_of(LON[1], lon_0)
        bottom, top = R * math.radians(LAT[0]), R * math.radians(LAT[1])
        window = from_bounds(left, bottom, right, top, ds.transform)
        data = ds.read(
            1,
            window=window,
            out_shape=(PANEL[1], PANEL[0]),
            resampling=Resampling.average,
            masked=True,
        ).astype("float64")
    values = data.compressed()
    lo, hi = np.percentile(values, [0.5, 99.5])
    scaled = np.clip((data.filled(lo) - lo) / (hi - lo), 0, 1)
    return (scaled * 255).astype("uint8")


def main(out: str) -> None:
    label_h = 28
    sheet = Image.new("L", (PANEL[0] * 2, (PANEL[1] + label_h) * 2), 0)
    draw = ImageDraw.Draw(sheet)
    for i, (title, path, lon_0) in enumerate(PRODUCTS):
        print(f"reading {title} ...", flush=True)
        panel = Image.fromarray(crop(path, lon_0), mode="L")
        x = (i % 2) * PANEL[0]
        y = (i // 2) * (PANEL[1] + label_h)
        draw.text((x + 8, y + 8), f"{'ABCD'[i]}. {title}", fill=255)
        sheet.paste(panel, (x, y + label_h))
    sheet.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv[1])
