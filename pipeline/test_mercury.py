"""Checks the committed Mercury albedo (public/data/mercury) against its manifest. No network.

What the pipeline itself proved when it ran is recorded in albedo.json: every source file matched
its PDS-published MD5; each polar tile's orientation was the only one of eight that matched its
neighbours; the result agreed with USGS's independent mosaic of the same tiles, and a mirrored or
shifted copy did not. Here the committed files are checked to be the ones it wrote, and to say
what the manifest says.
"""

from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public/data/mercury"
MANIFEST = json.loads((DATA / "albedo.json").read_text())


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class MercuryAlbedo(unittest.TestCase):
    def test_files_are_the_ones_the_pipeline_wrote(self) -> None:
        for key in ("texture", "colour", "source"):
            entry = MANIFEST[key]
            self.assertEqual(sha(DATA / entry["file"]), entry["sha256"], key)

    def test_texture_shape_and_encoding(self) -> None:
        t = MANIFEST["texture"]
        a = np.array(Image.open(DATA / t["file"]).convert("L"))
        self.assertEqual(a.shape, (t["height"], t["width"]))
        self.assertEqual(t["encoding"]["curve"], "sqrt")
        decoded = t["encoding"]["maxReflectance"] * (a[a > 0] / 255.0) ** 2
        self.assertAlmostEqual(float(np.median(decoded)), t["median750"], delta=0.002)
        # The app checks its own decoding against this (tools/capture/run.ts).
        self.assertEqual(round(float(a[a > 0].mean()), 4), t["decodedMean"])

    def test_gaps_are_where_the_source_map_says(self) -> None:
        a = np.array(Image.open(DATA / MANIFEST["texture"]["file"]).convert("L"))
        source = np.array(Image.open(DATA / MANIFEST["source"]["file"]).convert("L"))
        small_gap = source == 0
        k = a.shape[1] // source.shape[1]
        sampled = a[k // 2 :: k, k // 2 :: k][: source.shape[0], : source.shape[1]] == 0
        self.assertGreater(float((sampled == small_gap).mean()), 0.99)

    def test_the_pipeline_checks_passed(self) -> None:
        u = MANIFEST["usgsAgreement"]
        self.assertGreater(u["correlation"], 0.9)
        self.assertLess(max(u["mirroredEastWest"], u["shifted1DegEast"]), 0.9)
        for rec in MANIFEST["tileGeometry"]["polarOrientation"]:
            self.assertGreater(rec["chosen"]["correlation"], 0.8, rec["tile"])


if __name__ == "__main__":
    unittest.main()
