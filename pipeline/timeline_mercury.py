"""Mercury's geometry at any moment from 2026 to 2030, from SPICE, for the Mercury page to open at
the current moment (docs/stories/SS-16.md, W7), as timeline_mars.py does for Mars.

    npm run pipeline:timeline:mercury

Python because SPICE has no good TypeScript equivalent (CLAUDE.md, Stack). Uses the kernels,
frames and aberration correction of ephemeris_mercury.py, so the timeline and the fixed epochs
agree. Mercury moves fastest of the planets (an 88-day orbit), so the interpolation error at the
shared 12-hour step is measured here and pinned like Mars's.

Outputs:
- public/data/mercury/timeline.bin: little-endian float32, one record of FIELDS per sample, every
  STEP_HOURS from START_UTC, interpolated in the app with a 4-point Lagrange polynomial
  (core/timeline.ts).
- public/data/mercury/timeline.json: the layout, the span, the interpolation error measured here
  against SPICE, and Mercury's IAU rotation constants (ephemeris_mercury.py), which the app
  evaluates itself as it does Mars's (core/timeline.ts, iauRotation).
- test/fixtures/mercury-timeline-truth.json: SPICE's values at random moments between samples,
  rotation included, for the app's own test (src/core/timeline.test.ts).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import spiceypy as spice

from download import sha256
from ephemeris_mercury import ABCORR, BODY_FRAME, load_kernels, rotation_constants
from timeline import START_UTC, STEP_HOURS, STOP_UTC, angle_deg, lagrange, spice_free_utc, unit

FIELDS = [
    "sunDirectionJ2000.x", "sunDirectionJ2000.y", "sunDirectionJ2000.z", "sunDistanceKm",
    "earthDirectionJ2000.x", "earthDirectionJ2000.y", "earthDirectionJ2000.z", "earthDistanceKm",
]  # fmt: skip
TRUTH_MOMENTS = 24
TRUTH_SEED = 2026
CHECK_MOMENTS = 2000

ROOT = Path(__file__).resolve().parent.parent
OUT_BIN = ROOT / "public" / "data" / "mercury" / "timeline.bin"
OUT_JSON = ROOT / "public" / "data" / "mercury" / "timeline.json"
OUT_TRUTH = ROOT / "test" / "fixtures" / "mercury-timeline-truth.json"


def record(et: float) -> np.ndarray:
    """The FIELDS at one instant, as ephemeris_mercury.py describes an epoch."""
    sun, _ = spice.spkpos("SUN", et, "J2000", ABCORR, "MERCURY")
    earth, _ = spice.spkpos("EARTH", et, "J2000", ABCORR, "MERCURY")
    sun_dir, sun_km = unit(sun)
    earth_dir, earth_km = unit(earth)
    return np.concatenate([sun_dir, [sun_km], earth_dir, [earth_km]])


def build() -> dict:
    kernels = load_kernels()
    try:
        start = spice.str2et(START_UTC)
        stop = spice.str2et(STOP_UTC)
        step = STEP_HOURS * 3600.0
        count = int(round((stop - start) / step)) + 4
        first = start - step
        samples = np.array([record(first + i * step) for i in range(count)], dtype=np.float32)

        rng = np.random.default_rng(TRUTH_SEED)
        worst = {"sunDeg": 0.0, "sunKm": 0.0, "earthDeg": 0.0, "earthKm": 0.0}
        for _ in range(CHECK_MOMENTS):
            t = start + rng.random() * (stop - start)
            got = lagrange(samples, (t - first) / step)
            want = record(t)
            worst["sunDeg"] = max(worst["sunDeg"], angle_deg(got[0:3], want[0:3]))
            worst["sunKm"] = max(worst["sunKm"], abs(float(got[3] - want[3])))
            worst["earthDeg"] = max(worst["earthDeg"], angle_deg(got[4:7], want[4:7]))
            worst["earthKm"] = max(worst["earthKm"], abs(float(got[7] - want[7])))

        truths = []
        for _ in range(TRUTH_MOMENTS):
            t = start + rng.random() * (stop - start)
            values = record(t)
            truths.append(
                {
                    "utc": spice.et2utc(t, "ISOC", 3) + "Z",
                    "tdbSecondsPastJ2000": t,
                    "sunDirectionJ2000": values[0:3].tolist(),
                    "sunDistanceKm": float(values[3]),
                    "earthDirectionJ2000": values[4:7].tolist(),
                    "earthDistanceKm": float(values[7]),
                    "phaseAngleDeg": math.degrees(spice.phaseq(t, "MERCURY", "SUN", "EARTH", ABCORR)),
                    "j2000ToBodyFixed": [list(row) for row in spice.pxform("J2000", BODY_FRAME, t)],
                }
            )
        rotation = rotation_constants()
        leap = spice.gdpool("DELTET/DELTA_AT", 0, 200)
    finally:
        spice.kclear()

    OUT_BIN.parent.mkdir(parents=True, exist_ok=True)
    samples.astype("<f4").tofile(OUT_BIN)
    manifest = {
        "story": "docs/stories/SS-16.md (W7)",
        "file": OUT_BIN.name,
        "sha256": sha256(OUT_BIN),
        "encoding": "little-endian float32, one record of `fields` per sample",
        "fields": FIELDS,
        "firstSampleUtc": spice_free_utc(START_UTC, -STEP_HOURS),
        "spanUtc": [START_UTC + "Z", STOP_UTC + "Z"],
        "firstSampleTdbSecondsPastJ2000": first,
        "stepHours": STEP_HOURS,
        "samples": count,
        "interpolation": "4-point Lagrange through the samples either side (core/timeline.ts)",
        "measuredWorstError": {
            "moments": CHECK_MOMENTS,
            "seed": TRUTH_SEED,
            **{k: float(f"{v:.3g}") for k, v in worst.items()},
        },
        "timeScales": {
            "note": "As the Moon's timeline (public/data/moon/timeline.json): UTC to TDB by the span's constant offset at the first sample; no leap second in the span as of naif0012.tls.",
            "lastLeapSecond": {"deltaAtSeconds": float(leap[-2]), "fromTdbSecondsPastJ2000": float(leap[-1])},
        },
        "rotation": rotation,
        "aberrationCorrection": ABCORR,
        "kernels": kernels,
    }
    OUT_JSON.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    OUT_TRUTH.write_text(
        json.dumps(
            {
                "source": "SPICE via pipeline/timeline_mercury.py, the same kernels and corrections as public/data/mercury/ephemeris.json",
                "seed": TRUTH_SEED,
                "moments": truths,
            },
            indent=2,
            allow_nan=False,
        )
        + "\n"
    )
    return manifest


if __name__ == "__main__":
    m = build()
    print(f"{m['samples']} samples every {m['stepHours']} h, {OUT_BIN.stat().st_size / 1e3:.0f} kB")
    print(json.dumps(m["measuredWorstError"], indent=1))
