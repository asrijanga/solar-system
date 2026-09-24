"""Checks public/data/moon/ephemeris.json against JPL Horizons. No network, no kernels.

The Horizons values (test/fixtures/horizons-moon-subsolar.json) were fetched once, with the
request recorded. Measured agreement on 2026-09-24: about 1e-5 deg.
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EPHEMERIS = json.loads((ROOT / "public/data/moon/ephemeris.json").read_text())
HORIZONS = json.loads((ROOT / "test/fixtures/horizons-moon-subsolar.json").read_text())
TOLERANCE_DEG = 0.1


def lon_lat(v: list[float]) -> tuple[float, float]:
    x, y, z = v
    return math.degrees(math.atan2(y, x)), math.degrees(math.atan2(z, math.hypot(x, y)))


def lon_diff(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


class AgainstHorizons(unittest.TestCase):
    def setUp(self) -> None:
        self.horizons = {e["id"]: e for e in HORIZONS["epochs"]}
        self.assertEqual(HORIZONS["frameStatedByHorizons"], EPHEMERIS["body"]["bodyFixedFrame"])

    def test_sub_solar_point_matches(self) -> None:
        for epoch in EPHEMERIS["epochs"]:
            h = self.horizons[epoch["id"]]
            ours = epoch["subSolarFromEarth"]
            self.assertLess(lon_diff(ours["lonDeg"], h["subSolarLonDeg"]), TOLERANCE_DEG, epoch["id"])
            self.assertLess(abs(ours["latDeg"] - h["subSolarLatDeg"]), TOLERANCE_DEG, epoch["id"])

    def test_the_vectors_the_app_uses_reproduce_it(self) -> None:
        """Sun direction rotated into the body frame by the shipped matrix lands on Horizons'
        sub-solar point. This is what the renderer will do, so this checks what it will draw."""
        for epoch in EPHEMERIS["epochs"]:
            m = epoch["j2000ToBodyFixed"]
            s = epoch["sunDirectionJ2000"]
            body = [sum(m[r][c] * s[c] for c in range(3)) for r in range(3)]
            lon, lat = lon_lat(body)
            h = self.horizons[epoch["id"]]
            self.assertLess(lon_diff(lon, h["subSolarLonDeg"]), TOLERANCE_DEG, epoch["id"])
            self.assertLess(abs(lat - h["subSolarLatDeg"]), TOLERANCE_DEG, epoch["id"])


class Sanity(unittest.TestCase):
    def test_rotation_matrices_are_proper_rotations(self) -> None:
        for epoch in EPHEMERIS["epochs"]:
            m = epoch["j2000ToBodyFixed"]
            det = (
                m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
                - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
            )
            self.assertAlmostEqual(det, 1.0, places=9)

    def test_phases_are_what_their_names_say(self) -> None:
        phases = {e["id"]: e["phaseAngleDeg"] for e in EPHEMERIS["epochs"]}
        self.assertLess(phases["full-2026-01"], 10)
        self.assertAlmostEqual(phases["first-quarter-2026-01"], 90, delta=2)

    def test_radius_comes_from_the_pck(self) -> None:
        self.assertEqual(EPHEMERIS["body"]["radiiKm"], [1737.4, 1737.4, 1737.4])
        self.assertIn("pck00011", EPHEMERIS["body"]["radiiSource"])


if __name__ == "__main__":
    unittest.main()
