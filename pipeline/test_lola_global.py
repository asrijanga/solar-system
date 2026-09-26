"""Unit tests for LOLA global albedo registration (lola_global.py). No files needed."""

from __future__ import annotations

import unittest

import numpy as np

from lola_global import LINES, SAMPLES, bilinear, pixel_coordinates


def at(lat: float, lon: float) -> tuple[float, float]:
    line, sample = pixel_coordinates(np.array([lat]), np.array([lon]))
    return float(line[0]), float(sample[0])


class Registration(unittest.TestCase):
    """The label: pixel registered, 10 per degree, CENTER_LONGITUDE 180, offsets 899.5 and
    1799.5, east-positive. So the first pixel is centred at 89.95 N, 0.05 E."""

    def test_the_first_pixel_centre(self) -> None:
        self.assertEqual(at(89.95, 0.05), (0.0, 0.0))

    def test_the_label_offsets_are_the_equator_and_180_degrees(self) -> None:
        line, sample = at(0.0, 180.0)
        # PDS: latitude = -(LINE - 899.5 - 1) / 10 for 1-based LINE, so the equator is 0-based 899.5.
        self.assertAlmostEqual(line, 899.5, 9)
        self.assertAlmostEqual(sample, 1799.5, 9)

    def test_west_longitudes_wrap_to_the_east(self) -> None:
        self.assertAlmostEqual(at(0.0, -179.95)[1], at(0.0, 180.05)[1], 9)
        self.assertAlmostEqual(at(0.0, -0.05)[1], SAMPLES - 1, 9)


class Sampling(unittest.TestCase):
    def test_bilinear_hits_pixel_centres_and_wraps_the_seam(self) -> None:
        image = np.arange(LINES * SAMPLES, dtype=np.float64).reshape(LINES, SAMPLES)
        self.assertEqual(bilinear(image, np.array([5.0]), np.array([7.0]))[0], image[5, 7])
        # Halfway between the last and first samples of a row.
        v = bilinear(image, np.array([5.0]), np.array([SAMPLES - 0.5]))[0]
        self.assertAlmostEqual(v, (image[5, SAMPLES - 1] + image[5, 0]) / 2)
        # Clamped at the poles.
        self.assertEqual(bilinear(image, np.array([-3.0]), np.array([7.0]))[0], image[0, 7])


if __name__ == "__main__":
    unittest.main()
