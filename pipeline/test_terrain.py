"""Checks the committed relief against its manifest, the IAU Gazetteer and Chang'E-1.

No network and no source file: the 1 GB LOLA grid is rebuilt locally by pipeline:terrain.
"""

from __future__ import annotations

import hashlib
import json
import math
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from terrain import decode_component

ROOT = Path(__file__).resolve().parent.parent
MOON = ROOT / "public/data/moon"
MANIFEST = json.loads((MOON / "terrain.json").read_text())
EAST = decode_component(np.array(Image.open(MOON / "normal-east.webp").convert("L")))
NORTH = decode_component(np.array(Image.open(MOON / "normal-north.webp").convert("L")))
RGB = np.array(Image.open(MOON / "height.webp").convert("RGB")).astype(np.int64)
HEIGHT_M = ((RGB[..., 0] << 8) | RGB[..., 1]) - MANIFEST["height"]["offset"]
GAZETTEER = {
    f["name"]: f
    for f in json.loads((ROOT / "test/fixtures/iau-gazetteer-moon.json").read_text())["features"]
}
R_KM = 1737.4


def pixel(shape: tuple[int, int], lat: float, lon: float) -> tuple[int, int]:
    h, w = shape
    return int((90 - lat) / 180 * h), int((lon + 180) / 360 * w) % w


def offset(lat: float, lon: float, north_km: float, east_km: float) -> tuple[float, float]:
    """A point a short distance away on the sphere (small-offset approximation)."""
    dlat = math.degrees(north_km / R_KM)
    dlon = math.degrees(east_km / (R_KM * math.cos(math.radians(lat))))
    return lat + dlat, lon + dlon


def mean_near(grid: np.ndarray, lat: float, lon: float, box: int = 2) -> float:
    r, c = pixel(grid.shape, lat, lon)
    cols = np.arange(c - box, c + box + 1) % grid.shape[1]
    return float(grid[r - box : r + box + 1][:, cols].mean())


class Integrity(unittest.TestCase):
    def test_files_match_their_manifest(self) -> None:
        for name, digest in MANIFEST["normals"]["sha256"].items():
            self.assertEqual(hashlib.sha256((MOON / name).read_bytes()).hexdigest(), digest, name)
        self.assertEqual(hashlib.sha256((MOON / "height.webp").read_bytes()).hexdigest(), MANIFEST["height"]["sha256"])
        self.assertEqual(EAST.shape, (MANIFEST["normals"]["height"], MANIFEST["normals"]["width"]))
        self.assertEqual(HEIGHT_M.shape, (MANIFEST["height"]["height"], MANIFEST["height"]["width"]))

    def test_height_decodes_exactly_to_the_recorded_sum(self) -> None:
        self.assertEqual(int((HEIGHT_M + MANIFEST["height"]["offset"]).sum()), MANIFEST["height"]["decodedSum"])

    def test_normals_are_unit_length_and_slopes_plausible(self) -> None:
        self.assertLessEqual(float((EAST**2 + NORTH**2).max()), 1.0)
        slope = np.degrees(np.arcsin(np.sqrt(np.clip(EAST**2 + NORTH**2, 0, 1))))
        # Lunar slopes at a few km baseline: a few degrees typically, rarely beyond 35.
        self.assertLess(float(np.median(slope)), 6)
        self.assertLess(float(np.percentile(slope, 99.99)), 40)


class AgainstChangE1(unittest.TestCase):
    def test_lola_extremes_agree_with_an_independent_mission(self) -> None:
        for name, e in MANIFEST["groundTruth"]["extremes"].items():
            self.assertLess(abs(e["differenceKm"]), 0.25, name)


class AgainstTheGazetteer(unittest.TestCase):
    def test_tycho_inner_walls_face_inwards(self) -> None:
        """Half-way down Tycho's walls (radius ~0.35 D from centre), each wall faces the
        crater centre: the west wall's normal points east, the north wall's points south."""
        t = GAZETTEER["Tycho"]
        lat, lon, d = t["latDeg"], t["lonDeg"], t["diameterKm"]
        k = 0.35 * d
        west = mean_near(EAST, *offset(lat, lon, 0, -k))
        east = mean_near(EAST, *offset(lat, lon, 0, k))
        north = mean_near(NORTH, *offset(lat, lon, k, 0))
        south = mean_near(NORTH, *offset(lat, lon, -k, 0))
        self.assertGreater(west, 0.05)
        self.assertLess(east, -0.05)
        self.assertLess(north, -0.05)
        self.assertGreater(south, 0.05)

    def test_mare_crisium_is_a_basin(self) -> None:
        c = GAZETTEER["Mare Crisium"]
        floor = mean_near(HEIGHT_M, c["latDeg"], c["lonDeg"], box=3)
        rim = np.mean([mean_near(HEIGHT_M, *offset(c["latDeg"], c["lonDeg"], n, e), box=2) for n, e in ((450, 0), (-450, 0), (0, 450), (0, -450))])
        self.assertLess(floor, rim - 1000)

    def test_a_mirrored_relief_would_fail(self) -> None:
        """Mirroring east-west swaps which of Tycho's walls faces east."""
        t = GAZETTEER["Tycho"]
        k = 0.35 * t["diameterKm"]
        mirrored_west = mean_near(EAST, *offset(t["latDeg"], -t["lonDeg"], 0, -k))
        self.assertLess(abs(mirrored_west), 0.05)


if __name__ == "__main__":
    unittest.main()
