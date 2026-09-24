"""Unit tests for the albedo calibration's weighting. No files needed."""

from __future__ import annotations

import math
import unittest

import numpy as np

from calibrate import disc_weighted_mean


class DiscWeightedMean(unittest.TestCase):
    def test_uniform_map_gives_its_own_value(self) -> None:
        values = np.full((90, 180), 0.3)
        self.assertAlmostEqual(disc_weighted_mean(values, np.zeros_like(values, bool)), 0.3, 12)

    def test_ignores_the_far_side_entirely(self) -> None:
        h, w = 90, 180
        values = np.full((h, w), 0.2)
        lon = (np.arange(w) + 0.5) * 360 / w - 180
        values[:, np.abs(lon) > 90] = 99.0
        self.assertAlmostEqual(disc_weighted_mean(values, np.zeros((h, w), bool)), 0.2, 12)

    def test_weights_the_disc_centre_by_projected_area(self) -> None:
        # Values equal to mu itself: the projected-area mean of mu over a disc is 2/3.
        h, w = 1800, 3600
        lat = np.radians(90 - (np.arange(h) + 0.5) * 180 / h)
        lon = np.radians((np.arange(w) + 0.5) * 360 / w - 180)
        mu = np.clip(np.cos(lat)[:, None] * np.cos(lon)[None, :], 0, None)
        self.assertAlmostEqual(disc_weighted_mean(mu, np.zeros((h, w), bool)), 2 / 3, 4)

    def test_leaves_gaps_out_rather_than_counting_them(self) -> None:
        values = np.full((90, 180), 0.25)
        gap = np.zeros_like(values, bool)
        gap[40:50, 85:95] = True
        values[gap] = math.nan
        self.assertAlmostEqual(disc_weighted_mean(np.nan_to_num(values), gap), 0.25, 12)


if __name__ == "__main__":
    unittest.main()
