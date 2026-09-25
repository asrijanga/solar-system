"""Tests for combining terrain sources (pipeline/quantized_mesh.py, pipeline/terrain_tiles.py)."""

from __future__ import annotations

import unittest

import numpy as np

from quantized_mesh import Blend, Region
from terrain_tiles import box_mean


def flat(km: float, nan_at: tuple[int, int] | None = None) -> Region:
    """A 10 x 10 degree grid at 10 px/deg, north edge 0, west edge 0, constant height."""
    rows = np.full((100, 100), km, dtype=np.float32)
    if nan_at is not None:
        rows[nan_at] = np.nan
    return Region(rows, lat_top=0.0, lon_west=0.0, ppd=10)


class BlendTest(unittest.TestCase):
    def setUp(self) -> None:
        self.blend = Blend(flat(1.0), flat(0.0), box=(2.0, -8.0, 8.0, -2.0), band_deg=1.0)

    def test_fine_inside_the_band_base_outside_linear_between(self) -> None:
        lat = np.array([-5.0, -5.0, -5.0, -5.0])
        lon = np.array([5.0, 1.0, 2.0, 2.5])
        np.testing.assert_allclose(self.blend.heights_m(lat, lon), [1000.0, 0.0, 0.0, 500.0])

    def test_a_hole_in_the_fine_source_takes_the_base_measurement(self) -> None:
        holed = Blend(flat(1.0, nan_at=(50, 50)), flat(0.0), box=(2.0, -8.0, 8.0, -2.0), band_deg=1.0)
        # Every bilinear sample touching the no-data sample is the base's, not a mix.
        h = holed.heights_m(np.array([-5.0, -5.05, -3.0]), np.array([5.0, 5.05, 3.0]))
        np.testing.assert_allclose(h, [0.0, 0.0, 1000.0])


class BoxMeanTest(unittest.TestCase):
    def test_mean_of_each_neighbourhood(self) -> None:
        grid = np.arange(25, dtype=np.float64).reshape(5, 5)
        out = box_mean(grid, 3)
        self.assertEqual(out.shape, grid.shape)
        self.assertAlmostEqual(out[2, 2], grid[1:4, 1:4].mean())
        self.assertAlmostEqual(out[0, 0], np.pad(grid, 1, mode="edge")[0:3, 0:3].mean())


if __name__ == "__main__":
    unittest.main()
