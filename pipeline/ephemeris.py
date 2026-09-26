"""Sun direction and lunar orientation at canonical epochs, from SPICE.

    npm run pipeline:ephemeris

Kernels (NAIF generic_kernels, DE440 set). NAIF publishes no checksums, so each SHA-256 here
was pinned at first retrieval on 2026-09-24, after checking the file size against the
server's Content-Length.

The lunar body-fixed frame is MOON_ME, the mean Earth/polar axis frame, which the DE440 frame
kernel defines as MOON_ME_DE440_ME421: aligned with the DE421 ME frame that LRO-era lunar
products use. MOON_ME and MOON_PA differ by about 0.029 deg, about 0.9 km on the surface
(moon_de440_250416.tf, "Comparison of DE440 PA and ME frames"). The imagery (Clementine
v2.1, PDS3 label) is planetocentric, east-positive, centred on 0 deg longitude.

Output public/data/moon/ephemeris.json. Vectors are in J2000 (ICRF-aligned), kilometres.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import spiceypy as spice

from download import fetch, sha256

NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
KERNELS = [
    ("lsk/naif0012.tls", "678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b"),
    ("spk/planets/de440s.bsp", "c1c7feeab882263fc493a9d5a5b2ddd71b54826cdf65d8d17a76126b260a49f2"),
    ("pck/pck00011.tpc", "3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1"),
    # The DE440 gravitational parameters, for orbits (SS-12, orbit mode).
    ("pck/gm_de440.tpc", "924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140"),
    ("pck/moon_pa_de440_200625.bpc", "60cd55aa401ea2ea97360636f567554bfe4e37bb829f901b4460a455dfaf783f"),
    ("fk/satellites/moon_de440_250416.tf", "a47c71e9c9f33796bdafb2c9d69a7ee447b6016ecad80f71cd6f3e479f9cf768"),
]

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "moon" / "ephemeris.json"

BODY_FRAME = "MOON_ME"
# Light time and stellar aberration: the Sun as it appears from the Moon at the epoch.
ABCORR = "LT+S"
# Where to look for canonical epochs, scanned hourly. January 2026 has no lunar eclipse.
SEARCH = ("2026-01-01T00:00:00", "2026-01-31T00:00:00")


def load_kernels() -> list[dict]:
    loaded = []
    for path, pinned in KERNELS:
        local = fetch(NAIF + path, pinned, Path(path).name)
        spice.furnsh(str(local))
        loaded.append({"file": Path(path).name, "url": NAIF + path, "sha256": pinned})
    return loaded


def phase_angle_deg(et: float) -> float:
    """Sun-Moon-Earth angle: 0 at full Moon, 90 at the quarters."""
    return math.degrees(spice.phaseq(et, "MOON", "SUN", "EARTH", ABCORR))


def waxing(et: float) -> bool:
    return phase_angle_deg(et + 3600) < phase_angle_deg(et)


def find_epochs() -> dict[str, float]:
    """Hourly scan for the fullest Moon and the first quarter nearest 90 deg while waxing."""
    start, stop = (spice.str2et(t) for t in SEARCH)
    full, quarter = None, None
    et = start
    while et <= stop:
        phase = phase_angle_deg(et)
        if full is None or phase < phase_angle_deg(full):
            full = et
        if waxing(et) and (quarter is None or abs(phase - 90) < abs(phase_angle_deg(quarter) - 90)):
            quarter = et
        et += 3600.0
    assert full is not None and quarter is not None
    return {"full-2026-01": full, "first-quarter-2026-01": quarter}


def unit(v) -> tuple[list[float], float]:
    n = math.sqrt(sum(c * c for c in v))
    return [c / n for c in v], n


def describe(label: str, et: float) -> dict:
    sun, _ = spice.spkpos("SUN", et, "J2000", ABCORR, "MOON")
    earth, _ = spice.spkpos("EARTH", et, "J2000", ABCORR, "MOON")
    sun_dir, sun_km = unit(sun)
    earth_dir, earth_km = unit(earth)
    rotation = spice.pxform("J2000", BODY_FRAME, et)

    # Sub-solar point as Horizons reports it: seen from Earth's centre, apparent (LT+S).
    spoint, _, _ = spice.subslr("INTERCEPT/ELLIPSOID", "MOON", et, BODY_FRAME, ABCORR, "EARTH")
    _, lon, lat = spice.reclat(spoint)
    return {
        "id": label,
        "utc": spice.et2utc(et, "ISOC", 0),
        "tdbSecondsPastJ2000": et,
        "phaseAngleDeg": round(phase_angle_deg(et), 4),
        "sunDirectionJ2000": sun_dir,
        "sunDistanceKm": sun_km,
        "earthDirectionJ2000": earth_dir,
        "earthDistanceKm": earth_km,
        "j2000ToBodyFixed": [list(row) for row in rotation],
        "subSolarFromEarth": {
            "lonDeg": math.degrees(lon),
            "latDeg": math.degrees(lat),
            "note": "planetocentric, east-positive, MOON_ME; SPICE subslr INTERCEPT/ELLIPSOID, observer EARTH, LT+S",
        },
    }


def build() -> dict:
    kernels = load_kernels()
    try:
        radii = spice.bodvrd("MOON", "RADII", 3)[1]
        gm = spice.bodvrd("MOON", "GM", 1)[1][0]
        earth_radii = spice.bodvrd("EARTH", "RADII", 3)[1]
        epochs = [describe(label, et) for label, et in find_epochs().items()]
    finally:
        spice.kclear()
    result = {
        "body": {
            "name": "Moon",
            "naifId": 301,
            "radiiKm": [float(r) for r in radii],
            "radiiSource": "pck00011.tpc BODY301_RADII",
            "gmKm3PerS2": float(gm),
            "gmSource": "gm_de440.tpc BODY301_GM",
            "bodyFixedFrame": BODY_FRAME,
            "longitude": "planetocentric, east-positive",
        },
        "earth": {
            "name": "Earth",
            "naifId": 399,
            "radiiKm": [float(r) for r in earth_radii],
            "radiiSource": "pck00011.tpc BODY399_RADII",
        },
        "ephemeris": "DE440 (de440s.bsp), lunar orientation moon_pa_de440_200625.bpc",
        "aberrationCorrection": ABCORR,
        "vectorFrame": "J2000 (ICRF-aligned); scene axes via src/core/frames.ts",
        "kernels": kernels,
        "epochs": epochs,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return result


if __name__ == "__main__":
    out = build()
    print(f"radii {out['body']['radiiKm']} km; output sha256 {sha256(OUT)}")
    for e in out["epochs"]:
        s = e["subSolarFromEarth"]
        print(f"  {e['id']}: {e['utc']} UTC, phase {e['phaseAngleDeg']} deg, sub-solar {s['lonDeg']:.4f} E {s['latDeg']:.4f} N")
