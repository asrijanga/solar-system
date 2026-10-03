"""Checks the committed Mars albedo (public/data/mars) against the IAU Gazetteer and its manifest.

The texture is reflectance at 530 nm (pipeline/mars.py).

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
# Every dark feature darker than every bright one: what the Gazetteer's classical albedo names
# assert. It was 0.6 until part 3, a reference set against OMEGA's near-infrared contrast; Hubble's
# calibrated 547 nm measurement of these boxes gives 0.62 (Mare Acidalium against Arabia Terra), so
# 0.6 was physically wrong for visible light. Corrected with the owner's approval, 2026-10-03:
# "Dark below bright, < 1". The mirrored map gives 2.09, so the control still fails.
CONTRAST = 1.0


def albedo() -> np.ndarray:
    byte = np.array(Image.open(DATA / MANIFEST["texture"]["file"]).convert("L")).astype(np.float64)
    return MANIFEST["texture"]["encoding"]["maxReflectance"] * (byte / 255) ** 2


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
        check = MANIFEST["anchor"]["gapFill"]["check"]
        self.assertGreater(check["within60"]["correlation"], 0.95)
        self.assertLess(abs(check["within60"]["meanRelativeError"]), 0.02)

    def test_large_scale_is_omega_s(self) -> None:
        """The blend keeps OMEGA's measured light and dark at the scale of its window (1 deg)."""
        fit = MANIFEST["blend"]["blendAgainstOmega"]["1ppd.withinLatitude60"]
        self.assertGreater(fit["correlation"], 0.99)
        self.assertLess(abs(fit["meanRelativeDifference"]), 0.01)

    def test_large_scale_is_hubble_s(self) -> None:
        """Part 3 (owner-approved, 2026-10-03): within Hubble's coverage the map's 2 deg means
        are within 3% of Hubble's 547 nm brightness, median absolute difference."""
        agreement = MANIFEST["hubble"]["agreement"]
        self.assertGreater(agreement["cells"], 5000)
        self.assertLessEqual(agreement["medianAbsoluteDifference"], 0.03)

    def test_hubble_coverage_matches_manifest(self) -> None:
        coverage = np.array(Image.open(DATA / MANIFEST["hubble"]["file"]).convert("L"))
        self.assertEqual(coverage.shape, (600, 1200))
        self.assertAlmostEqual(float((coverage == 255).mean()), MANIFEST["hubble"]["coveredFraction"], delta=0.01)

    def test_source_map_matches_manifest(self) -> None:
        source = np.array(Image.open(DATA / MANIFEST["source"]["file"]).convert("L"))
        self.assertEqual(source.shape, self.a.shape)
        self.assertEqual(int(np.sum(source > 0)), MANIFEST["source"]["pixelsWithTes"])

if __name__ == "__main__":
    unittest.main()
