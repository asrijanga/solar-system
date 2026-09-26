"""Earth as seen from the Moon at the app's first-quarter epoch, from each candidate product, for
the SS-20 product decision (docs/data/earth.md). Python because the Himawari files are bzip2
Himawari Standard Data and the maths is whole-image numpy.

    uv run python compare_earth_products.py .cache/earth OUT.png

CACHE holds the downloads docs/data/earth.md lists:
    bm-200401.jpg          Blue Marble Next Generation, January 2004, no shaded relief (NASA)
    viirs-20260126.jpg     VIIRS NOAA-20 corrected reflectance, 2026-01-26 (NASA GIBS WMS)
    ahi/HS_H09_20260126_0500_B0[1-4]_FLDK_*.DAT.bz2   Himawari-9 AHI full disc, 05:00 UTC

Every panel is drawn with the app's own photometry (core/photometry.ts): display = exposure ·
I/F / r², exposure 2, no tone mapping, then sRGB. The two visual products (Blue Marble, VIIRS) are
not calibrated reflectance: their published pixel values, linearised from sRGB, are taken as the
reflectance and multiplied by the Sun's cosine. Himawari is calibrated: its albedo (JMA's
radiance-to-albedo coefficient) is already I/F at that instant, with its own terminator, so it is
shown as measured.

Where a product has no value and the Sun is up (or in twilight, to 6 degrees below the horizon)
the panel is dark red; past twilight it is night and drawn dark.

The view is orthographic from the Moon's direction (Earth spans 1.9 degrees; perspective is
negligible), centred on the sub-Moon point, north up. Sub-Moon and sub-solar points come from the
committed ephemeris (public/data/moon/ephemeris.json) and Greenwich mean sidereal time (IAU 1982),
good to about 0.01 degree: ample for a comparison. The app itself will take Earth's orientation
from SPICE.
"""

from __future__ import annotations

import glob
import json
import math
import os
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from earth import AHI_FACTOR, ahi_sample, read_ahi

ROOT = os.path.join(os.path.dirname(__file__), "..")
EXPOSURE = 2.0  # core/photometry.ts EXPOSURE
EPOCH = "2026-01-26T05:00:00"
PANEL = 420
AU_KM = 149597870.7
# Earth's geometric albedo 0.434 (NASA Earth fact sheet) as a Lambert sphere: 1.5 p (SS-13b).
LAMBERT = 1.5 * 0.434
# Himawari segments are averaged down to 2 km, far finer than Earth ever is on screen.
AHI_FACTOR = {"B01": 2, "B02": 2, "B03": 4, "B04": 2}


def gmst_deg(utc: str) -> float:
    days = (datetime.fromisoformat(utc) - datetime(2000, 1, 1, 12)).total_seconds() / 86400
    return (280.46061837 + 360.98564736629 * days) % 360


def lonlat_of(v: list[float], gmst: float) -> tuple[float, float]:
    ra = math.degrees(math.atan2(v[1], v[0]))
    dec = math.degrees(math.asin(v[2] / math.hypot(*v)))
    return ((ra - gmst + 180) % 360) - 180, dec


def unit(lon: float, lat: float) -> np.ndarray:
    lo, la = math.radians(lon), math.radians(lat)
    return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])


def view(sub_moon: tuple[float, float]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unit-disc pixels of the panel as body-fixed points: lon, lat (degrees), and a mask."""
    c = unit(*sub_moon)
    east = np.cross([0.0, 0.0, 1.0], c)
    east /= np.linalg.norm(east)
    north = np.cross(c, east)
    s = (np.arange(PANEL) + 0.5) / PANEL * 2 - 1
    x, y = np.meshgrid(s, -s)
    inside = x * x + y * y < 1
    z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
    p = x[..., None] * east + y[..., None] * north + z[..., None] * c
    lon = np.degrees(np.arctan2(p[..., 1], p[..., 0]))
    lat = np.degrees(np.arcsin(np.clip(p[..., 2], -1, 1)))
    return lon, lat, inside


def sample_equirect(image: np.ndarray, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Nearest sample of a global -180..180, 90..-90 plate carrée image."""
    h, w = image.shape[:2]
    col = np.clip(((lon + 180) / 360 * w).astype(int), 0, w - 1)
    row = np.clip(((90 - lat) / 180 * h).astype(int), 0, h - 1)
    return image[row, col]


def srgb_to_linear(v: np.ndarray) -> np.ndarray:
    v = v / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(v: np.ndarray) -> np.ndarray:
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, 12.92 * v, 1.055 * v ** (1 / 2.4) - 0.055)


def label(img: Image.Image, text: str) -> Image.Image:
    canvas = Image.new("RGB", (PANEL, PANEL + 64), (12, 12, 14))
    canvas.paste(img, (0, 0))
    draw = ImageDraw.Draw(canvas)
    y = PANEL + 6
    for line in text.split("\n"):
        draw.text((8, y), line, fill=(225, 225, 225))
        y += 14
    return canvas


def main(cache: str, out: str) -> None:
    ephemeris = json.load(open(os.path.join(ROOT, "public/data/moon/ephemeris.json")))
    epoch = next(e for e in ephemeris["epochs"] if e["utc"] == EPOCH)
    gmst = gmst_deg(EPOCH)
    sub_moon = lonlat_of([-c for c in epoch["earthDirectionJ2000"]], gmst)
    sub_sun = lonlat_of(epoch["sunDirectionJ2000"], gmst)
    r_au = epoch["sunDistanceKm"] / AU_KM
    print(f"sub-Moon {sub_moon[0]:.1f}, {sub_moon[1]:.1f}; sub-solar {sub_sun[0]:.1f}, {sub_sun[1]:.1f}")

    lon, lat, inside = view(sub_moon)
    normal = np.stack([
        np.cos(np.radians(lat)) * np.cos(np.radians(lon)),
        np.cos(np.radians(lat)) * np.sin(np.radians(lon)),
        np.sin(np.radians(lat)),
    ], -1)
    mu0_signed = normal @ unit(*sub_sun)
    mu0 = np.clip(mu0_signed, 0, 1)

    def finish(i_over_f: np.ndarray) -> Image.Image:
        """I/F (H x W x 3, NaN = no data) to the app's display, sRGB."""
        display = linear_to_srgb(EXPOSURE * i_over_f / (r_au * r_au))
        missing = np.isnan(display).any(-1) & inside
        rgb = (np.nan_to_num(display) * 255).round().astype(np.uint8)
        # Missing where the Sun is up or in twilight (up to 6 degrees below the horizon) is a gap.
        # Past that it is night: dark whether or not anything measured it.
        rgb[missing & (mu0_signed > -0.1)] = (110, 20, 20)
        lit = inside & (mu0_signed > -0.1)
        print(f"  no data over {100 * (missing & lit).sum() / lit.sum():.2f}% of the lit disc")
        rgb[~inside] = 0
        return Image.fromarray(rgb)

    panels = []
    uniform = np.repeat((LAMBERT * mu0)[..., None], 3, -1)
    panels.append(label(finish(uniform), "Now: uniform Lambert sphere\ngeometric albedo 0.434 (NASA fact sheet)"))

    bm = np.asarray(Image.open(os.path.join(cache, "bm-200401.jpg")).convert("RGB"), float)
    rho = srgb_to_linear(sample_equirect(bm, lon, lat))
    panels.append(label(finish(rho * mu0[..., None]), "Blue Marble NG, January 2004 (MODIS)\ncloud-free visual composite, x cos(sun)"))

    viirs = np.asarray(Image.open(os.path.join(cache, "viirs-20260126.jpg")).convert("RGB"), float)
    rho = srgb_to_linear(sample_equirect(viirs, lon, lat))
    panels.append(label(finish(rho * mu0[..., None]), "VIIRS NOAA-20, 26 Jan 2026 (daily swaths)\nthat day's clouds, visual product, x cos(sun)"))

    channels = []
    for band in ("B03", "B02", "B01"):
        paths = [Path(p) for p in glob.glob(os.path.join(cache, "ahi", f"HS_H09_20260126_0500_{band}_FLDK_*.DAT.bz2"))]
        image, meta = read_ahi(paths, AHI_FACTOR[band])
        print(band, f"{meta['wavelength']:.3f} um, sub-lon {meta['sub_lon']}, {image.shape}, "
              f"median albedo {np.nanmedian(image):.3f}")
        channels.append(ahi_sample(image, meta, lon, lat)[0])
    ahi = np.stack(channels, -1)
    panels.append(label(finish(ahi), "Himawari-9, 26 Jan 2026 05:00 UTC exactly\ncalibrated I/F: 0.64 / 0.51 / 0.47 um, as measured"))

    width = PANEL * len(panels)
    sheet = Image.new("RGB", (width, PANEL + 64 + 150), (12, 12, 14))
    for i, p in enumerate(panels):
        sheet.paste(p, (i * PANEL, 0))
    # At phone scale: Earth spans 1.9 degrees of a 60 degree view, about 80 device pixels on an iPhone.
    draw = ImageDraw.Draw(sheet)
    draw.text((8, PANEL + 70), "As big as it is on an iPhone in orbit (about 80 device pixels across):", fill=(225, 225, 225))
    for i, p in enumerate(panels):
        small = p.crop((0, 0, PANEL, PANEL)).resize((80, 80), Image.LANCZOS)
        sheet.paste(small, (i * PANEL + PANEL // 2 - 40, PANEL + 64 + 50))
    sheet.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
