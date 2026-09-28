"""Unit tests for the albedo calibration's weighting, tiling and fit. No files needed."""

from __future__ import annotations

import math
import unittest

import numpy as np

from calibrate import disc_weighted_mean, fit_through_zero, tile_means


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


class TileMeans(unittest.TestCase):
    def test_puts_each_pixel_in_the_tile_its_centre_falls_in(self) -> None:
        # 2 pixels per degree; texture column 0 at -180, tile column 0 at 0E.
        h, w = 360, 720
        values = np.zeros((h, w))
        lon = (np.arange(w) + 0.5) * 360 / w - 180
        values[:, (lon > 10) & (lon < 11)] = 1.0  # tile column 10
        values[:, (lon > -1) & (lon < 0)] = 0.5  # tile column 359
        means, gappy = tile_means(values, np.zeros((h, w), bool))
        self.assertEqual(means.shape, (180, 360))
        self.assertTrue(np.all(means[:, 10] == 1.0))
        self.assertTrue(np.all(means[:, 359] == 0.5))
        self.assertEqual(float(means[:, 11].max()), 0.0)
        self.assertFalse(gappy.any())

    def test_flags_tiles_with_any_gap(self) -> None:
        h, w = 360, 720
        gap = np.zeros((h, w), bool)
        gap[0, 360] = True  # row 0 (89.75N), longitude 0.25E: tile (0, 0)
        _, gappy = tile_means(np.ones((h, w)), gap)
        self.assertTrue(gappy[0, 0])
        self.assertEqual(int(gappy.sum()), 1)


class FitThroughZero(unittest.TestCase):
    def test_recovers_an_exact_scale(self) -> None:
        x = np.linspace(0.05, 0.4, 50)
        fit = fit_through_zero(x, 0.52 * x)
        self.assertAlmostEqual(fit["k"], 0.52, 12)
        self.assertAlmostEqual(fit["rmsResidual"], 0.0, 12)
        self.assertAlmostEqual(fit["r"], 1.0, 12)

    def test_reports_an_offset_without_using_it(self) -> None:
        x = np.linspace(0.05, 0.4, 50)
        fit = fit_through_zero(x, 0.4 * x + 0.02)
        self.assertAlmostEqual(fit["withOffset"]["offset"], 0.02, 10)
        self.assertGreater(fit["k"], 0.4)


if __name__ == "__main__":
    unittest.main()
