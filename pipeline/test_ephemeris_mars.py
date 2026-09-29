"""Checks public/data/mars/ephemeris.json against JPL Horizons. No network, no kernels.

The Horizons values (test/fixtures/horizons-mars.json) were fetched once, with the requests
recorded. Horizons gives Mars's longitudes west-positive and its latitudes planetodetic (its own
header); ours are planetocentric and east-positive, so the test converts Horizons' values.
Measured agreement on 2026-09-29: sub-solar point about 1e-5 deg; Phobos and Deimos below 1 m
(both from mar099).

Light time matters here, unlike for the Moon (1.3 s): Earth sees Mars as it was about 20 minutes
earlier. So the sub-solar point seen from Earth is checked against Horizons from Earth, and the
vectors the app draws from against Horizons from Phobos.
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EPHEMERIS = json.loads((ROOT / "public/data/mars/ephemeris.json").read_text())
HORIZONS = json.loads((ROOT / "test/fixtures/horizons-mars.json").read_text())
TOLERANCE_DEG = 0.1
SATELLITE_TOLERANCE_KM = 1.0


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
        if observer == "phobos":
            h = h["fromPhobos"]
        return -h["subSolarWestLonDeg"], planetocentric(h["subSolarPlanetodeticLatDeg"])

    def test_sub_solar_point_matches(self) -> None:
        for epoch in EPHEMERIS["epochs"]:
            lon, lat = self.expected(epoch["id"])
            ours = epoch["subSolarFromEarth"]
            self.assertLess(lon_diff(ours["lonDeg"], lon), TOLERANCE_DEG, epoch["id"])
            self.assertLess(abs(ours["latDeg"] - lat), TOLERANCE_DEG, epoch["id"])

    def test_the_conversion_matters(self) -> None:
        """Without converting Horizons' conventions the check would fail: it can see them."""
        epoch = EPHEMERIS["epochs"][1]
        h = self.horizons[epoch["id"]]
        ours = epoch["subSolarFromEarth"]
        self.assertGreater(lon_diff(ours["lonDeg"], h["subSolarWestLonDeg"]), 10)
        self.assertGreater(abs(ours["latDeg"] - h["subSolarPlanetodeticLatDeg"]), 0.1)

    def test_the_vectors_the_app_uses_reproduce_it(self) -> None:
        """The Sun's direction rotated into Mars's frame by the shipped matrix: Mars as it is at the
        instant, so it is checked against Horizons seen from Phobos (light time 0.03 s), not from
        Earth (about 20 minutes, in which Mars turns about 5 degrees)."""
        for epoch in EPHEMERIS["epochs"]:
            m = epoch["j2000ToBodyFixed"]
            s = epoch["sunDirectionJ2000"]
            lon, lat = lon_lat([sum(m[r][c] * s[c] for c in range(3)) for r in range(3)])
            h_lon, h_lat = self.expected(epoch["id"], "phobos")
            self.assertLess(lon_diff(lon, h_lon), TOLERANCE_DEG, epoch["id"])
            self.assertLess(abs(lat - h_lat), TOLERANCE_DEG, epoch["id"])

    def test_phobos_and_deimos_positions(self) -> None:
        for epoch in EPHEMERIS["epochs"]:
            expected = self.horizons[epoch["id"]]["satellitesJ2000Km"]
            for s in epoch["satellites"]:
                d = math.dist(s["positionJ2000Km"], expected[s["name"]])
                self.assertLess(d, SATELLITE_TOLERANCE_KM, f"{epoch['id']} {s['name']}")


if __name__ == "__main__":
    unittest.main()
