"""Unit tests for LOLA polar registration. No files needed."""

from __future__ import annotations

import unittest

import numpy as np

from lola_poles import OFFSET, bilinear, pixel_coordinates, provenance, smoothstep


def at(pole: str, lat: float, lon: float) -> tuple[float, float]:
    line, sample = pixel_coordinates(pole, np.array([lat]), np.array([lon]))
    return float(line[0]), float(sample[0])


class Orientation(unittest.TestCase):
    """DSMAP_POLAR.CAT prose: 90 E to the right at both poles; in the south longitude 0
    points up, in the north down. Confirmed against Clementine (docs/stories/SS-6b.md)."""

    def test_the_pole_is_the_label_offset(self) -> None:
        for pole, lat in (("south", -90.0), ("north", 90.0)):
            line, sample = at(pole, lat, 0.0)
            self.assertAlmostEqual(line, OFFSET, 9)
            self.assertAlmostEqual(sample, OFFSET, 9)

    def test_south_longitude_0_points_up_and_90_east_right(self) -> None:
        line, sample = at("south", -80.0, 0.0)
        self.assertLess(line, OFFSET)
        self.assertAlmostEqual(sample, OFFSET, 6)
        line, sample = at("south", -80.0, 90.0)
        self.assertGreater(sample, OFFSET)
        self.assertAlmostEqual(line, OFFSET, 6)

    def test_north_longitude_0_points_down_and_90_east_right(self) -> None:
        line, _ = at("north", 80.0, 0.0)
        self.assertGreater(line, OFFSET)
        _, sample = at("north", 80.0, 90.0)
        self.assertGreater(sample, OFFSET)

    def test_scale_is_1000_m_per_pixel_true_at_the_pole(self) -> None:
        # 1 deg from the pole is 30.32 km along the surface; stereographic is exact there.
        line, _ = at("south", -89.0, 0.0)
        self.assertAlmostEqual(OFFSET - line, 30.3234, 2)


class Sampling(unittest.TestCase):
    def test_bilinear_reproduces_pixel_centres_and_midpoints(self) -> None:
        image = np.arange(2532 * 2532, dtype=np.float64).reshape(2532, 2532)
        v = bilinear(image, np.array([10.0, 10.5]), np.array([20.0, 20.0]))
        self.assertEqual(v[0], image[10, 20])
        self.assertAlmostEqual(v[1], (image[10, 20] + image[11, 20]) / 2)

    def test_blend_weight_and_provenance(self) -> None:
        w = smoothstep(65, 75, np.array([60.0, 65.0, 70.0, 75.0, 89.0]))
        self.assertEqual(list(w), [0.0, 0.0, 0.5, 1.0, 1.0])
        self.assertEqual(provenance(-50), "clementine")
        self.assertEqual(provenance(70), "blend")
        self.assertEqual(provenance(-80), "lola")


if __name__ == "__main__":
    unittest.main()
