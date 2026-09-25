"""The Moon's terrain as streamed polygons: quantized-mesh tiles for the app (SS-10).

    npm run pipeline:tiles

Output: public/terrain/ (layer.json and {z}/{x}/{y}.terrain), generated at build time and
never committed. Until the owner's object storage exists (docs/stories/SS-10.md), the tiles
are built in CI from the pinned sources below and published with the site, which keeps the
whole pyramid under GitHub Pages' size limit:

- Everywhere, levels 0-5 from LOLA LDEM_64 (474 m): vertices 2.7 km apart at level 5.
- Around Albategnius, deeper levels from LOLA LDEM_512 (59 m), fetched as a byte range of the
  PDS tile covering 45 S - 0, 0 - 90 E: vertices 83 m apart over the crater, 41 m at its peak.

Every vertex height is a measurement (bilinear between measured samples); nothing is added
between them. Normals come from the same measured surface (quantized_mesh.vertex_normals).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from download import fetch
from quantized_mesh import Region, build

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "terrain"

LDEM512_URL = (
    "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/"
    "cylindrical/float_img/ldem_512_45s_00s_000_090_float.img"
)
ROW_BYTES = 46080 * 4
ROWS = (2560, 8704)  # latitude -5 to -17 at 512 px/deg, from the tile's 0 deg top edge
LDEM512_RANGE_SHA256 = "aefcd8a8199df488d1f4f7a017e21a09443f8678d09c67c796003289473ab7e1"

GLOBAL_LEVELS = 5
BOXES = [
    (7, (0.1, -16.9, 9.9, -5.1)),
    (10, (1.5, -14.0, 6.5, -8.5)),
    (11, (3.4, -11.8, 4.6, -10.6)),
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


if __name__ == "__main__":
    build(OUT, max_global=GLOBAL_LEVELS, boxes=BOXES, grid=65, region=albategnius_region())
    (OUT / "sources.json").write_text(
        json.dumps(
            {
                "global": "LOLA LDEM_64_FLOAT (PDS LRO-L-LOLA-4-GDR-V1.0), levels 0-5",
                "albategnius": {
                    "source": "LOLA LDEM_512_45S_00S_000_090_FLOAT, rows 2560-8704 (byte range)",
                    "sha256": LDEM512_RANGE_SHA256,
                    "boxes": BOXES,
                },
                "frame": "MOON_ME (MEAN EARTH/POLAR AXIS OF DE421), metres, 1737.4 km sphere",
            },
            indent=2,
        )
        + "\n"
    )
