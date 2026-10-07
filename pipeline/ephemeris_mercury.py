"""Mercury: shape, gravity, rotation and positions at the canonical epochs, from SPICE (SS-16 W2).

    npm run pipeline:ephemeris:mercury

Python because SPICE has no good TypeScript equivalent (CLAUDE.md, Stack).

Epochs: the same two instants as the Moon's and Mars's (pipeline/ephemeris.py), so the whole app
shares one clock. Mercury has no seasons to speak of (its obliquity is about 0.03 deg); what
changes its light is its distance from the Sun, which its eccentric orbit (e = 0.206) moves from
0.31 to 0.47 AU. Each epoch records that distance and the true anomaly.

Kernels: the Moon's, already pinned (pipeline/ephemeris.py). DE440s holds Mercury (199) relative
to its barycentre (1).
- `pck00011.tpc`: radii (BODY199_RADII 2440.53 x 2440.53 x 2438.26 km) and the IAU rotation model
  (IAU_MERCURY): planetocentric, east-positive, as SPICE always is.
- `gm_de440.tpc`: GM of Mercury (BODY199_GM).

Output public/data/mercury/ephemeris.json. Vectors are in J2000 (ICRF-aligned), kilometres.
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
]

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "mercury" / "ephemeris.json"

BODY_FRAME = "IAU_MERCURY"
ABCORR = "LT+S"
EPOCHS = {"full-2026-01": "2026-01-03T10:00:00", "first-quarter-2026-01": "2026-01-26T05:00:00"}
AU_KM = 149_597_870.7


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


def true_anomaly_deg(et: float) -> float:
    """Mercury's true anomaly in its heliocentric orbit (osculating, ecliptic J2000)."""
    state, _ = spice.spkezr("MERCURY", et, "ECLIPJ2000", "NONE", "SUN")
    gm_sun = float(spice.bodvrd("SUN", "GM", 1)[1][0])
    elements = spice.oscltx(state, et, gm_sun)
    return math.degrees(elements[8]) % 360


def rotation_constants() -> dict:
    """pck00011's IAU_MERCURY model, as the kernel pool holds it, in the layout core/mars.ts's
    marsRotation evaluates (alpha and delta in T, W in d, periodic terms on BODY1's angles)."""

    def values(name: str) -> list[float]:
        return [float(x) for x in spice.gdpool(name, 0, 1000)]

    # pck00011 gives Mercury's angles as (A, B) pairs and no BODY1_MAX_PHASE_DEGREE: linear in T.
    angles = values("BODY1_NUT_PREC_ANGLES")
    width = 2
    return {
        "frame": BODY_FRAME,
        "source": "pck00011.tpc: BODY199_POLE_RA, BODY199_POLE_DEC, BODY199_PM, BODY199_NUT_PREC_RA/DEC/PM, BODY1_NUT_PREC_ANGLES. Angles in degrees; T Julian centuries and d days of TDB since J2000. alpha = poly(T) + sum ra_k sin(theta_k), delta = poly(T) + sum dec_k cos(theta_k), W = poly(d) + sum pm_k sin(theta_k), theta_k = A_k + B_k T",
        "poleRaDeg": values("BODY199_POLE_RA"),
        "poleDecDeg": values("BODY199_POLE_DEC"),
        "primeMeridianDeg": values("BODY199_PM"),
        "nutPrecRaDeg": values("BODY199_NUT_PREC_RA"),
        "nutPrecDecDeg": values("BODY199_NUT_PREC_DEC"),
        "nutPrecPmDeg": values("BODY199_NUT_PREC_PM"),
        "nutPrecAnglesDeg": [angles[i : i + width] for i in range(0, len(angles), width)],
    }


def describe(label: str, et: float) -> dict:
    sun, _ = spice.spkpos("SUN", et, "J2000", ABCORR, "MERCURY")
    earth, _ = spice.spkpos("EARTH", et, "J2000", ABCORR, "MERCURY")
    sun_dir, sun_km = unit(sun)
    earth_dir, earth_km = unit(earth)
    # Sub-solar point as Horizons reports it: seen from Earth's centre, apparent (LT+S).
    spoint, _, _ = spice.subslr("INTERCEPT/ELLIPSOID", "MERCURY", et, BODY_FRAME, ABCORR, "EARTH")
    _, lon, lat = spice.reclat(spoint)
    return {
        "id": label,
        "utc": spice.et2utc(et, "ISOC", 0),
        "tdbSecondsPastJ2000": et,
        "sunDistanceAu": round(sun_km / AU_KM, 6),
        "trueAnomalyDeg": round(true_anomaly_deg(et), 4),
        "sunDirectionJ2000": sun_dir,
        "sunDistanceKm": sun_km,
        "earthDirectionJ2000": earth_dir,
        "earthDistanceKm": earth_km,
        "j2000ToBodyFixed": [list(row) for row in spice.pxform("J2000", BODY_FRAME, et)],
        "subSolarFromEarth": {
            "lonDeg": math.degrees(lon),
            "latDeg": math.degrees(lat),
            "note": "planetocentric, east-positive, IAU_MERCURY; SPICE subslr INTERCEPT/ELLIPSOID, observer EARTH, LT+S",
        },
    }


def build() -> dict:
    kernels = load_kernels()
    try:
        body = {
            "name": "Mercury",
            "naifId": 199,
            "radiiKm": [float(r) for r in spice.bodvrd("MERCURY", "RADII", 3)[1]],
            "radiiSource": "pck00011.tpc BODY199_RADII",
            "gmKm3PerS2": float(spice.bodvrd("MERCURY", "GM", 1)[1][0]),
            "gmSource": "gm_de440.tpc BODY199_GM",
            "bodyFixedFrame": BODY_FRAME,
            "longitude": "planetocentric, east-positive",
            "rotation": rotation_constants(),
        }
        epochs = [describe(label, spice.str2et(utc)) for label, utc in EPOCHS.items()]
    finally:
        spice.kclear()
    result = {
        "body": body,
        "ephemeris": "DE440 (de440s.bsp)",
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
            f"  {e['id']}: {e['utc']} UTC, {e['sunDistanceAu']} AU, true anomaly {e['trueAnomalyDeg']} deg, "
            f"sub-solar {s['lonDeg']:.4f} E {s['latDeg']:.4f} N"
        )
