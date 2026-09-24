"""Checks the committed Moon texture against the IAU Gazetteer. No network, no source file.

Expectations are physical and qualitative ("brighter than"), written before the texture was
first generated, so they cannot have been tuned to it. Coordinates and provenance are in
test/fixtures/iau-gazetteer-moon.json.
"""

from __future__ import annotations

import hashlib
import json
import math
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = json.loads((ROOT / "public/data/moon/albedo.json").read_text())
TEXTURE_PATH = ROOT / "public/data/moon" / MANIFEST["texture"]["file"]
TEXTURE = np.array(Image.open(TEXTURE_PATH).convert("L")).astype(np.float64)
MASK_PATH = ROOT / "public/data/moon" / MANIFEST["texture"]["mask"]
GAP = np.array(Image.open(MASK_PATH).convert("L")) > 0
GAZETTEER = {
    f["name"]: f
    for f in json.loads((ROOT / "test/fixtures/iau-gazetteer-moon.json").read_text())["features"]
}
R_KM = 1737.4
H, W = TEXTURE.shape


def region_mean(lon: float, lat: float, r_min_km: float, r_max_km: float) -> float:
    """Mean of valid pixels whose great-circle distance from (lon, lat) is in [r_min, r_max)."""
    span_lat = math.degrees(r_max_km / R_KM) + 1
    row0 = max(0, int((90 - lat - span_lat) / 180 * H))
    row1 = min(H, int((90 - lat + span_lat) / 180 * H) + 1)
    rows = np.arange(row0, row1)
    lats = np.radians(90 - (rows + 0.5) * 180 / H)
    cols = np.arange(W)
    lons = np.radians((cols + 0.5) * 360 / W - 180)
    la0, lo0 = math.radians(lat), math.radians(lon)
    cos_d = (
        np.sin(la0) * np.sin(lats)[:, None]
        + np.cos(la0) * np.cos(lats)[:, None] * np.cos(lons[None, :] - lo0)
    )
    dist = R_KM * np.arccos(np.clip(cos_d, -1, 1))
    patch = TEXTURE[row0:row1]
    select = (dist >= r_min_km) & (dist < r_max_km) & ~GAP[row0:row1]
    if not np.any(select):
        raise AssertionError(f"no valid pixels near {lon}, {lat}")
    return float(np.mean(patch[select]))


def contrast(lon: float, lat: float, core_km: float, ring: tuple[float, float]) -> float:
    return region_mean(lon, lat, 0, core_km) / region_mean(lon, lat, *ring)


class Integrity(unittest.TestCase):
    def test_manifests_are_strict_json_that_a_browser_can_parse(self) -> None:
        def refuse(constant: str) -> None:
            raise ValueError(f"{constant} is not JSON")

        for name in ("albedo.json", "ephemeris.json"):
            json.loads((ROOT / "public/data/moon" / name).read_text(), parse_constant=refuse)

    def test_file_matches_its_manifest(self) -> None:
        self.assertEqual(hashlib.sha256(TEXTURE_PATH.read_bytes()).hexdigest(), MANIFEST["texture"]["sha256"])
        self.assertEqual((W, H), (MANIFEST["texture"]["width"], MANIFEST["texture"]["height"]))

    def test_mask_matches_its_manifest(self) -> None:
        self.assertEqual(hashlib.sha256(MASK_PATH.read_bytes()).hexdigest(), MANIFEST["texture"]["maskSha256"])
        self.assertEqual(GAP.shape, TEXTURE.shape)

    def test_gaps_are_kept_and_rare(self) -> None:
        missing = float(GAP.mean())
        self.assertAlmostEqual(missing, MANIFEST["texture"]["missingFraction"], places=6)
        self.assertGreater(missing, 0, "Clementine has unimaged gaps; they must survive")
        self.assertLess(missing, 0.01)

    def test_south_polar_gap_is_where_clementine_is_known_to_be_thin(self) -> None:
        lat = 90 - (np.arange(H) + 0.5) * 180 / H
        self.assertGreater(GAP[lat < -80].mean(), 10 * GAP[np.abs(lat) < 60].mean())


class AgainstTheGazetteer(unittest.TestCase):
    def feature(self, name: str) -> tuple[float, float]:
        f = GAZETTEER[name]
        return f["lonDeg"], f["latDeg"]

    def test_mare_crisium_is_darker_than_the_highlands_around_it(self) -> None:
        lon, lat = self.feature("Mare Crisium")
        self.assertLess(region_mean(lon, lat, 0, 150), region_mean(lon, lat, 350, 450))

    def test_tycho_is_brighter_than_its_surroundings(self) -> None:
        lon, lat = self.feature("Tycho")
        self.assertGreater(contrast(lon, lat, 30, (80, 160)), 1.0)

    def test_aristarchus_is_brighter_than_its_surroundings(self) -> None:
        lon, lat = self.feature("Aristarchus")
        self.assertGreater(contrast(lon, lat, 15, (40, 80)), 1.0)

    def test_apollo_11_site_is_on_dark_mare(self) -> None:
        lon, lat = self.feature("Statio Tranquillitatis")
        self.assertLess(region_mean(lon, lat, 0, 20), float(np.median(TEXTURE[~GAP])))

    def test_a_mirrored_map_would_fail(self) -> None:
        """Aristarchus is a brilliant crater in dark Oceanus Procellarum. Mirroring the map in
        longitude or latitude puts that spot somewhere unremarkable."""
        lon, lat = self.feature("Aristarchus")
        real = contrast(lon, lat, 15, (40, 80))
        self.assertGreater(real, 1.5 * contrast(-lon, lat, 15, (40, 80)), "east-west mirror")
        self.assertGreater(real, 1.5 * contrast(lon, -lat, 15, (40, 80)), "north-south mirror")


if __name__ == "__main__":
    unittest.main()
