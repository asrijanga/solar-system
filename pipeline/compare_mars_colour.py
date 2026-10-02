"""Side-by-side of Mars colour candidates, for SS-14 W3 part 2's colour decision.

    uv run python compare_mars_colour.py OUT.png

Python for GDAL's reprojection (CLAUDE.md, Stack). Two views:
- the hemisphere centred on 270 E, as HRSC's own orthographic face shows it (about phone size);
- central Valles Marineris close up, beside the relief, as in ss14-albedo-candidates.png.

Panels:
1. Viking MDIM 2.1 colour mosaic (USGS), as published: a composite, not calibrated reflectance.
2. HRSC high-altitude colour mosaic (Michael et al. 2025; FU Berlin refubium-40624), its own
   brightness and colour: reflectance in blue 440, green 530, red 750 and infrared 970 nm, each
   calibrated to one observation area (paper, section 2). Shading as acquired.
3. The proposal: HRSC's colour ratios, which cancel most shading, on OMEGA's measured brightness
   carried from 1.08 um to 530 nm by HRSC's own 530/970 ratio.
4. The DEM relief, for recognising baked-in shading only.

Display colour as the Moon's (core/moonColour.ts): the spectrum linear between the bands and flat
beyond, lit by a 5772 K blackbody, CIE 1931 to linear sRGB, white-balanced to sunlight. The
weights below were computed with that code for HRSC's bands. Panels 2 and 3 share one exposure,
so their brightness compares; panel 1 keeps its own stretch.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject

CACHE = Path(__file__).resolve().parent / ".cache"
HRSC = CACHE / "hrsc"
USGS = "/vsicurl/https://planetarymaps.usgs.gov/mosaic/"
# Linear sRGB per unit reflectance in [440, 530, 750, 970] nm (core/moonColour.ts's method).
W = np.array(
    [
        [-0.021578419877224392, 0.5444103893014972, 0.47716811517258384, 0.0],
        [0.009620704436502108, 0.9243104912209408, 0.06606865793070492, 0.0],
        [0.9260993932114175, 0.09425386461015922, -0.020353240264183788, 0.0],
    ]
)
BANDS = ("03-bl", "02-gr", "01-re", "04-ir")
OMEGA = CACHE / "mars-omega-albedo-r1080.img"
SPHERE = 3396000.0
CLOSE = ((-78.0, -66.0), (-12.0, -3.0), (720, 540))


def lonlat_grid(lon, lat, size):
    crs = CRS.from_proj4(f"+proj=longlat +R={SPHERE} +no_defs")
    return crs, from_bounds(lon[0], lat[0], lon[1], lat[1], size[0], size[1])


def warp(src_path: str, dst_crs, dst_transform, size, bands=None) -> np.ndarray:
    with rasterio.open(src_path) as src:
        idx = bands or list(range(1, src.count + 1))
        out = np.full((len(idx), size[1], size[0]), np.nan, dtype=np.float64)
        for i, b in enumerate(idx):
            reproject(
                rasterio.band(src, b),
                out[i],
                dst_transform=dst_transform,
                dst_crs=dst_crs,
                dst_nodata=np.nan,
                src_nodata=src.nodata,
                resampling=Resampling.average,
            )
    return out


def hrsc(face: str, dst_crs, dst_transform, size) -> np.ndarray:
    stack = [warp(str(HRSC / f"{b}-face_{face}.tif"), dst_crs, dst_transform, size)[0] for b in BANDS]
    a = np.stack(stack)
    a[(a < -1e30) | (a <= 0)] = np.nan
    return a


def omega(dst_crs, dst_transform, size) -> np.ndarray:
    dn = np.fromfile(OMEGA, dtype="<i2").reshape(7200, 14400)
    a = np.where(dn == -32768, np.nan, 0.52414565669 + 1.4522365285e-05 * dn.astype(np.float64)).astype(np.float32)
    src_crs = CRS.from_proj4(f"+proj=longlat +R={SPHERE} +no_defs")
    src_transform = from_bounds(-180, -90, 180, 90, 14400, 7200)
    out = np.full((size[1], size[0]), np.nan, dtype=np.float32)
    reproject(a, out, src_transform=src_transform, src_crs=src_crs, dst_transform=dst_transform, dst_crs=dst_crs, src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.average)
    return out.astype(np.float64)


def to_srgb(linear: np.ndarray) -> np.ndarray:
    x = np.clip(linear, 0, 1)
    s = np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return (np.nan_to_num(s) * 255 + 0.5).astype(np.uint8)


def display(bands: np.ndarray, green: np.ndarray, exposure: float) -> np.ndarray:
    """Linear sRGB = exposure x green-band reflectance x tint, tint from the ratios to 530 nm."""
    ratios = bands / bands[1]
    tint = np.tensordot(W, np.nan_to_num(ratios), axes=1)
    return to_srgb(exposure * green[None] * tint).transpose(1, 2, 0)


def read_remote(path: str, lon, lat, size, resampling, metres_per_degree: float | None) -> tuple[np.ndarray, object, object]:
    """Reads only the region it needs, at about twice the output size (out_shape lets GDAL use the
    file's overviews where it has them), for a local reprojection afterwards."""
    from rasterio.windows import from_bounds as window_from_bounds

    with rasterio.open(path) as src:
        k = metres_per_degree or 1.0
        window = window_from_bounds(lon[0] * k, lat[0] * k, lon[1] * k, lat[1] * k, src.transform)
        shape = (src.count, size[1] * 2, size[0] * 2)
        data = src.read(window=window, out_shape=shape, resampling=resampling, masked=True).astype(np.float64).filled(np.nan)
        transform = src.window_transform(window) * rasterio.Affine.scale(window.width / shape[2], window.height / shape[1])
        return data, transform, src.crs


def local_warp(data, src_transform, src_crs, dst_crs, dst_transform, size) -> np.ndarray:
    out = np.full((data.shape[0], size[1], size[0]), np.nan)
    for i in range(data.shape[0]):
        reproject(data[i], out[i], src_transform=src_transform, src_crs=src_crs, src_nodata=np.nan, dst_transform=dst_transform, dst_crs=dst_crs, dst_nodata=np.nan, resampling=Resampling.average)
    return out


def viking(dst_crs, dst_transform, size, lon, lat, resampling) -> np.ndarray:
    """The file is 12.7 GB of full-width strips with no overviews: the hemisphere is read by
    decimation (nearest), the close-up by area average."""
    data, transform, crs = read_remote(USGS + "Mars_Viking_MDIM21_ClrMosaic_global_232m.tif", lon, lat, size, resampling, math.pi / 180 * 3396190.0)
    out = local_warp(data, transform, crs, dst_crs, dst_transform, size)
    bands = []
    for b in out:
        lo, hi = np.nanpercentile(b, [0.5, 99.5])
        bands.append(np.clip((np.nan_to_num(b, nan=lo) - lo) / (hi - lo), 0, 1))
    return (np.stack(bands) * 255).astype(np.uint8).transpose(1, 2, 0)


def relief(dst_crs, dst_transform, size, lon, lat) -> np.ndarray:
    """The 11.4 GB DEM read through its overviews, then lit from the west at 30 degrees."""
    data, transform, crs = read_remote(USGS + "Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif", lon, lat, size, Resampling.average, None)
    dem = local_warp(data, transform, crs, dst_crs, dst_transform, size)[0]
    h = np.nan_to_num(dem, nan=float(np.nanmean(dem)))
    px = abs(dst_transform.a) * (math.pi / 180 * SPHERE if dst_crs.is_geographic else 1)
    gy, gx = np.gradient(h, px, px)
    sun = np.array([-math.cos(math.radians(30)), 0.0, math.sin(math.radians(30))])
    n = np.stack([-gx, gy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=0)
    shade = np.clip(np.tensordot(sun, n, axes=1), 0, 1)
    return np.repeat((shade / shade.max() * 255).astype(np.uint8)[..., None], 3, 2)


def views(dst_crs, dst_transform, size, face: str, lon, lat, resampling) -> list[np.ndarray]:
    import time

    t0 = time.time()
    h = hrsc(face, dst_crs, dst_transform, size)
    om = omega(dst_crs, dst_transform, size)
    print(f"  HRSC and OMEGA {time.time() - t0:.0f} s", flush=True)
    # OMEGA carried to 530 nm by HRSC's own green/infrared ratio (970 nm, next to OMEGA's 1080).
    green_from_omega = om * h[1] / h[3]
    exposure = 0.5 / float(np.nanmedian(h[1]))
    print(f"  median green: HRSC {np.nanmedian(h[1]):.4f}, OMEGA-carried {np.nanmedian(green_from_omega):.4f}", flush=True)
    v = viking(dst_crs, dst_transform, size, lon, lat, resampling)
    print(f"  Viking {time.time() - t0:.0f} s", flush=True)
    r = relief(dst_crs, dst_transform, size, lon, lat)
    print(f"  relief {time.time() - t0:.0f} s", flush=True)
    return [v, display(h, h[1], exposure), display(h, green_from_omega, exposure), r]


def main(out: str) -> None:
    labels = [
        "1. Viking MDIM 2.1 colour (as published; own stretch)",
        "2. HRSC colour mosaic (own brightness and colour)",
        "3. Proposal: HRSC colour ratios on OMEGA brightness",
        "4. Relief for reference (DEM lit from the west)",
    ]
    rows = []
    # The hemisphere centred on 270 E, in HRSC's own orthographic projection.
    with rasterio.open(HRSC / "01-re-face_270.tif") as f:
        ortho_crs, ortho_size = f.crs, (700, 700)
        ortho_transform = from_bounds(*f.bounds, *ortho_size)
    print("hemisphere 270 E", flush=True)
    rows.append(views(ortho_crs, ortho_transform, ortho_size, "270", (-140.0, -40.0), (-50.0, 50.0), Resampling.nearest))
    print("Valles Marineris", flush=True)
    crs, transform = lonlat_grid(*CLOSE)
    rows.append(views(crs, transform, CLOSE[2], "270", CLOSE[0], CLOSE[1], Resampling.average))

    header = 24
    width = 700 + 720
    height = 4 * (header + 700)
    sheet = Image.new("RGB", (width, height), "black")
    draw = ImageDraw.Draw(sheet)
    for i, label in enumerate(labels):
        y = i * (header + 700)
        draw.text((6, y + 5), f"{label} | left: hemisphere centred 270 E; right: 66-78 W, 3-12 S", fill="white")
        sheet.paste(Image.fromarray(rows[0][i]), (0, y + header))
        sheet.paste(Image.fromarray(rows[1][i]), (700, y + header))
    sheet.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv[1])
