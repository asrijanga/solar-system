"""Checks the committed Mars albedo (public/data/mars) against the IAU Gazetteer and its manifest.

Classical albedo features have names because they are dark or bright from Earth: the texture must
put them where the Gazetteer does (test/fixtures/iau-gazetteer-mars.json). The same check on the
map mirrored in longitude must fail, so it can see a mirrored map. No network.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public/data/mars"
MANIFEST = json.loads((DATA / "albedo.json").read_text())
FEATURES = json.loads((ROOT / "test/fixtures/iau-gazetteer-mars.json").read_text())["features"]
BOX_DEG = 1.5
# Every dark feature at most this share of every bright one.
CONTRAST = 0.6


def albedo() -> np.ndarray:
    byte = np.array(Image.open(DATA / MANIFEST["texture"]["file"]).convert("L")).astype(np.float64)
    return MANIFEST["texture"]["encoding"]["maxAlbedo"] * (byte / 255) ** 2


def mean_at(a: np.ndarray, lon: float, lat: float) -> float:
    h, w = a.shape
    c0, c1 = (int((x + 180) / 360 * w) for x in (lon - BOX_DEG, lon + BOX_DEG))
    r0, r1 = (int((90 - y) / 180 * h) for y in (lat + BOX_DEG, lat - BOX_DEG))
    return float(a[r0:r1, c0:c1].mean())


def separated(a: np.ndarray, mirror: bool) -> bool:
    values = {f["name"]: mean_at(a, -f["lonDeg"] if mirror else f["lonDeg"], f["latDeg"]) for f in FEATURES}
    dark = [values[f["name"]] for f in FEATURES if f["expect"] == "dark"]
    bright = [values[f["name"]] for f in FEATURES if f["expect"] == "bright"]
    return max(dark) <= CONTRAST * min(bright)


class MarsAlbedo(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.a = albedo()

    def test_shape_matches_manifest(self) -> None:
        self.assertEqual(self.a.shape, (MANIFEST["texture"]["height"], MANIFEST["texture"]["width"]))

    def test_named_albedo_features_where_the_gazetteer_puts_them(self) -> None:
        self.assertTrue(separated(self.a, mirror=False))

    def test_the_check_sees_a_mirrored_map(self) -> None:
        self.assertFalse(separated(self.a, mirror=True))

    def test_fill_is_checked_and_recorded(self) -> None:
        check = MANIFEST["gapFill"]["check"]
        self.assertGreater(check["within60"]["correlation"], 0.95)
        self.assertLess(abs(check["within60"]["meanRelativeError"]), 0.02)

    def test_mean_albedo_is_omega_s(self) -> None:
        """The label gives the source's mean, 0.294; the texture's pixel mean stays close to it."""
        self.assertAlmostEqual(float(self.a.mean()), 0.294, delta=0.02)


if __name__ == "__main__":
    unittest.main()
