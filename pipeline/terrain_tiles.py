"""The Moon's terrain as streamed polygons: quantized-mesh tiles for the app (SS-10).

    npm run pipeline:tiles

Output: public/terrain/ (layer.json and {z}/{x}/{y}.terrain), generated at build time and
never committed. Until the owner's object storage exists (docs/stories/SS-10.md), the tiles
are built in CI from the pinned sources below and published with the site, which keeps the
whole pyramid under GitHub Pages' size limit:

- Everywhere, levels 0-5 from LOLA LDEM_64 (474 m): vertices 2.7 km apart at level 5.
- Around Albategnius, deeper levels from LOLA LDEM_512 (59 m), fetched as a byte range of the
  PDS tile covering 45 S - 0, 0 - 90 E: vertices 83 m apart over the crater, 41 m at its peak.
- Over the crater's floor and central peak, levels 12 and 13 from SELENE (Kaguya) Terrain
  Camera stereo, DTM_MAP_02 seamless (8.4 m sampling): vertices 21 m apart, and 10 m within
  about 9 km of the peak. Registered to LOLA LDEM_512 by `kaguya_registration` (the fit is
  written to sources.json), blended into LOLA across a 0.02 degree (600 m) band at the box's
  edge, and replaced by LOLA wherever Kaguya has no measurement.

Every vertex height is a measurement (bilinear between measured samples); nothing is added
between them. Normals come from the same measured surface (quantized_mesh.vertex_normals).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from download import fetch
from quantized_mesh import Blend, Region, build

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "terrain"

LDEM512_URL = (
    "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/"
    "cylindrical/float_img/ldem_512_45s_00s_000_090_float.img"
)
ROW_BYTES = 46080 * 4
ROWS = (2560, 8704)  # latitude -5 to -17 at 512 px/deg, from the tile's 0 deg top edge
LDEM512_RANGE_SHA256 = "aefcd8a8199df488d1f4f7a017e21a09443f8678d09c67c796003289473ab7e1"

# SELENE TC DTM_MAP_02 seamless, JAXA DARTS (SLN-L-TC-5-DTM-MAP-SEAMLESS-V2.0). The label:
# simple cylindrical, planetocentric, east-positive, 3600 px/deg, 16-bit MSB metres, DUMMY
# -9999, first line at 9.000000 S and first sample at 3.000000 E, the last at 11.999722 S
# and 5.999722 E: samples sit on whole multiples of 1/3600 degree. JAXA publishes no checksum;
# the SHA-256 is pinned from the first download.
KAGUYA_URL = (
    "https://data.darts.isas.jaxa.jp/pub/pds3/sln-l-tc-5-dtm-map-seamless-v2.0/lon003/data/"
    "DTM_MAPs02_S09E003S12E006SC.img"
)
KAGUYA_SHA256 = "267c14fc6b87fee85d1e5df91a12ea1d60412ddbf0e872987a4c6893356c84c1"
KAGUYA_PPD = 3600
KAGUYA_NORTH, KAGUYA_WEST = -9.0, 3.0
KAGUYA_DUMMY = -9999

# Albategnius's central peak, the highest Kaguya sample within 0.5 degrees of the crater's
# Gazetteer centre: 3.7717 E, 11.3044 S.
PEAK = (3.77, -11.30)
KAGUYA_LEVEL = 12
KAGUYA_BOX = (3.4, -11.8, 4.6, -10.6)
BLEND_DEG = 0.02

GLOBAL_LEVELS = 5
BOXES = [
    (7, (0.1, -16.9, 9.9, -5.1)),
    (10, (1.5, -14.0, 6.5, -8.5)),
    (11, KAGUYA_BOX),
    (KAGUYA_LEVEL, KAGUYA_BOX),
    (13, (PEAK[0] - 0.3, PEAK[1] - 0.3, PEAK[0] + 0.3, PEAK[1] + 0.3)),
]


def albategnius_region() -> Region:
    path = fetch(
        LDEM512_URL,
        LDEM512_RANGE_SHA256,
        f"ldem512_rows_{ROWS[0]}_{ROWS[1]}.img",
        byte_range=(ROWS[0] * ROW_BYTES, ROWS[1] * ROW_BYTES),
    )
    raw = np.fromfile(path, dtype="<f4").reshape(-1, 46080)[:, : 10 * 512]
    return Region(raw, lat_top=-5.0, lon_west=0.0)


def kaguya_region() -> Region:
    path = fetch(KAGUYA_URL, KAGUYA_SHA256, "kaguya_tc_dtm_S09E003S12E006SC.img")
    raw = np.fromfile(path, dtype=">i2").reshape(3 * KAGUYA_PPD, 3 * KAGUYA_PPD)
    km = np.where(raw == KAGUYA_DUMMY, np.nan, raw / 1000.0).astype(np.float32)
    # Region is pixel-registered (centres half a pixel in); these samples sit on the grid
    # lines, so its edges are half a pixel outside the first and last samples.
    half = 0.5 / KAGUYA_PPD
    return Region(km, lat_top=KAGUYA_NORTH + half, lon_west=KAGUYA_WEST - half, ppd=KAGUYA_PPD)


def box_mean(grid: np.ndarray, n: int) -> np.ndarray:
    """Mean over the n x n neighbourhood of every sample (n odd); edges repeat outwards."""
    pad = np.pad(grid, n // 2, mode="edge")
    c = np.pad(np.cumsum(np.cumsum(pad, 0), 1), ((1, 0), (1, 0)))
    return (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / (n * n)


def kaguya_registration(kaguya: Region, lola: Region, box: tuple[float, float, float, float]) -> dict:
    """How Kaguya sits against LOLA LDEM_512 over `box`, at LOLA's pixel centres.

    Kaguya is averaged over each LOLA pixel's footprint (7 x 7 samples), and pixels touching
    a Kaguya no-data sample are left out. The horizontal offset is the shift, searched in
    0.0001 degree steps to +-0.0012 degrees (35 m), that minimises the RMS difference after
    removing the mean; the vertical offset is the mean difference at that shift.
    """
    w, s, e, n = box
    rows = np.arange(int(np.ceil((lola.lat_top - n) * lola.ppd)), int((lola.lat_top - s) * lola.ppd))
    cols = np.arange(int(np.ceil((w - lola.lon_west) * lola.ppd)), int((e - lola.lon_west) * lola.ppd))
    rr, cc = np.meshgrid(rows, cols, indexing="ij")
    lat = lola.lat_top - (rr + 0.5) / lola.ppd
    lon = lola.lon_west + (cc + 0.5) / lola.ppd
    ref = lola.rows[rr, cc].astype(np.float64) * 1000.0

    k = kaguya.ppd // lola.ppd | 1
    holes = np.isnan(kaguya.rows)
    smooth = Region(box_mean(np.nan_to_num(kaguya.rows).astype(np.float64), k), kaguya.lat_top, kaguya.lon_west, kaguya.ppd)
    near_hole = Region(box_mean(holes.astype(np.float64), k), kaguya.lat_top, kaguya.lon_west, kaguya.ppd)
    ok = near_hole.heights_m(lat, lon) == 0

    best = None
    steps = np.round(np.arange(-12, 13) * 1e-4, 6)
    for dlat in steps:
        for dlon in steps:
            d = (smooth.heights_m(lat + dlat, lon + dlon) - ref)[ok]
            rms = float(np.sqrt(np.mean((d - d.mean()) ** 2)))
            if best is None or rms < best[0]:
                best = (rms, float(dlat), float(dlon), float(d.mean()))
    d = (smooth.heights_m(lat, lon) - ref)[ok]
    rms0 = float(np.sqrt(np.mean((d - d.mean()) ** 2)))
    correlation = float(np.corrcoef(smooth.heights_m(lat, lon)[ok], ref[ok])[0, 1])
    return {
        "box": list(box),
        "lolaPixels": int(ok.sum()),
        "correlation": round(correlation, 6),
        "unshifted": {"meanM": round(float(d.mean()), 2), "rmsM": round(rms0, 2), "madM": round(float(np.median(np.abs(d - np.median(d)))), 2)},
        "bestShift": {"dlatDeg": best[1], "dlonDeg": best[2], "meanM": round(best[3], 2), "rmsM": round(best[0], 2)},
        "kaguyaNoDataSamples": int(holes.sum()),
    }


if __name__ == "__main__":
    lola = albategnius_region()
    kaguya = kaguya_region()
    fit = kaguya_registration(kaguya, lola, (3.1, -11.9, 5.9, -9.1))
    print(f"Kaguya against LOLA: {json.dumps(fit)}")
    # Registration within one Kaguya sample and a sub-metre vertical offset are below what
    # either product resolves, so Kaguya is used as published: no shift, no offset.
    if max(abs(fit["bestShift"]["dlatDeg"]), abs(fit["bestShift"]["dlonDeg"])) > 1 / KAGUYA_PPD or abs(fit["unshifted"]["meanM"]) > 5:
        raise RuntimeError("Kaguya no longer registers to LOLA within one sample and 5 m: review before building")
    blended = Blend(kaguya, lola, KAGUYA_BOX, BLEND_DEG)
    build(
        OUT,
        max_global=GLOBAL_LEVELS,
        boxes=BOXES,
        grid=65,
        regions=[(KAGUYA_LEVEL, blended), (0, lola)],
        attribution="LOLA LDEM_64 and LDEM_512 (PDS LRO-L-LOLA-4-GDR-V1.0); SELENE TC DTM_MAP_02 (JAXA)",
    )
    (OUT / "sources.json").write_text(
        json.dumps(
            {
                "global": "LOLA LDEM_64_FLOAT (PDS LRO-L-LOLA-4-GDR-V1.0), levels 0-5",
                "albategnius": {
                    "source": "LOLA LDEM_512_45S_00S_000_090_FLOAT, rows 2560-8704 (byte range)",
                    "sha256": LDEM512_RANGE_SHA256,
                    "boxes": BOXES,
                },
                "kaguya": {
                    "source": "SELENE TC DTM_MAPs02_S09E003S12E006SC (SLN-L-TC-5-DTM-MAP-SEAMLESS-V2.0)",
                    "sha256": KAGUYA_SHA256,
                    "levels": f"{KAGUYA_LEVEL}+",
                    "box": KAGUYA_BOX,
                    "blendDeg": BLEND_DEG,
                    "registration": fit,
                },
                "frame": "MOON_ME (MEAN EARTH/POLAR AXIS OF DE421), metres, 1737.4 km sphere",
            },
            indent=2,
        )
        + "\n"
    )
