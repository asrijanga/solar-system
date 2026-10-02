"""The Moon's geometry at any moment from 2026 to 2030, from SPICE, for the page to open at the
current moment (docs/stories/SS-13f.md).

    npm run pipeline:timeline

Python because SPICE has no good TypeScript equivalent (CLAUDE.md, Stack). Uses the kernels,
frames and aberration correction of ephemeris.py, so the timeline and the fixed epochs agree.

Outputs:
- public/data/moon/timeline.bin: little-endian float32, one record of FIELDS per sample, every
  STEP_HOURS from START_UTC. The app interpolates it with a 4-point Lagrange polynomial
  (core/timeline.ts).
- public/data/moon/timeline.json: the layout, the span, Earth's IAU rotation constants (the app
  computes Earth's turn itself: it turns 180 degrees in 12 hours, too fast to interpolate), and
  the interpolation error measured here against SPICE.
- test/fixtures/moon-timeline-truth.json: SPICE's values at fixed random moments between samples,
  for the app's own interpolation test (src/core/timeline.test.ts).

The step was chosen by measurement (2026-10-02): 4-point Lagrange at 6, 12 and 24 h steps gave at
worst 2e-5, 3e-4 and 5e-3 deg in Earth's direction. 12 h keeps every error far below a pixel
(Earth's 1.9 deg disc is about 80 px on a phone) and the file at 263 KB.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import spiceypy as spice

from download import sha256
from ephemeris import ABCORR, BODY_FRAME, EARTH_FRAME, load_kernels

START_UTC = "2026-01-01T00:00:00"
STOP_UTC = "2031-01-01T00:00:00"
STEP_HOURS = 12
FIELDS = [
    "sunDirectionJ2000.x", "sunDirectionJ2000.y", "sunDirectionJ2000.z", "sunDistanceKm",
    "earthDirectionJ2000.x", "earthDirectionJ2000.y", "earthDirectionJ2000.z", "earthDistanceKm",
    "j2000ToBodyFixed[0][0]", "j2000ToBodyFixed[0][1]", "j2000ToBodyFixed[0][2]",
    "j2000ToBodyFixed[1][0]", "j2000ToBodyFixed[1][1]", "j2000ToBodyFixed[1][2]",
    "j2000ToBodyFixed[2][0]", "j2000ToBodyFixed[2][1]", "j2000ToBodyFixed[2][2]",
    "earthSunDistanceKm",
]  # fmt: skip
TRUTH_MOMENTS = 24
TRUTH_SEED = 2026
CHECK_MOMENTS = 2000

ROOT = Path(__file__).resolve().parent.parent
OUT_BIN = ROOT / "public" / "data" / "moon" / "timeline.bin"
OUT_JSON = ROOT / "public" / "data" / "moon" / "timeline.json"
OUT_TRUTH = ROOT / "test" / "fixtures" / "moon-timeline-truth.json"


def unit(v) -> tuple[np.ndarray, float]:
    """Plain IEEE arithmetic, as ephemeris.py's: numpy's norm can round the last bit differently
    on different CPUs, which made CI's re-derived fixture differ from the committed one."""
    x, y, z = (float(c) for c in v)
    n = math.sqrt(x * x + y * y + z * z)
    return np.array([x / n, y / n, z / n]), n


def record(et: float) -> np.ndarray:
    """The FIELDS at one instant, as ephemeris.py describes an epoch."""
    sun, _ = spice.spkpos("SUN", et, "J2000", ABCORR, "MOON")
    earth, earth_lt = spice.spkpos("EARTH", et, "J2000", ABCORR, "MOON")
    sun_dir, sun_km = unit(sun)
    earth_dir, earth_km = unit(earth)
    rotation = np.array(spice.pxform("J2000", BODY_FRAME, et)).ravel()
    earth_sun, _ = spice.spkpos("SUN", et - earth_lt, "J2000", ABCORR, "EARTH")
    return np.concatenate([sun_dir, [sun_km], earth_dir, [earth_km], rotation, [unit(earth_sun)[1]]])


def lagrange(samples: np.ndarray, position: float) -> np.ndarray:
    """4-point Lagrange through samples k-1..k+2 at fractional index `position` (k = floor)."""
    k = int(math.floor(position))
    x = position - k
    w = [-x * (x - 1) * (x - 2) / 6, (x + 1) * (x - 1) * (x - 2) / 2, -(x + 1) * x * (x - 2) / 2, (x + 1) * x * (x - 1) / 6]
    return sum(wi * samples[k + j].astype(np.float64) for wi, j in zip(w, (-1, 0, 1, 2)))


def angle_deg(a: np.ndarray, b: np.ndarray) -> float:
    c = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def build() -> dict:
    kernels = load_kernels()
    try:
        start = spice.str2et(START_UTC)
        stop = spice.str2et(STOP_UTC)
        step = STEP_HOURS * 3600.0
        # One sample before the start and two after the end, so every moment in the span has its
        # four Lagrange points.
        count = int(round((stop - start) / step)) + 4
        first = start - step
        samples = np.array([record(first + i * step) for i in range(count)], dtype=np.float32)

        # Measured against SPICE at random moments, from the float32 file as the app reads it.
        rng = np.random.default_rng(TRUTH_SEED)
        worst = {"sunDeg": 0.0, "earthDeg": 0.0, "earthKm": 0.0, "rotationDeg": 0.0}
        for _ in range(CHECK_MOMENTS):
            t = start + rng.random() * (stop - start)
            got = lagrange(samples, (t - first) / step)
            want = record(t)
            r_got, r_want = got[8:17].reshape(3, 3), want[8:17].reshape(3, 3)
            worst["sunDeg"] = max(worst["sunDeg"], angle_deg(got[0:3], want[0:3]))
            worst["earthDeg"] = max(worst["earthDeg"], angle_deg(got[4:7], want[4:7]))
            worst["earthKm"] = max(worst["earthKm"], abs(float(got[7] - want[7])))
            # Largest angle any body axis is off by.
            worst["rotationDeg"] = max(worst["rotationDeg"], *(angle_deg(r_got[i], r_want[i]) for i in range(3)))

        truths = []
        for _ in range(TRUTH_MOMENTS):
            t = start + rng.random() * (stop - start)
            utc = spice.et2utc(t, "ISOC", 3)
            values = record(t)
            _, earth_lt = spice.spkpos("EARTH", t, "J2000", ABCORR, "MOON")
            truths.append(
                {
                    "utc": utc + "Z",
                    "tdbSecondsPastJ2000": t,
                    "sunDirectionJ2000": values[0:3].tolist(),
                    "sunDistanceKm": float(values[3]),
                    "earthDirectionJ2000": values[4:7].tolist(),
                    "earthDistanceKm": float(values[7]),
                    "j2000ToBodyFixed": values[8:17].reshape(3, 3).tolist(),
                    "earthSunDistanceKm": float(values[17]),
                    "phaseAngleDeg": math.degrees(spice.phaseq(t, "MOON", "SUN", "EARTH", ABCORR)),
                    "j2000ToEarthFixed": [list(row) for row in spice.pxform("J2000", EARTH_FRAME, t - earth_lt)],
                }
            )
        pole_ra = [float(x) for x in spice.bodvrd("EARTH", "POLE_RA", 3)[1]]
        pole_dec = [float(x) for x in spice.bodvrd("EARTH", "POLE_DEC", 3)[1]]
        pm = [float(x) for x in spice.bodvrd("EARTH", "PM", 3)[1]]
        leap = spice.gdpool("DELTET/DELTA_AT", 0, 200)
    finally:
        spice.kclear()

    OUT_BIN.parent.mkdir(parents=True, exist_ok=True)
    samples.astype("<f4").tofile(OUT_BIN)
    manifest = {
        "story": "docs/stories/SS-13f.md",
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
            "note": "The samples are at whole UTC hours. The app turns its clock (UTC) into TDB by adding the span's constant offset at the first sample; there is no leap second in the span as of naif0012.tls, whose last entry is 37 s from 2017-01-01. Should one be announced, re-run this pipeline with the new leap-second kernel.",
            "lastLeapSecond": {"deltaAtSeconds": float(leap[-2]), "fromTdbSecondsPastJ2000": float(leap[-1])},
        },
        "earthRotation": {
            "frame": EARTH_FRAME,
            "source": "pck00011.tpc, BODY399_POLE_RA, BODY399_POLE_DEC, BODY399_PM: angles in degrees, d days and T Julian centuries of TDB since J2000",
            "poleRaDeg": pole_ra,
            "poleDecDeg": pole_dec,
            "primeMeridianDeg": pm,
            "evaluatedAt": "when Earth's light left for the Moon: TDB minus earthDistanceKm / c",
        },
        "aberrationCorrection": ABCORR,
        "kernels": kernels,
    }
    OUT_JSON.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    OUT_TRUTH.write_text(
        json.dumps(
            {
                "source": "SPICE via pipeline/timeline.py, the same kernels and corrections as public/data/moon/ephemeris.json",
                "seed": TRUTH_SEED,
                "moments": truths,
            },
            indent=2,
            allow_nan=False,
        )
        + "\n"
    )
    return manifest


def spice_free_utc(utc: str, hours: int) -> str:
    """UTC `hours` from `utc` by calendar arithmetic (no leap second near 2026-01-01)."""
    from datetime import datetime, timedelta, timezone

    t = datetime.fromisoformat(utc).replace(tzinfo=timezone.utc) + timedelta(hours=hours)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


if __name__ == "__main__":
    m = build()
    print(f"{m['samples']} samples every {m['stepHours']} h, {OUT_BIN.stat().st_size / 1e3:.0f} kB")
    print(json.dumps(m["measuredWorstError"], indent=1))
