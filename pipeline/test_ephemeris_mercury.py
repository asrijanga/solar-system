"""Checks public/data/mercury/ephemeris.json against JPL Horizons. No network, no kernels.

The Horizons values (test/fixtures/horizons-mercury.json) were fetched once, with the requests
recorded. Horizons gives Mercury's longitudes west-positive and its latitudes planetodetic (its own
header); ours are planetocentric and east-positive, so the test converts Horizons' values.

Light time: Earth sees Mercury as it was 5 to 10 minutes earlier, and the Sun 3 to 4 minutes
earlier. Mercury turns only 6.1 deg a day, so either is within 0.02 deg of Mercury as it is at the
instant. The vectors the app draws from are checked against Horizons from the Sun, the nearer.
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EPHEMERIS = json.loads((ROOT / "public/data/mercury/ephemeris.json").read_text())
HORIZONS = json.loads((ROOT / "test/fixtures/horizons-mercury.json").read_text())
TOLERANCE_DEG = 0.1


def lon_lat(v: list[float]) -> tuple[float, float]:
    x, y, z = v
    return math.degrees(math.atan2(y, x)), math.degrees(math.atan2(z, math.hypot(x, y)))


def lon_diff(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def planetocentric(lat_deg: float) -> float:
    a, _, c = EPHEMERIS["body"]["radiiKm"]
    return math.degrees(math.atan((c / a) ** 2 * math.tan(math.radians(lat_deg))))


class AgainstHorizons(unittest.TestCase):
    def setUp(self) -> None:
        self.horizons = {e["id"]: e for e in HORIZONS["epochs"]}
        self.assertEqual(HORIZONS["frameStatedByHorizons"], EPHEMERIS["body"]["bodyFixedFrame"])

    def expected(self, epoch_id: str, observer: str = "earth") -> tuple[float, float]:
        h = self.horizons[epoch_id]
        if observer == "sun":
            h = h["fromSun"]
        return -h["subSolarWestLonDeg"], planetocentric(h["subSolarPlanetodeticLatDeg"])

    def test_sub_solar_point_matches(self) -> None:
        for epoch in EPHEMERIS["epochs"]:
            lon, lat = self.expected(epoch["id"])
            ours = epoch["subSolarFromEarth"]
            self.assertLess(lon_diff(ours["lonDeg"], lon), TOLERANCE_DEG, epoch["id"])
            self.assertLess(abs(ours["latDeg"] - lat), TOLERANCE_DEG, epoch["id"])

    def test_the_conversion_matters(self) -> None:
        """Without converting Horizons' west longitudes the check would fail: it can see them."""
        for epoch in EPHEMERIS["epochs"]:
            h = self.horizons[epoch["id"]]
            self.assertGreater(lon_diff(epoch["subSolarFromEarth"]["lonDeg"], h["subSolarWestLonDeg"]), 10)

    def test_the_vectors_the_app_uses_reproduce_it(self) -> None:
        """The Sun's direction rotated into Mercury's frame by the shipped matrix, against Horizons
        seen from the Sun."""
        for epoch in EPHEMERIS["epochs"]:
            m = epoch["j2000ToBodyFixed"]
            s = epoch["sunDirectionJ2000"]
            lon, lat = lon_lat([sum(m[r][c] * s[c] for c in range(3)) for r in range(3)])
            h_lon, h_lat = self.expected(epoch["id"], "sun")
            self.assertLess(lon_diff(lon, h_lon), TOLERANCE_DEG, epoch["id"])
            self.assertLess(abs(lat - h_lat), TOLERANCE_DEG, epoch["id"])


if __name__ == "__main__":
    unittest.main()
