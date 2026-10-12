"""Venus and the Moon as Mercury sees them, 2026 to 2030, from SPICE (docs/stories/SS-16.md, W8).

    npm run pipeline:neighbours:mercury

Python because SPICE has no good TypeScript equivalent (CLAUDE.md, Stack). Earth is already in
Mercury's timeline (pipeline/timeline_mercury.py); this adds the other two neighbours the owner
approved (2026-10-12): Venus, and the Moon with its summed brightness as Mercury sees it.

Outputs:
- public/data/mercury/neighbours.bin: little-endian float32, one record of FIELDS per sample, at
  the timeline's 12-hour step from its first sample, read with its 4-point Lagrange polynomial.
  Directions are unit vectors in J2000 from Mercury's centre, light-time corrected (LT+S, as
  Mercury's timeline). moonDiscKm2 is the Moon page's I/F times area projected towards Mercury,
  summed over the Moon's disc (pipeline/moons_mars.py MoonDisc), at the light's departure.
- public/data/mercury/neighbours.json: the layout, the span and the interpolation error measured
  here against SPICE at random moments.
- test/fixtures/mercury-neighbours-truth.json: SPICE's values at random moments between samples.

Venus's phase angle and its distance from the Sun follow from its vector and the Sun's (Mercury's
timeline): the app computes them, so they are not stored.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import spiceypy as spice

from download import fetch, sha256
from ephemeris import KERNELS as MOON_KERNELS, NAIF
from ephemeris_mercury import ABCORR
from moons_mars import MOON_FRAME, MoonDisc
from timeline import START_UTC, STEP_HOURS, STOP_UTC, angle_deg, lagrange, spice_free_utc, unit

FIELDS = [
    "venusDirectionJ2000.x", "venusDirectionJ2000.y", "venusDirectionJ2000.z", "venusDistanceKm",
    "moonDirectionJ2000.x", "moonDirectionJ2000.y", "moonDirectionJ2000.z", "moonDistanceKm",
    "moonDiscKm2",
]  # fmt: skip
CHECK_MOMENTS = 2000
TRUTH_MOMENTS = 24
SEED = 2026

ROOT = Path(__file__).resolve().parent.parent
OUT_BIN = ROOT / "public" / "data" / "mercury" / "neighbours.bin"
OUT_JSON = ROOT / "public" / "data" / "mercury" / "neighbours.json"
OUT_TRUTH = ROOT / "test" / "fixtures" / "mercury-neighbours-truth.json"


def moon_from_mercury(disc: MoonDisc, et: float) -> float:
    """The Moon's summed I/F times area as Mercury sees it at `et`, km^2 (moons_mars.py's method)."""
    _, lt = spice.spkpos("MOON", et, "J2000", ABCORR, "MERCURY")
    then = et - lt
    to_mercury = np.array(spice.spkpos("MERCURY", then, MOON_FRAME, "NONE", "MOON")[0])
    to_sun = np.array(spice.spkpos("SUN", then, MOON_FRAME, "LT+S", "MOON")[0])
    return disc.sum_km2(to_mercury / np.linalg.norm(to_mercury), to_sun / np.linalg.norm(to_sun))


def record(disc: MoonDisc, et: float) -> np.ndarray:
    venus, _ = spice.spkpos("VENUS", et, "J2000", ABCORR, "MERCURY")
    moon, _ = spice.spkpos("MOON", et, "J2000", ABCORR, "MERCURY")
    venus_dir, venus_km = unit(venus)
    moon_dir, moon_km = unit(moon)
    # 6 significant figures, then float32: numpy's vectorised exp/log/pow differ by an ulp between
    # CPUs, which could flip a float32 rounding and change the committed file on another runner.
    moon_disc = float(f"{moon_from_mercury(disc, et):.6g}")
    return np.concatenate([venus_dir, [venus_km], moon_dir, [moon_km], [moon_disc]])


def build() -> dict:
    kernels = []
    for path, pinned in MOON_KERNELS:
        spice.furnsh(str(fetch(NAIF + path, pinned, Path(path).name)))
        kernels.append({"file": Path(path).name, "sha256": pinned})
    disc = MoonDisc()
    try:
        start = spice.str2et(START_UTC)
        stop = spice.str2et(STOP_UTC)
        step = STEP_HOURS * 3600.0
        count = int(round((stop - start) / step)) + 4
        first = start - step
        samples = np.array([record(disc, first + i * step) for i in range(count)], dtype=np.float32)

        rng = np.random.default_rng(SEED)
        worst = {"venusDeg": 0.0, "venusKm": 0.0, "moonDeg": 0.0, "moonKm": 0.0, "moonDiscRelative": 0.0}
        for _ in range(CHECK_MOMENTS):
            t = start + rng.random() * (stop - start)
            got = lagrange(samples, (t - first) / step)
            want = record(disc, t)
            worst["venusDeg"] = max(worst["venusDeg"], angle_deg(got[0:3], want[0:3]))
            worst["venusKm"] = max(worst["venusKm"], abs(float(got[3] - want[3])))
            worst["moonDeg"] = max(worst["moonDeg"], angle_deg(got[4:7], want[4:7]))
            worst["moonKm"] = max(worst["moonKm"], abs(float(got[7] - want[7])))
            worst["moonDiscRelative"] = max(worst["moonDiscRelative"], abs(float(got[8]) / float(want[8]) - 1))

        truths = []
        for t in np.sort(start + rng.random(TRUTH_MOMENTS) * (stop - start)):
            values = record(disc, float(t))
            truths.append(
                {
                    "utc": spice.et2utc(float(t), "ISOC", 3) + "Z",
                    "venusDirectionJ2000": values[0:3].tolist(),
                    "venusDistanceKm": float(values[3]),
                    "moonDirectionJ2000": values[4:7].tolist(),
                    "moonDistanceKm": float(values[7]),
                    "moonDiscKm2": float(values[8]),
                }
            )
    finally:
        spice.kclear()

    OUT_BIN.parent.mkdir(parents=True, exist_ok=True)
    samples.astype("<f4").tofile(OUT_BIN)
    manifest = {
        "story": "docs/stories/SS-16.md (W8)",
        "file": OUT_BIN.name,
        "sha256": sha256(OUT_BIN),
        "encoding": "little-endian float32, one record of `fields` per sample",
        "fields": FIELDS,
        "firstSampleUtc": spice_free_utc(START_UTC, -STEP_HOURS),
        "spanUtc": [START_UTC + "Z", STOP_UTC + "Z"],
        "stepHours": STEP_HOURS,
        "samples": count,
        "interpolation": "4-point Lagrange through the samples either side (core/timeline.ts)",
        "aberrationCorrection": ABCORR,
        "moonDisc": "the Moon page's I/F (its albedo map times per-tile Hapke over its value at the map's geometry) times area projected towards Mercury, summed over 1 deg cells of the 1737.4 km sphere, km^2; MOON_ME at the light's departure",
        "moonDiscSources": disc.sources,
        "measuredWorstError": {"moments": CHECK_MOMENTS, "seed": SEED, **{k: float(f"{v:.3g}") for k, v in worst.items()}},
        "kernels": kernels,
    }
    OUT_JSON.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    OUT_TRUTH.write_text(
        json.dumps(
            {"source": "SPICE via pipeline/neighbours_mercury.py", "seed": SEED, "moments": truths},
            indent=2,
            allow_nan=False,
        )
        + "\n"
    )
    return manifest


if __name__ == "__main__":
    m = build()
    print(f"{m['samples']} samples, {OUT_BIN.stat().st_size / 1e3:.0f} kB")
    print(json.dumps(m["measuredWorstError"], indent=1))
