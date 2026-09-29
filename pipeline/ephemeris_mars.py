"""Mars, Phobos and Deimos: shape, gravity, rotation and positions at the canonical epochs, from
SPICE (SS-14 W2).

    npm run pipeline:ephemeris:mars

Python because SPICE has no good TypeScript equivalent (CLAUDE.md, Stack).

Epochs: the same two instants as the Moon's (pipeline/ephemeris.py), so the whole app shares one
clock. Mars's season at each is given as its solar longitude Ls (SPICE lspcn).

Kernels (NAIF generic_kernels). NAIF publishes no checksums: each SHA-256 below was pinned at
first retrieval on 2026-09-29, after checking the size against the server's Content-Length. The
kernels shared with the Moon carry the Moon's pins.

- `mar099s.bsp` (NAIF, June 2025): Mars (499), Phobos (401) and Deimos (402) relative to the Mars
  barycentre, 1995 to 2049 (its .cmt file). DE440s has only the Mars barycentre.
- `pck00011.tpc`: radii (BODY499_RADII 3396.19 x 3396.19 x 3376.20 km) and the IAU rotation models
  of all three (IAU_MARS, IAU_PHOBOS, IAU_DEIMOS). Planetocentric, east-positive, as SPICE
  always is.
- `gm_de440.tpc`: GM of Mars (BODY499_GM).

Output public/data/mars/ephemeris.json. Vectors are in J2000 (ICRF-aligned), kilometres.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import spiceypy as spice

from download import fetch, sha256
from ephemeris import KERNELS as MOON_KERNELS, NAIF

KERNELS = [
    k
    for k in MOON_KERNELS
    if k[0] in ("lsk/naif0012.tls", "spk/planets/de440s.bsp", "pck/pck00011.tpc", "pck/gm_de440.tpc")
] + [
    ("spk/satellites/mar099s.bsp", "997dc93ba640e476da7a494d2237dcdeb145e528db37be8ccee588c615e4e1ff"),
]

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "mars" / "ephemeris.json"

BODY_FRAME = "IAU_MARS"
ABCORR = "LT+S"
EPOCHS = {"full-2026-01": "2026-01-03T10:00:00", "first-quarter-2026-01": "2026-01-26T05:00:00"}
SATELLITES = (("PHOBOS", 401, "IAU_PHOBOS"), ("DEIMOS", 402, "IAU_DEIMOS"))


def load_kernels() -> list[dict]:
    loaded = []
    for path, pinned in KERNELS:
        local = fetch(NAIF + path, pinned, Path(path).name)
        spice.furnsh(str(local))
        loaded.append({"file": Path(path).name, "url": NAIF + path, "sha256": pinned})
    return loaded


def unit(v) -> tuple[list[float], float]:
    n = math.sqrt(sum(c * c for c in v))
    return [c / n for c in v], n


def describe(label: str, et: float) -> dict:
    sun, _ = spice.spkpos("SUN", et, "J2000", ABCORR, "MARS")
    earth, _ = spice.spkpos("EARTH", et, "J2000", ABCORR, "MARS")
    sun_dir, sun_km = unit(sun)
    earth_dir, earth_km = unit(earth)
    satellites = []
    for name, naif_id, frame in SATELLITES:
        # Geometric position from Mars's centre: at a few thousand km, light time is 0.03 s.
        pos, _ = spice.spkpos(name, et, "J2000", "NONE", "MARS")
        satellites.append(
            {
                "name": name.title(),
                "naifId": naif_id,
                "positionJ2000Km": [float(c) for c in pos],
                "j2000ToBodyFixed": [list(row) for row in spice.pxform("J2000", frame, et)],
            }
        )
    # Sub-solar point as Horizons reports it: seen from Earth's centre, apparent (LT+S).
    spoint, _, _ = spice.subslr("INTERCEPT/ELLIPSOID", "MARS", et, BODY_FRAME, ABCORR, "EARTH")
    _, lon, lat = spice.reclat(spoint)
    return {
        "id": label,
        "utc": spice.et2utc(et, "ISOC", 0),
        "tdbSecondsPastJ2000": et,
        "solarLongitudeLsDeg": round(math.degrees(spice.lspcn("MARS", et, ABCORR)), 4),
        "sunDirectionJ2000": sun_dir,
        "sunDistanceKm": sun_km,
        "earthDirectionJ2000": earth_dir,
        "earthDistanceKm": earth_km,
        "j2000ToBodyFixed": [list(row) for row in spice.pxform("J2000", BODY_FRAME, et)],
        "satellites": satellites,
        "subSolarFromEarth": {
            "lonDeg": math.degrees(lon),
            "latDeg": math.degrees(lat),
            "note": "planetocentric, east-positive, IAU_MARS; SPICE subslr INTERCEPT/ELLIPSOID, observer EARTH, LT+S",
        },
    }


def radii(body: str) -> list[float]:
    return [float(r) for r in spice.bodvrd(body, "RADII", 3)[1]]


def build() -> dict:
    kernels = load_kernels()
    try:
        body = {
            "name": "Mars",
            "naifId": 499,
            "radiiKm": radii("MARS"),
            "radiiSource": "pck00011.tpc BODY499_RADII",
            "gmKm3PerS2": float(spice.bodvrd("MARS", "GM", 1)[1][0]),
            "gmSource": "gm_de440.tpc BODY499_GM",
            "bodyFixedFrame": BODY_FRAME,
            "longitude": "planetocentric, east-positive",
        }
        satellites = [
            {
                "name": name.title(),
                "naifId": naif_id,
                "radiiKm": radii(name),
                "radiiSource": f"pck00011.tpc BODY{naif_id}_RADII",
                "bodyFixedFrame": frame,
            }
            for name, naif_id, frame in SATELLITES
        ]
        epochs = [describe(label, spice.str2et(utc)) for label, utc in EPOCHS.items()]
    finally:
        spice.kclear()
    result = {
        "body": body,
        "satellites": satellites,
        "ephemeris": "DE440 (de440s.bsp); Mars, Phobos and Deimos from mar099s.bsp",
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
        print(
            f"  {e['id']}: {e['utc']} UTC, Ls {e['solarLongitudeLsDeg']} deg, "
            f"sub-solar {s['lonDeg']:.4f} E {s['latDeg']:.4f} N"
        )
