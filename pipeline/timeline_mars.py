"""Mars's geometry at any moment from 2026 to 2030, from SPICE, for the Mars page to open at the
current moment (docs/stories/SS-14.md, W7), as pipeline/timeline.py does for the Moon (SS-13f).

    npm run pipeline:timeline:mars

Python because SPICE has no good TypeScript equivalent (CLAUDE.md, Stack). Uses the kernels,
frames and aberration correction of ephemeris_mars.py, so the timeline and the fixed epochs agree.

Outputs:
- public/data/mars/timeline.bin: little-endian float32, one record of FIELDS per sample, every
  STEP_HOURS from START_UTC, interpolated in the app with a 4-point Lagrange polynomial
  (core/timeline.ts).
- public/data/mars/timeline.json: the layout, the span, the interpolation error measured here
  against SPICE, and Mars's IAU rotation constants. Mars turns 176 degrees in 12 hours, too fast to
  interpolate, so the app evaluates IAU_MARS itself from pck00011's constants, periodic terms
  included, as SPICE does (core/timeline.ts, iauRotation).
- test/fixtures/mars-timeline-truth.json: SPICE's values at random moments between samples,
  rotation included, for the app's own test (src/core/timeline.test.ts).

The solar longitude Ls is stored as its cosine and sine, which interpolate across 360 -> 0.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import spiceypy as spice

from download import sha256
from ephemeris_mars import ABCORR, BODY_FRAME, load_kernels
from timeline import START_UTC, STEP_HOURS, STOP_UTC, angle_deg, lagrange, spice_free_utc, unit

FIELDS = [
    "sunDirectionJ2000.x", "sunDirectionJ2000.y", "sunDirectionJ2000.z", "sunDistanceKm",
    "earthDirectionJ2000.x", "earthDirectionJ2000.y", "earthDirectionJ2000.z", "earthDistanceKm",
    "cosSolarLongitudeLs", "sinSolarLongitudeLs",
]  # fmt: skip
TRUTH_MOMENTS = 24
TRUTH_SEED = 2026
CHECK_MOMENTS = 2000

ROOT = Path(__file__).resolve().parent.parent
OUT_BIN = ROOT / "public" / "data" / "mars" / "timeline.bin"
OUT_JSON = ROOT / "public" / "data" / "mars" / "timeline.json"
OUT_TRUTH = ROOT / "test" / "fixtures" / "mars-timeline-truth.json"


def record(et: float) -> np.ndarray:
    """The FIELDS at one instant, as ephemeris_mars.py describes an epoch."""
    sun, _ = spice.spkpos("SUN", et, "J2000", ABCORR, "MARS")
    earth, _ = spice.spkpos("EARTH", et, "J2000", ABCORR, "MARS")
    sun_dir, sun_km = unit(sun)
    earth_dir, earth_km = unit(earth)
    ls = spice.lspcn("MARS", et, ABCORR)
    return np.concatenate([sun_dir, [sun_km], earth_dir, [earth_km], [math.cos(ls), math.sin(ls)]])


def rotation_constants() -> dict:
    """pck00011's IAU_MARS model, as the kernel pool holds it."""

    def values(name: str) -> list[float]:
        return [float(x) for x in spice.gdpool(name, 0, 1000)]

    degree = int(spice.gipool("BODY4_MAX_PHASE_DEGREE", 0, 1)[0])
    angles = values("BODY4_NUT_PREC_ANGLES")
    width = degree + 1
    return {
        "frame": BODY_FRAME,
        "source": "pck00011.tpc: BODY499_POLE_RA, BODY499_POLE_DEC, BODY499_PM, BODY499_NUT_PREC_RA/DEC/PM, BODY4_NUT_PREC_ANGLES (BODY4_MAX_PHASE_DEGREE 2). Angles in degrees; T Julian centuries and d days of TDB since J2000. alpha = poly(T) + sum ra_k sin(theta_k), delta = poly(T) + sum dec_k cos(theta_k), W = poly(d) + sum pm_k sin(theta_k), theta_k = A_k + B_k T + C_k T^2",
        "poleRaDeg": values("BODY499_POLE_RA"),
        "poleDecDeg": values("BODY499_POLE_DEC"),
        "primeMeridianDeg": values("BODY499_PM"),
        "nutPrecRaDeg": values("BODY499_NUT_PREC_RA"),
        "nutPrecDecDeg": values("BODY499_NUT_PREC_DEC"),
        "nutPrecPmDeg": values("BODY499_NUT_PREC_PM"),
        "nutPrecAnglesDeg": [angles[i : i + width] for i in range(0, len(angles), width)],
    }


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
        worst = {"sunDeg": 0.0, "sunKm": 0.0, "earthDeg": 0.0, "earthKm": 0.0, "lsDeg": 0.0}
        for _ in range(CHECK_MOMENTS):
            t = start + rng.random() * (stop - start)
            got = lagrange(samples, (t - first) / step)
            want = record(t)
            worst["sunDeg"] = max(worst["sunDeg"], angle_deg(got[0:3], want[0:3]))
            worst["sunKm"] = max(worst["sunKm"], abs(float(got[3] - want[3])))
            worst["earthDeg"] = max(worst["earthDeg"], angle_deg(got[4:7], want[4:7]))
            worst["earthKm"] = max(worst["earthKm"], abs(float(got[7] - want[7])))
            worst["lsDeg"] = max(worst["lsDeg"], angle_deg(np.append(got[8:10], 0), np.append(want[8:10], 0)))

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
                    "solarLongitudeLsDeg": math.degrees(spice.lspcn("MARS", t, ABCORR)),
                    "phaseAngleDeg": math.degrees(spice.phaseq(t, "MARS", "SUN", "EARTH", ABCORR)),
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
        "story": "docs/stories/SS-14.md (W7)",
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
                "source": "SPICE via pipeline/timeline_mars.py, the same kernels and corrections as public/data/mars/ephemeris.json",
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
