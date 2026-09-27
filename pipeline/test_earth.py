"""Checks of Earth's face (SS-13c): the readers against synthetic files built from the layouts
they claim to read, the geometry, and the committed map. No network: the committed map is what
CI checks, since the sources (about 1.6 GB) are too large to download there."""

from __future__ import annotations

import bz2
import json
import math
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

import earth

ROOT = Path(__file__).resolve().parent.parent
FACES = json.loads((ROOT / "public/data/earth/faces.json").read_text())
EPHEMERIS = json.loads((ROOT / "public/data/moon/ephemeris.json").read_text())


def hsd_segment(counts: np.ndarray, first_line: int, gain: float, constant: float, c_prime: float) -> bytes:
    """A minimal Himawari Standard Data segment: blocks 1, 2, 3, 5 and 7 at the offsets the
    reader uses, then blocks 4, 6, 8, 9 and 10 as padding and block 11 to end the header."""
    lines, columns = counts.shape
    blocks = []

    def block(number: int, length: int, fields: list[tuple[int, str, object]]) -> bytes:
        b = bytearray(length)
        struct.pack_into("<BH", b, 0, number, length)
        for offset, fmt, value in fields:
            struct.pack_into(fmt, b, offset, *(value if isinstance(value, tuple) else (value,)))
        return bytes(b)

    lengths = {1: 282, 2: 50, 3: 127, 4: 139, 5: 147, 6: 259, 7: 47, 8: 81, 9: 85, 10: 47, 11: 259}
    header = sum(lengths.values())
    blocks.append(block(1, lengths[1], [(70, "<I", header)]))
    blocks.append(block(2, lengths[2], [(3, "<H", 16), (5, "<HH", (columns, lines))]))
    blocks.append(block(3, lengths[3], [(3, "<dIIff", (140.7, 40932549, 40932549, 5500.5, 5500.5)), (27, "<d", 42164.0), (35, "<dd", (6378.137, 6356.7523))]))
    blocks.append(block(4, lengths[4], []))
    blocks.append(block(5, lengths[5], [(3, "<Hd", (3, 0.64)), (15, "<HH", (65535, 65534)), (19, "<ddd", (1.0, 0.0, c_prime)), (43, "<d", 60940.0), (51, "<dd", (gain, constant))]))
    blocks.append(block(6, lengths[6], []))
    blocks.append(block(7, lengths[7], [(3, "<BB", (1, 1)), (5, "<H", first_line)]))
    for n in (8, 9, 10, 11):
        blocks.append(block(n, lengths[n], []))
    return bz2.compress(b"".join(blocks) + counts.astype("<u2").tobytes())


class Readers(unittest.TestCase):
    def test_hsd_calibration_and_missing_counts(self) -> None:
        counts = np.array([[100, 200, 65535, 400], [500, 600, 700, 65534]], dtype=np.uint16)
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "seg.DAT.bz2"
            path.write_bytes(hsd_segment(counts, 1, 0.5, -2.0, 0.01))
            image, meta = earth.read_ahi([path], 1)
        # The updated gain and constant (offsets 51 and 59) are used, not the nominal ones.
        self.assertAlmostEqual(float(image[0, 0]), (100 * 0.5 - 2.0) * 0.01, places=6)
        self.assertAlmostEqual(float(image[1, 2]), (700 * 0.5 - 2.0) * 0.01, places=6)
        self.assertTrue(np.isnan(image[0, 2]) and np.isnan(image[1, 3]))
        self.assertEqual(meta["sub_lon"], 140.7)
        self.assertEqual(meta["distance_km"], 42164.0)

    def test_block_mean_leaves_a_block_with_a_gap_missing(self) -> None:
        image = np.array([[1, 2, 3, np.nan], [3, 4, 5, 6]], dtype=np.float32)
        out = earth.block_mean(image, 2)
        self.assertAlmostEqual(float(out[0, 0]), 2.5)
        self.assertTrue(np.isnan(out[0, 1]))


class Geometry(unittest.TestCase):
    def test_the_sub_satellite_point_is_straight_down_and_centred(self) -> None:
        meta = {"sub_lon": 140.7, "distance": 42164.0, "req": 6378.137, "rpol": 6356.7523, "cfac": 40932549, "lfac": 40932549, "coff": 5500.5, "loff": 5500.5, "factor": 1}
        image = np.arange(11000 * 11000, dtype=np.float32).reshape(11000, 11000)
        value, cz = earth.ahi_sample(image, meta, np.array([140.7]), np.array([0.0]))
        self.assertAlmostEqual(float(cz[0]), 1.0, places=9)
        # COFF and LOFF, 5500.5, are the corner of four pixels: 0-based 5499 or 5500 each way.
        line, column = divmod(int(value[0]), 11000)
        self.assertIn(line, (5499, 5500))
        self.assertIn(column, (5499, 5500))

    def test_the_far_side_is_not_seen(self) -> None:
        sx, sy, sz, cz = earth.geostationary(np.array([140.7 + 180.0]), np.array([0.0]), 140.7, 42164.0, 6378.137, 6356.7523)
        self.assertLess(float(cz[0]), 0)

    def test_the_view_zenith_grows_with_distance_from_the_sub_satellite_point(self) -> None:
        lons = np.array([140.7, 160.7, 180.7, 200.7])
        *_, cz = earth.geostationary(lons, np.zeros(4), 140.7, 42164.0, 6378.137, 6356.7523)
        self.assertTrue(np.all(np.diff(cz) < 0))


class CommittedMap(unittest.TestCase):
    """The first-quarter map as it ships."""

    def setUp(self) -> None:
        instant = FACES["instants"]["first-quarter-2026-01"]
        rgba = np.asarray(Image.open(ROOT / "public" / instant["image"]))
        self.assertEqual(rgba.shape, (earth.HEIGHT, earth.WIDTH, 4))
        v = rgba[..., :3] / 255.0
        self.i_over_f = np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)
        self.measured = rgba[..., 3] == 255
        self.epoch = next(e for e in EPHEMERIS["epochs"] if e["id"] == "first-quarter-2026-01")
        self.normal = earth.unit_grid()
        self.mu0 = self.normal @ earth.sun_earth_fixed(self.epoch)
        self.to_moon = np.array(self.epoch["j2000ToEarthFixed"]) @ -np.array(self.epoch["earthDirectionJ2000"])

    def test_night_is_dark_and_day_is_not(self) -> None:
        night = self.measured & (self.mu0 < -0.1)  # the Sun more than 6 degrees down: no twilight
        day = self.measured & (self.mu0 > 0.3)
        self.assertGreater(night.sum(), 100000)
        self.assertLess(float(np.percentile(self.i_over_f[night].max(-1), 99.9)), 0.01)
        self.assertGreater(float(np.median(self.i_over_f[day].mean(-1))), 0.05)

    def test_what_the_moon_sees_lit_is_measured(self) -> None:
        facing = np.clip(self.normal @ self.to_moon, 0, None)
        area = np.cos(np.radians(90 - (np.arange(earth.HEIGHT) + 0.5) / earth.HEIGHT * 180))[:, None]
        lit = (self.mu0 > 0) & (facing > 0)
        weight = area * facing
        coverage = (weight * (lit & self.measured)).sum() / (weight * lit).sum()
        self.assertGreater(coverage, 0.995)

    def test_the_recorded_disc_brightness_is_the_committed_maps(self) -> None:
        stored = FACES["instants"]["first-quarter-2026-01"]["discIOverFFromMoon"]["rgb"]
        again = earth.disc_i_over_f(self.i_over_f, self.measured, self.epoch)
        for a, b in zip(stored, again):
            self.assertAlmostEqual(a, b, places=6)

    def test_disc_brightness_matches_earths_bond_albedo_at_this_phase(self) -> None:
        """The disc-averaged I/F the Moon sees, in red (0.64 um, the band nearest the middle of
        the Sun's energy of the three), against a Lambert sphere reflecting Earth's Bond albedo,
        0.306 (NASA Earth fact sheet), at this phase: (A/1.5) x Phi(alpha). Tolerance 30%, set
        before measuring: Earth is not a Lambert sphere and one instant's clouds are not the
        yearly mean.

        As first written (SS-13c) the reference was a Lambert sphere of the geometric albedo,
        0.434. That sphere would reflect 65% of the sunlight it gets, over twice Earth's 30.6%:
        Earth's phase integral is 0.306 / 0.434 = 0.71, not a Lambert sphere's 1.5, because air
        and clouds send light back towards the Sun. It predicted 0.138 here, the map gave 0.070,
        and the check failed at 49%. The reference was changed, not the tolerance; the owner is
        asked to approve the change in the PR."""
        facing = np.clip(self.normal @ self.to_moon, 0, None)
        area = np.cos(np.radians(90 - (np.arange(earth.HEIGHT) + 0.5) / earth.HEIGHT * 180))[:, None]
        weight = area * facing  # each place's share of the disc as the Moon sees it
        values = np.where(self.measured, self.i_over_f[..., 0], 0)
        disc = float((weight * values).sum() / weight.sum())
        sun = earth.sun_earth_fixed(self.epoch)
        alpha = math.acos(float(np.dot(sun, self.to_moon)))
        lambert = (math.sin(alpha) + (math.pi - alpha) * math.cos(alpha)) / math.pi
        expected = 0.306 / 1.5 * lambert
        print(f"disc I/F {disc:.4f}; Lambert sphere of Bond albedo 0.306 at phase {math.degrees(alpha):.1f} deg: {expected:.4f}")
        self.assertLess(abs(disc / expected - 1), 0.30)

if __name__ == "__main__":
    unittest.main()
