"""Checks the committed Mars terrain manifest and provenance (public/data/mars, SS-14 W4).

The composite itself (pipeline/.cache/mars-terrain-64.img) is too large to commit; its checks
are computed by pipeline/mars_terrain.py and recorded in the manifest, which these read. No
network.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public/data/mars"
MANIFEST = json.loads((DATA / "terrain.json").read_text())
SOURCES = json.loads(
    (Path(__file__).resolve().parent / "hrsc_dtm_sources.json").read_text()
)
FEATURES = {
    f["name"]: f
    for f in json.loads(
        (ROOT / "test/fixtures/iau-gazetteer-mars-relief.json").read_text()
    )["features"]
}


def inside(point: dict, feature: dict) -> bool:
    box = feature["box"]
    return (
        box["southDeg"] <= point["latDeg"] <= box["northDeg"]
        and box["westDeg"] <= point["lonDeg"] <= box["eastDeg"]
    )


class MarsTerrain(unittest.TestCase):
    def test_highest_point_is_on_olympus_mons(self) -> None:
        self.assertTrue(
            inside(MANIFEST["checks"]["maxHeight"], FEATURES["Olympus Mons"])
        )

    def test_lowest_point_is_in_hellas(self) -> None:
        self.assertTrue(
            inside(MANIFEST["checks"]["minHeight"], FEATURES["Hellas Planitia"])
        )

    def test_the_location_check_sees_a_mirrored_map(self) -> None:
        mirrored = {
            **MANIFEST["checks"]["maxHeight"],
            "lonDeg": -MANIFEST["checks"]["maxHeight"]["lonDeg"],
        }
        self.assertFalse(inside(mirrored, FEATURES["Olympus Mons"]))

    def test_mola_measurements_are_kept_where_hrsc_is_absent(self) -> None:
        """Outside HRSC, a bin with laser shots holds MOLA's value exactly (both whole metres)."""
        self.assertEqual(
            MANIFEST["checks"]["molaMeasuredBins.outsideHrsc"]["maxAbsM"], 0
        )

    def test_rejection_rule_as_the_owner_set_it(self) -> None:
        c = MANIFEST["composite"]
        limit = 3.0 * c["medianFitRmsM"]
        used = [n for n, f in MANIFEST["fits"].items() if n not in c["leftOut"]]
        self.assertEqual(len(used), c["stripsUsed"])
        self.assertTrue(all(MANIFEST["fits"][n]["rmsM"] <= limit for n in used))
        self.assertTrue(
            all("rmsM" not in f or f["rmsM"] > limit for f in c["leftOut"].values())
        )

    def test_every_strip_is_pinned(self) -> None:
        strips = SOURCES["strips"]
        self.assertEqual(set(strips), set(MANIFEST["fits"]))
        self.assertTrue(
            all(
                len(s.get("sha256", "")) == 64 and len(s["md5"]) == 32
                for s in strips.values()
            )
        )

    def test_provenance_shares_cover_mars(self) -> None:
        shares = MANIFEST["composite"]["areaShares"]
        self.assertAlmostEqual(sum(shares.values()), 1.0, delta=1e-3)
        image = np.array(
            Image.open(DATA / MANIFEST["provenance"]["file"]).convert("RGB")
        ).astype(int)
        self.assertEqual(
            image.shape[:2],
            (
                180 * MANIFEST["provenance"]["pixelsPerDegree"],
                360 * MANIFEST["provenance"]["pixelsPerDegree"],
            ),
        )
        # Each pixel's three shares sum to the whole, up to rounding of each to a byte.
        self.assertLessEqual(int(np.abs(image.sum(axis=2) - 255).max()), 2)


if __name__ == "__main__":
    unittest.main()
