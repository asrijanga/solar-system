"""Unit tests for the star pipeline. No network: lines are built from the ReadMe layout.

    npm run pipeline:test
"""

from __future__ import annotations

import math
import struct
import unittest

import stars


def catalogue_line(**fields: str) -> str:
    """A 197-byte catalogue record with the given 1-based, inclusive byte ranges filled."""
    line = [" "] * 197
    for spec, value in fields.items():
        first, last = (int(n) for n in spec[1:].split("_"))
        width = last - first + 1
        assert len(value) <= width, spec
        line[first - 1 : last] = list(value.rjust(width))
    return "".join(line)


# Betelgeuse, HR 2061, with values as the catalogue gives them.
BETELGEUSE = catalogue_line(
    b1_4="2061",
    b76_77="05", b78_79="55", b80_83="10.3",
    b84_84="+", b85_86="07", b87_88="24", b89_90="25",
    b103_107="0.50", b110_114="1.85",
    b149_154="+0.026", b155_160="+0.009",
)


class ParseLine(unittest.TestCase):
    def test_parses_betelgeuse(self) -> None:
        s = stars.parse_line(BETELGEUSE)
        assert s is not None
        self.assertEqual(s.hr, 2061)
        self.assertAlmostEqual(s.ra_deg, (5 + 55 / 60 + 10.3 / 3600) * 15, places=9)
        self.assertAlmostEqual(s.dec_deg, 7 + 24 / 60 + 25 / 3600, places=9)
        self.assertEqual(s.vmag, 0.5)
        self.assertEqual(s.b_v, 1.85)

    def test_negative_declination_applies_to_minutes_and_seconds(self) -> None:
        line = BETELGEUSE[:83] + "-" + BETELGEUSE[84:]
        s = stars.parse_line(line)
        assert s is not None
        self.assertAlmostEqual(s.dec_deg, -(7 + 24 / 60 + 25 / 3600), places=9)

    def test_removed_entry_has_blank_position(self) -> None:
        self.assertIsNone(stars.parse_line(catalogue_line(b1_4="92")))

    def test_blank_colour_index_is_none_not_zero(self) -> None:
        line = BETELGEUSE[:109] + "     " + BETELGEUSE[114:]
        s = stars.parse_line(line)
        assert s is not None
        self.assertIsNone(s.b_v)


class Geometry(unittest.TestCase):
    def test_unit_vectors(self) -> None:
        self.assertEqual(stars.unit_vector(0, 0), (1.0, 0.0, 0.0))
        x, y, z = stars.unit_vector(90, 0)
        self.assertAlmostEqual(x, 0, places=12)
        self.assertAlmostEqual(y, 1, places=12)
        x, y, z = stars.unit_vector(123, 90)
        self.assertAlmostEqual(z, 1, places=12)


class Encoding(unittest.TestCase):
    def test_record_layout_and_nan_for_missing_colour(self) -> None:
        s = stars.parse_line(BETELGEUSE)
        assert s is not None
        missing = stars.Star(1, 0.0, 0.0, 5.0, None, None, None)
        data = stars.encode([s, missing])
        self.assertEqual(len(data), 2 * stars.FLOATS_PER_STAR * 4)
        first = struct.unpack_from("<6f", data, 0)
        self.assertAlmostEqual(first[3], 0.5, places=6)
        self.assertEqual(first[5], 2061.0)
        second = struct.unpack_from("<6f", data, 24)
        self.assertTrue(math.isnan(second[4]))


class ProperMotion(unittest.TestCase):
    def test_largest_drift_uses_total_motion_over_the_longest_half_span(self) -> None:
        slow = stars.Star(1, 0, 0, 5, None, 0.001, 0.0)
        fast = stars.Star(2, 0, 0, 5, None, 3.0, 4.0)  # 5 arcsec/yr in total
        hr, arcsec = stars.largest_drift([slow, fast])
        self.assertEqual(hr, 2)
        self.assertAlmostEqual(arcsec, 5.0 * 100)


if __name__ == "__main__":
    unittest.main()
