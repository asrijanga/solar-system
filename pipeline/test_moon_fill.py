"""Unit tests for the gap fill used before lossy encoding. No files needed."""

from __future__ import annotations

import unittest

import numpy as np

from moon import albedo_for_encoding, pull_push_fill


class PullPushFill(unittest.TestCase):
    def test_leaves_every_valid_pixel_exactly_as_it_was(self) -> None:
        rng = np.random.default_rng(1)
        values = rng.integers(1, 256, size=(37, 53)).astype(np.float64)
        valid = rng.random((37, 53)) > 0.2
        filled = pull_push_fill(values, valid)
        self.assertTrue(np.array_equal(filled[valid], values[valid]))

    def test_fills_only_within_the_range_of_real_data(self) -> None:
        values = np.full((16, 16), 50.0)
        values[:, 8:] = 150.0
        valid = np.ones((16, 16), dtype=bool)
        valid[4:12, 4:12] = False
        filled = pull_push_fill(values, valid)
        self.assertGreaterEqual(filled.min(), 50.0)
        self.assertLessEqual(filled.max(), 150.0)

    def test_encoding_input_never_uses_zero(self) -> None:
        master = np.array([[0, 10], [20, 0]], dtype=np.uint8)
        self.assertGreater(albedo_for_encoding(master).min(), 0)

    def test_is_deterministic(self) -> None:
        values = np.arange(64, dtype=np.float64).reshape(8, 8)
        valid = values % 3 != 0
        self.assertTrue(np.array_equal(pull_push_fill(values, valid), pull_push_fill(values, valid)))


if __name__ == "__main__":
    unittest.main()
