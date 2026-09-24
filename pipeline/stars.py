"""Converts the Yale Bright Star Catalogue (5th revised ed.) into the app's star binary.

    npm run pipeline:stars

Source: Hoffleit & Warren 1991, CDS catalogue V/50. Field positions are from the
catalogue's own ReadMe (https://cdsarc.cds.unistra.fr/ftp/cats/V/50/ReadMe):

    1-4    HR     Harvard Revised number
    76-77  RAh    RA hours, equinox J2000, epoch 2000.0
    78-79  RAm    RA minutes
    80-83  RAs    RA seconds (F4.1)
    84     DE-    Dec sign
    85-86  DEd    Dec degrees
    87-88  DEm    Dec arcminutes
    89-90  DEs    Dec arcseconds
    103-107 Vmag  visual magnitude (F5.2)
    110-114 B-V   colour index (F5.2), may be blank
    149-154 pmRA  proper motion in RA, arcsec/yr, already multiplied by cos(Dec)
    155-160 pmDE  proper motion in Dec, arcsec/yr

"Note (1): These fields are all blanks for stars removed from the Bright Star Catalogue."

Output, public/data/stars/bsc5.bin: little-endian float32, six per star, sorted by HR:
    x, y, z   ICRF/J2000 unit vector (x towards RA 0h Dec 0, z towards the north pole)
    V         visual magnitude
    B-V       colour index, NaN where the catalogue has none
    HR        Harvard Revised number
Positions are equinox J2000, epoch 2000.0. Proper motion is not applied; the manifest
records the largest drift it would cause over the supported range.
"""

from __future__ import annotations

import gzip
import json
import math
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

from download import fetch, sha256

SOURCE_URL = "https://cdsarc.cds.unistra.fr/ftp/cats/V/50/catalog.gz"
SOURCE_SHA256 = "3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed"
EXPECTED_RECORDS = 9110

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "stars"
FLOATS_PER_STAR = 6

# The date range the app claims to support, for the proper-motion drift figure.
SUPPORTED_YEARS = (1900.0, 2100.0)
EPOCH = 2000.0


@dataclass(frozen=True)
class Star:
    hr: int
    ra_deg: float
    dec_deg: float
    vmag: float
    b_v: float | None
    pm_ra: float | None  # arcsec/yr, includes cos(Dec)
    pm_de: float | None  # arcsec/yr


def field(line: str, first: int, last: int) -> str:
    """Catalogue byte positions are 1-based and inclusive."""
    return line[first - 1 : last].strip()


def optional_float(text: str) -> float | None:
    return float(text) if text else None


def parse_line(line: str) -> Star | None:
    """Returns None for the entries removed from the catalogue, whose positions are blank."""
    hr = int(field(line, 1, 4))
    if not field(line, 76, 77):
        return None
    ra_hours = int(field(line, 76, 77)) + int(field(line, 78, 79)) / 60 + float(field(line, 80, 83)) / 3600
    dec_abs = int(field(line, 85, 86)) + int(field(line, 87, 88)) / 60 + int(field(line, 89, 90)) / 3600
    sign = -1.0 if field(line, 84, 84) == "-" else 1.0
    return Star(
        hr=hr,
        ra_deg=ra_hours * 15.0,
        dec_deg=sign * dec_abs,
        vmag=float(field(line, 103, 107)),
        b_v=optional_float(field(line, 110, 114)),
        pm_ra=optional_float(field(line, 149, 154)),
        pm_de=optional_float(field(line, 155, 160)),
    )


def unit_vector(ra_deg: float, dec_deg: float) -> tuple[float, float, float]:
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    return (math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec))


def encode(stars: list[Star]) -> bytes:
    out = bytearray()
    for s in stars:
        x, y, z = unit_vector(s.ra_deg, s.dec_deg)
        b_v = math.nan if s.b_v is None else s.b_v
        out += struct.pack("<6f", x, y, z, s.vmag, b_v, float(s.hr))
    return bytes(out)


def largest_drift(stars: list[Star]) -> tuple[int, float]:
    """The star whose ignored proper motion moves it furthest over the supported range."""
    span = max(abs(SUPPORTED_YEARS[0] - EPOCH), abs(SUPPORTED_YEARS[1] - EPOCH))
    worst_hr, worst_arcsec = 0, 0.0
    for s in stars:
        if s.pm_ra is None or s.pm_de is None:
            continue
        drift = math.hypot(s.pm_ra, s.pm_de) * span
        if drift > worst_arcsec:
            worst_hr, worst_arcsec = s.hr, drift
    return worst_hr, worst_arcsec


def build() -> dict:
    source = fetch(SOURCE_URL, SOURCE_SHA256, "bsc5-catalog.gz")
    lines = gzip.decompress(source.read_bytes()).decode("ascii").splitlines()
    if len(lines) != EXPECTED_RECORDS:
        raise RuntimeError(f"expected {EXPECTED_RECORDS} records, found {len(lines)}")

    parsed = [parse_line(line) for line in lines]
    stars = sorted((s for s in parsed if s is not None), key=lambda s: s.hr)
    removed = [int(field(line, 1, 4)) for line, s in zip(lines, parsed) if s is None]
    missing_b_v = [s.hr for s in stars if s.b_v is None]
    drift_hr, drift_arcsec = largest_drift(stars)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    binary = OUT_DIR / "bsc5.bin"
    binary.write_bytes(encode(stars))

    manifest = {
        "source": {
            "catalogue": "Yale Bright Star Catalogue, 5th revised ed. (Hoffleit & Warren 1991), CDS V/50",
            "url": SOURCE_URL,
            "sha256": SOURCE_SHA256,
            "readme": "https://cdsarc.cds.unistra.fr/ftp/cats/V/50/ReadMe",
        },
        "format": {
            "file": "bsc5.bin",
            "encoding": "little-endian float32",
            "floatsPerStar": FLOATS_PER_STAR,
            "fields": ["x", "y", "z", "vmag", "bv", "hr"],
            "frame": "ICRF/J2000 equatorial unit vector; x to RA 0h Dec 0, z to the north celestial pole",
            "epoch": "J2000.0; proper motion not applied",
            "bvMissing": "NaN",
        },
        "counts": {
            "records": len(lines),
            "stars": len(stars),
            "removedEntries": len(removed),
            "missingBV": len(missing_b_v),
        },
        "removedHR": removed,
        "missingBVHR": missing_b_v,
        "properMotion": {
            "applied": False,
            "supportedYears": list(SUPPORTED_YEARS),
            "largestDriftHR": drift_hr,
            "largestDriftArcmin": round(drift_arcsec / 60, 2),
        },
        "output": {"sha256": sha256(binary), "bytes": binary.stat().st_size},
    }
    (OUT_DIR / "bsc5.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    result = build()
    counts = result["counts"]
    print(
        f"bsc5: {counts['stars']} stars, {counts['removedEntries']} removed entries dropped, "
        f"{counts['missingBV']} without B-V; output sha256 {result['output']['sha256']}"
    )
    drift = result["properMotion"]
    print(f"largest ignored proper-motion drift over {drift['supportedYears']}: HR {drift['largestDriftHR']}, {drift['largestDriftArcmin']} arcmin")
    sys.exit(0)
