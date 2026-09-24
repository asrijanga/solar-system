"""Whole-Moon previews of the two remaining candidates, for judging mosaic seams.

Nearest-neighbour row sampling (reads about 1 row in 45), so this is a preview only;
the real pipeline averages every source pixel.
"""
import sys

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.enums import Resampling

BASE = "/vsicurl/https://planetarymaps.usgs.gov/mosaic/"
W, H = 1024, 512
ITEMS = [
    ("A. LRO WAC global mosaic, 100 m", "Lunar_LRO_LROC-WAC_Mosaic_global_100m_June2013.tif"),
    ("B. Clementine UVVIS 750 nm, 118 m", "Lunar_Clementine_UVVIS_750nm_Global_Mosaic_118m_v2.1.tif"),
]
sheet = Image.new("L", (W, (H + 24) * len(ITEMS)), 0)
draw = ImageDraw.Draw(sheet)
for i, (title, path) in enumerate(ITEMS):
    print("reading", title, flush=True)
    with rasterio.open(BASE + path) as ds:
        a = ds.read(1, out_shape=(H, W), resampling=Resampling.nearest, masked=True).astype(float)
    lo, hi = np.percentile(a.compressed(), [0.5, 99.5])
    img = (np.clip((a.filled(0) - lo) / (hi - lo), 0, 1) * 255).astype("uint8")
    y = i * (H + 24)
    draw.text((8, y + 6), title + "  (longitude -180 to 180, east right; preview)", fill=255)
    sheet.paste(Image.fromarray(img, mode="L"), (0, y + 24))
sheet.save(sys.argv[1])
print("wrote", sys.argv[1])
