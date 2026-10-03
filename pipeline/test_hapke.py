"""pipeline/hapke.py against src/core/hapke.ts (test/fixtures/hapke-values.json)."""

import json
import math
import unittest
from pathlib import Path

from hapke import hapke

FIXTURE = Path(__file__).resolve().parent.parent / "test" / "fixtures" / "hapke-values.json"


class HapkePort(unittest.TestCase):
    def test_matches_typescript(self):
        laws = json.loads(FIXTURE.read_text())["laws"]
        for law in laws:
            for case in law["cases"]:
                got = float(
                    hapke(
                        math.cos(math.radians(case["i"])),
                        math.cos(math.radians(case["e"])),
                        math.cos(math.radians(case["g"])),
                        law["p"],
                        law["thetaBarDeg"],
                    )
                )
                self.assertAlmostEqual(got, case["value"], delta=1e-12 + 1e-9 * abs(case["value"]), msg=f"{law['name']} {case}")


if __name__ == "__main__":
    unittest.main()
