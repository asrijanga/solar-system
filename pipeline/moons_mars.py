"""Mars's neighbours in its sky (docs/stories/SS-14.md, W8): Phobos's and Deimos's shapes, where
they and the Moon are at any moment from 2026 to 2030, and the truth the app's tests check them
against.

    npm run pipeline:moons:mars

Python because SPICE, which reads the positions and Phobos's shape (a DSK), has no good
TypeScript equivalent (CLAUDE.md, Stack). Uses the kernels of ephemeris_mars.py.

Sources (docs/data/mars.md). Each SHA-256 was pinned at first retrieval on 2026-10-04, after
checking the size against the server's Content-Length (NAIF) or the PDS4 label's file_size
(SBN); neither publisher gives a checksum.
- Phobos: Willner, Shi & Oberst (2014), PSS 102, 51, NAIF `phobos_2014_09_22.bds`: 137,439
  vertices and 274,874 plates in IAU_PHOBOS, kilometres (the DSK's own descriptor and comments).
  Its vertices are whole metres, so storing them as integer metres loses nothing.
- Deimos: Thomas (1993), PDS SBN `ast-sat.thomas.shape-models_V1_0`, `m2deimos.tab`: a radius
  (km) every 5 deg of "planetocentric" latitude and longitude. The label does not give the
  longitude's sign; its companion image table says "Longitudes are west". Measured here: the
  same author's Phobos table (`m1phobos.tab`, same bundle) matches Willner's east-positive model
  with 0.31 km RMS read as west longitude and 0.57 km read as east (800 points, 2026-10-04). So
  the tables are west-positive, and east = -west.
- Stickney, the orientation test's named point: the IAU Gazetteer's Phobos file. Its metadata
  says "Positive West", but its attribute notes say "Using a positive East longitude system", and
  its 311 deg is Stickney's 49 deg W: read as east, Willner's surface there lies 1.28 km below
  the mean of a ring 20 deg out; read as west, 0.08 km. So 311 is east-positive.
- Positions: `mar099s.bsp`, geometric (no aberration correction) from Mars's centre in J2000,
  as ephemeris_mars.py gives the moons: at their few thousand km, light time is 0.03 s.
- The Moon, as a point in Mars's sky: its offset from Earth as seen from Mars, each with LT+S
  (the timeline's Earth correction), so Earth's direction plus this offset is the Moon's.
- The Moon's brightness from Mars: the Moon page's own photometry (public/data/moon/: the 566 nm
  albedo map, I/F at i = g = 60 deg, e = 0, and the per-tile Hapke parameters with their I/F at
  that geometry, docs/stories/SS-5b.md and SS-8b.md) summed over the disc Mars sees: on 1 deg
  cells of the 1737.4 km sphere, I/F = albedo x Hapke(here) / Hapke(standard), tile by tile, times
  the cell's area projected towards Mars. The map is averaged onto the cells by area. Directions
  are the Moon's when the light Mars sees left it (LT+S), in MOON_ME, the Moon page's frame.

Outputs:
- public/data/mars/moons/{phobos,deimos}.bin.gz: gzip of a little-endian uint32 vertex count and
  triangle count, then the vertices as int16 metres, each component the difference from the
  previous vertex's, then the triangles' vertex indices (counter-clockwise seen from outside) as
  int32, each the difference from the previous index.
- public/data/mars/moons/YYYY-MM.bin: little-endian float32. Phobos's position every 15 min, then
  Deimos's every 60 min, then the Moon's offset every 60 min, (x, y, z) km each, then the Moon's
  summed I/F times projected area every 6 h (km^2), from one step before the month to two
  after, for the timeline's 4-point Lagrange interpolation.
- public/data/mars/moons.json: the layout, the measured interpolation errors, the IAU rotation
  constants of both moons (pck00011.tpc), the shapes' provenance and Stickney.
- test/fixtures/mars-moons-truth.json: SPICE's positions and rotations at random moments.
"""

from __future__ import annotations

import gzip
import json
import math
import struct
import zipfile
from datetime import datetime
from pathlib import Path

import numpy as np
import spiceypy as spice
from PIL import Image

from download import fetch, sha256
from ephemeris import KERNELS as MOON_KERNELS, NAIF
from ephemeris_mars import ABCORR, load_kernels
from hapke import hapke
from timeline import START_UTC, STOP_UTC, lagrange

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "mars" / "moons"
OUT_JSON = ROOT / "public" / "data" / "mars" / "moons.json"
OUT_TRUTH = ROOT / "test" / "fixtures" / "mars-moons-truth.json"

PHOBOS_DSK = (
    "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/dsk/satellites/phobos_2014_09_22.bds",
    "8f8fe4ea2dc97355d37279ee8136a974015a0d1b5f1199f43678ba5ad03fd2b6",
)
THOMAS = "https://sbnarchive.psi.edu/pds4/non_mission/ast-sat.thomas.shape-models_V1_0/data/"
DEIMOS_TAB = (THOMAS + "m2deimos.tab", "9a4dbc132c7546acb2ef26a386d306f155519f0988c8052acb2276ddeb7ca2fd")
PHOBOS_TAB = (THOMAS + "m1phobos.tab", "e19d7f585d710747fa4350c078c558003a7e2122162e908d5fdd33b1970f0b1b")
GAZETTEER = (
    "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/PHOBOS_nomenclature_center_pts.zip",
    "c9e514e19291de89175a554ea03cdac0a941d34b26be8076729183b631e140fa",
)

# Sampling, measured 2026-10-04 for 4-point Lagrange (docs/data/mars.md) and re-measured below.
PHOBOS_STEP_MIN = 15
DEIMOS_STEP_MIN = 60
# The Moon's summed brightness changes with its phase, about 12 deg a day: 6 h samples interpolate
# it to the error measured below.
MOON_DISC_STEP_MIN = 360
CHECK_MOMENTS = 2000
TRUTH_MOMENTS = 24
SEED = 2026
SIGN_TEST_POINTS = 800


MOON_DATA = ROOT / "public" / "data" / "moon"
MOON_RADIUS_KM = 1737.4
MOON_FRAME = "MOON_ME"


class MoonDisc:
    """The Moon page's I/F on 1 deg cells, and its sum over the disc seen from Mars."""

    def __init__(self) -> None:
        albedo_json = json.loads((MOON_DATA / "albedo.json").read_text())
        hapke_json = json.loads((MOON_DATA / "hapke.json").read_text())
        encoding = albedo_json["texture"]["encoding"]
        if encoding["curve"] != "sqrt":
            raise ValueError("the Moon's albedo is not sqrt-encoded")
        image = Image.open(MOON_DATA / albedo_json["texture"]["file"]).convert("L")
        bytes_ = np.asarray(image, dtype=np.float32) / 255
        i_over_f = Image.fromarray(encoding["maxIOverF"] * bytes_ * bytes_, mode="F")
        # Column 0 of the map is at -180 deg; the tiles' column 0 is centred on 0.5 E.
        cells = np.asarray(i_over_f.resize((360, 180), Image.BOX), dtype=np.float64)
        self.albedo = np.roll(cells, -180, axis=1)
        tex = hapke_json["texture"]
        n = tex["width"] * tex["height"]
        halves = np.frombuffer((MOON_DATA / tex["file"]).read_bytes(), dtype="<f2").astype(np.float64)
        rgba = halves[: n * 4].reshape(tex["height"], tex["width"], 4)
        rg = halves[n * 4 : n * 6].reshape(tex["height"], tex["width"], 2)
        self.params = {"w": rgba[..., 0], "b": rgba[..., 1], "c": rgba[..., 2], "bs0": rgba[..., 3], "hs": rg[..., 0]}
        self.standard = rg[..., 1]
        self.theta = hapke_json["fixed"]["thetaDeg"]
        lat = np.radians(89.5 - np.arange(180))[:, None]
        lon = np.radians(0.5 + np.arange(360))[None, :]
        self.normal = np.stack(np.broadcast_arrays(np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)), axis=-1)
        step = math.radians(1)
        self.area = (MOON_RADIUS_KM**2) * step * (np.sin(lat + step / 2) - np.sin(lat - step / 2)) * np.ones((1, 360))
        self.sources = {
            "albedo": {"file": "public/data/moon/" + albedo_json["texture"]["file"], "sha256": sha256(MOON_DATA / albedo_json["texture"]["file"])},
            "hapke": {"file": "public/data/moon/" + tex["file"], "sha256": sha256(MOON_DATA / tex["file"])},
        }

    def sum_km2(self, to_mars: np.ndarray, to_sun: np.ndarray) -> float:
        """Sum of I/F times the area projected towards Mars, km^2, for unit directions in MOON_ME."""
        mu = self.normal @ to_mars  # unlit cells give NaN inside hapke(); they are summed as 0
        mu0 = self.normal @ to_sun
        lit = (mu > 0) & (mu0 > 0)
        cos_g = float(to_mars @ to_sun)
        with np.errstate(divide="ignore", invalid="ignore"):
            here = hapke(np.where(lit, mu0, 0.0), np.where(lit, mu, 0.0), cos_g, self.params, self.theta)
            i_over_f = self.albedo * here / np.maximum(self.standard, 1e-12)
        return float(np.sum(np.where(lit, i_over_f * mu * self.area, 0.0)))


def moon_from_mars(disc: MoonDisc, et: float) -> float:
    """The Moon's summed I/F times area as Mars sees it at `et`, km^2."""
    _, lt = spice.spkpos("MOON", et, "J2000", ABCORR, "MARS")
    then = et - lt
    to_mars = np.array(spice.spkpos("MARS", then, MOON_FRAME, "NONE", "MOON")[0])
    to_sun = np.array(spice.spkpos("SUN", then, MOON_FRAME, "LT+S", "MOON")[0])
    return disc.sum_km2(to_mars / np.linalg.norm(to_mars), to_sun / np.linalg.norm(to_sun))


def dsk_handle(path: Path):
    handle = spice.dasopr(str(path))
    return handle, spice.dlabfs(handle)


def phobos_shape(path: Path) -> tuple[np.ndarray, np.ndarray]:
    handle, dla = dsk_handle(path)
    try:
        frame = spice.frmnam(spice.dskgd(handle, dla).frmcde)
        if frame != "IAU_PHOBOS":
            raise ValueError(f"the Phobos DSK is in {frame}, not IAU_PHOBOS")
        nv, nt = spice.dskz02(handle, dla)
        vertices = np.array(spice.dskv02(handle, dla, 1, nv))
        plates = np.array(spice.dskp02(handle, dla, 1, nt)) - 1
    finally:
        spice.dascls(handle)
    return vertices, plates


def radius_on(path: Path, points: np.ndarray) -> np.ndarray:
    """Willner's surface radius along each (lat, east lon) direction, degrees."""
    handle, dla = dsk_handle(path)
    out = []
    try:
        for lat, lon in points:
            la, lo = math.radians(lat), math.radians(lon)
            d = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
            _, x, found = spice.dskx02(handle, dla, d * 100, -d)
            out.append(np.linalg.norm(x) if found else np.nan)
    finally:
        spice.dascls(handle)
    return np.array(out)


def thomas_sign_test(dsk: Path, table: Path) -> dict:
    """Thomas's Phobos table against Willner's, read as west and as east longitude."""
    t = np.loadtxt(table)
    rows = t[np.random.default_rng(SEED).choice(len(t), SIGN_TEST_POINTS, replace=False)]
    result = {}
    for name, sign in (("readAsWest", -1), ("readAsEast", 1)):
        diff = radius_on(dsk, np.column_stack([rows[:, 0], sign * rows[:, 1]])) - rows[:, 2]
        result[name] = round(float(np.sqrt(np.nanmean(diff**2))), 3)
    if not result["readAsWest"] < result["readAsEast"]:
        raise ValueError(f"Thomas's tables do not read as west longitude: {result}")
    return {"points": SIGN_TEST_POINTS, "seed": SEED, "rmsKm": result}


def deimos_shape(table: Path) -> tuple[np.ndarray, np.ndarray]:
    """Thomas's 5 deg grid as a closed mesh: one vertex at each pole, 72 per latitude ring."""
    t = np.loadtxt(table)
    radius = {(round(lat), round(lon) % 360): r for lat, lon, r in t}
    lats = list(range(-85, 90, 5))
    lons = list(range(0, 360, 5))

    def xyz(lat: float, west_lon: float, r: float) -> list[float]:
        la, lo = math.radians(lat), math.radians(-west_lon)  # east = -west
        return [r * math.cos(la) * math.cos(lo), r * math.cos(la) * math.sin(lo), r * math.sin(la)]

    vertices = [xyz(-90, 0, radius[(-90, 0)])]
    for lat in lats:
        vertices += [xyz(lat, lon, radius[(lat, lon)]) for lon in lons]
    vertices.append(xyz(90, 0, radius[(90, 0)]))
    n = len(lons)
    ring = lambda i, j: 1 + i * n + (j % n)  # noqa: E731
    triangles = [[0, ring(0, j + 1), ring(0, j)] for j in range(n)]
    for i in range(len(lats) - 1):
        for j in range(n):
            triangles.append([ring(i, j), ring(i, j + 1), ring(i + 1, j + 1)])
            triangles.append([ring(i, j), ring(i + 1, j + 1), ring(i + 1, j)])
    top = len(vertices) - 1
    triangles += [[top, ring(len(lats) - 1, j), ring(len(lats) - 1, j + 1)] for j in range(n)]
    return np.array(vertices), np.array(triangles)


def outward(vertices: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    """Triangles wound counter-clockwise seen from outside: the volume they enclose is positive."""
    a, b, c = (vertices[triangles[:, k]] for k in range(3))
    volume = float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6
    return triangles if volume > 0 else triangles[:, ::-1]


def encode_shape(vertices_km: np.ndarray, triangles: np.ndarray) -> tuple[bytes, float]:
    metres = np.rint(vertices_km * 1000).astype(np.int64)
    worst = float(np.abs(metres / 1000 - vertices_km).max() * 1000)
    dv = np.diff(metres, axis=0, prepend=0)
    di = np.diff(triangles.reshape(-1).astype(np.int64), prepend=0)
    if np.abs(dv).max() > 32767 or np.abs(di).max() > 2**31 - 1:
        raise ValueError("a shape does not fit its encoding")
    raw = struct.pack("<II", len(vertices_km), len(triangles)) + dv.astype("<i2").tobytes() + di.astype("<i4").tobytes()
    # mtime=0: the same bytes on every run, so CI can diff them.
    return gzip.compress(raw, compresslevel=9, mtime=0), worst


def shape_record(name: str, vertices: np.ndarray, triangles: np.ndarray, path: Path, worst_m: float, source: dict) -> dict:
    a, b, c = (vertices[triangles[:, k]] for k in range(3))
    area = float(np.linalg.norm(np.cross(b - a, c - a), axis=1).sum() / 2)
    volume = float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6)
    r = np.linalg.norm(vertices, axis=1)
    return {
        "file": path.name,
        "sha256": sha256(path),
        "vertices": len(vertices),
        "triangles": len(triangles),
        "quantisationWorstM": round(worst_m, 3),
        "radiusRangeKm": [round(float(r.min()), 3), round(float(r.max()), 3)],
        "volumeKm3": round(volume, 2),
        "meanRadiusKm": round((3 * volume / (4 * math.pi)) ** (1 / 3), 4),
        "areaKm2": round(area, 2),
        **source,
    }


def stickney(zip_path: Path) -> dict:
    with zipfile.ZipFile(zip_path) as z:
        b = z.read("PHOBOS_nomenclature_center_pts.dbf")
    count, header, length = struct.unpack("<IHH", b[4:12])
    fields, o = [], 32
    while b[o] != 0x0D:
        fields.append((b[o : o + 11].split(b"\0")[0].decode(), b[o + 16]))
        o += 32
    for i in range(count):
        row, p, record = b[header + i * length + 1 : header + (i + 1) * length], 0, {}
        for name, size in fields:
            record[name] = row[p : p + size].decode("latin1").strip()
            p += size
        if record["name"] == "Stickney":
            lon = float(record["center_lon"])
            return {
                "name": "Stickney",
                "latDeg": float(record["center_lat"]),
                "lonEastDeg": lon - 360 if lon > 180 else lon,
                "diameterKm": float(record["diameter"]),
                "gazetteer": record["link"].replace("http://", "https://"),
            }
    raise ValueError("no Stickney in the Phobos Gazetteer")


def stickney_check(dsk: Path, s: dict) -> dict:
    """Stickney is a depression where its centre is read as east longitude, not as west."""
    out = {}
    for name, sign in (("readAsEast", 1), ("readAsWest", -1)):
        lon = sign * s["lonEastDeg"]
        ring = [(s["latDeg"] + 20 * math.sin(a), lon + 20 * math.cos(a)) for a in np.linspace(0, 2 * math.pi, 13)[:-1]]
        r = radius_on(dsk, np.array([(s["latDeg"], lon), *ring]))
        out[name] = round(float(np.mean(r[1:]) - r[0]), 3)
    if not out["readAsEast"] > 1.0 > out["readAsWest"]:
        raise ValueError(f"Stickney's longitude does not read as east: {out}")
    return {"centreBelowRingKm": out, "ringDeg": 20}


def rotation(naif: int) -> dict:
    def values(name: str) -> list[float]:
        found = spice.gdpool(name, 0, 1000) if spice.dtpool(name)[0] else []
        return [float(x) for x in found]

    width = int(spice.gipool("BODY4_MAX_PHASE_DEGREE", 0, 1)[0]) + 1
    angles = values("BODY4_NUT_PREC_ANGLES")
    return {
        "frame": spice.cidfrm(naif)[1],
        "source": f"pck00011.tpc: BODY{naif}_POLE_RA, _POLE_DEC, _PM, _NUT_PREC_RA/DEC/PM, BODY4_NUT_PREC_ANGLES, evaluated as IAU_MARS is (core/mars.ts marsRotation)",
        "poleRaDeg": values(f"BODY{naif}_POLE_RA"),
        "poleDecDeg": values(f"BODY{naif}_POLE_DEC"),
        "primeMeridianDeg": values(f"BODY{naif}_PM"),
        "nutPrecRaDeg": values(f"BODY{naif}_NUT_PREC_RA"),
        "nutPrecDecDeg": values(f"BODY{naif}_NUT_PREC_DEC"),
        "nutPrecPmDeg": values(f"BODY{naif}_NUT_PREC_PM"),
        "nutPrecAnglesDeg": [angles[i : i + width] for i in range(0, len(angles), width)],
    }


def position(name: str, et: float) -> np.ndarray:
    return np.array(spice.spkpos(name, et, "J2000", "NONE", "MARS")[0])


def moon_offset(et: float) -> np.ndarray:
    moon = np.array(spice.spkpos("MOON", et, "J2000", ABCORR, "MARS")[0])
    earth = np.array(spice.spkpos("EARTH", et, "J2000", ABCORR, "MARS")[0])
    return moon - earth


def months() -> list[datetime]:
    first = datetime.fromisoformat(START_UTC)
    stop = datetime.fromisoformat(STOP_UTC)
    out, m = [], first
    while m < stop:
        out.append(m)
        m = m.replace(year=m.year + (m.month == 12), month=m.month % 12 + 1)
    return out + [stop]


def series(fn, start: float, stop: float, step: float) -> np.ndarray:
    count = int(round((stop - start) / step)) + 4
    return np.array([fn(start - step + i * step) for i in range(count)], dtype=np.float32)


def build() -> dict:
    kernels = load_kernels()
    # The Moon's orientation, as the Moon page has it (pipeline/ephemeris.py).
    for path, pinned in MOON_KERNELS:
        if all(k["file"] != Path(path).name for k in kernels):
            spice.furnsh(str(fetch(NAIF + path, pinned, Path(path).name)))
            kernels.append({"file": Path(path).name, "url": NAIF + path, "sha256": pinned})
    disc = MoonDisc()
    dsk = fetch(PHOBOS_DSK[0], PHOBOS_DSK[1], "phobos_2014_09_22.bds")
    deimos_tab = fetch(DEIMOS_TAB[0], DEIMOS_TAB[1], "m2deimos.tab")
    phobos_tab = fetch(PHOBOS_TAB[0], PHOBOS_TAB[1], "m1phobos.tab")
    gazetteer = fetch(GAZETTEER[0], GAZETTEER[1], "phobos-nomenclature-2026-10-04.zip")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        sign = thomas_sign_test(dsk, phobos_tab)
        named = stickney(gazetteer)
        named["check"] = stickney_check(dsk, named)

        shapes = {}
        pv, pt = phobos_shape(dsk)
        dv, dt = deimos_shape(deimos_tab)
        for name, (v, t), source in (
            ("phobos", (pv, pt), {"source": "Willner, Shi & Oberst (2014), PSS 102, 51: NAIF phobos_2014_09_22.bds", "url": PHOBOS_DSK[0], "sourceSha256": PHOBOS_DSK[1], "frame": "IAU_PHOBOS"}),
            ("deimos", (dv, dt), {"source": "Thomas (1993), Icarus 105, 326: PDS SBN ast-sat.thomas.shape-models_V1_0 m2deimos.tab, Viking Orbiter only; '~400 m' uncertainty over longitudes 200-355 (its label)", "url": DEIMOS_TAB[0], "sourceSha256": DEIMOS_TAB[1], "frame": "IAU_DEIMOS (the label's pole and W are the IAU's)", "longitude": "west-positive in the table, converted to east", "longitudeSignTest": sign}),
        ):
            t = outward(v, t)
            data, worst = encode_shape(v, t)
            path = OUT_DIR / f"{name}.bin.gz"
            path.write_bytes(data)
            shapes[name] = shape_record(name, v, t, path, worst, source)

        phobos_step = PHOBOS_STEP_MIN * 60.0
        deimos_step = DEIMOS_STEP_MIN * 60.0
        disc_step = MOON_DISC_STEP_MIN * 60.0
        files = []
        bounds = months()
        for a, b in zip(bounds[:-1], bounds[1:]):
            start = spice.str2et(a.isoformat())
            stop = spice.str2et(b.isoformat())
            phobos = series(lambda t: position("PHOBOS", t), start, stop, phobos_step)
            deimos = series(lambda t: position("DEIMOS", t), start, stop, deimos_step)
            moon = series(moon_offset, start, stop, deimos_step)
            moon_disc = series(lambda t: moon_from_mars(disc, t), start, stop, disc_step)
            path = OUT_DIR / f"{a:%Y-%m}.bin"
            np.concatenate([phobos.reshape(-1), deimos.reshape(-1), moon.reshape(-1), moon_disc.reshape(-1)]).astype("<f4").tofile(path)
            files.append(
                {
                    "month": f"{a:%Y-%m}",
                    "file": path.name,
                    "sha256": sha256(path),
                    "fromUtc": a.isoformat() + "Z",
                    "toUtc": b.isoformat() + "Z",
                    "firstPhobosTdbSecondsPastJ2000": start - phobos_step,
                    "firstDeimosTdbSecondsPastJ2000": start - deimos_step,
                    "phobosSamples": len(phobos),
                    "deimosSamples": len(deimos),
                    "firstMoonDiscTdbSecondsPastJ2000": start - disc_step,
                    "moonDiscSamples": len(moon_disc),
                }
            )

        # Interpolation against SPICE at random moments, from the files as written (float32).
        rng = np.random.default_rng(SEED)
        span = (spice.str2et(START_UTC), spice.str2et(STOP_UTC))
        cache: dict[str, np.ndarray] = {}
        edges = [(spice.str2et(x["fromUtc"][:-1]), spice.str2et(x["toUtc"][:-1])) for x in files]

        def interpolated(t: float) -> dict[str, np.ndarray]:
            f = next(x for x, (lo, hi) in zip(files, edges) if lo <= t < hi)
            if f["file"] not in cache:
                cache.clear()
                cache[f["file"]] = np.fromfile(OUT_DIR / f["file"], dtype="<f4").astype(np.float64)
            data = cache[f["file"]]
            np_, nd = f["phobosSamples"], f["deimosSamples"]
            ph = data[: np_ * 3].reshape(np_, 3)
            de = data[np_ * 3 : (np_ + nd) * 3].reshape(nd, 3)
            mo = data[(np_ + nd) * 3 : (np_ + 2 * nd) * 3].reshape(nd, 3)
            md = data[(np_ + 2 * nd) * 3 :].reshape(-1, 1)
            xm = (t - f["firstMoonDiscTdbSecondsPastJ2000"]) / disc_step
            xp = (t - f["firstPhobosTdbSecondsPastJ2000"]) / phobos_step
            xd = (t - f["firstDeimosTdbSecondsPastJ2000"]) / deimos_step
            return {"phobos": lagrange(ph, xp), "deimos": lagrange(de, xd), "moon": lagrange(mo, xd), "moonDisc": float(lagrange(md, xm)[0])}

        worst = {"phobosKm": 0.0, "deimosKm": 0.0, "moonOffsetKm": 0.0, "moonDiscRelative": 0.0}
        moments = np.sort(span[0] + rng.random(CHECK_MOMENTS) * (span[1] - span[0]))
        for t in moments:
            got = interpolated(t)
            worst["phobosKm"] = max(worst["phobosKm"], float(np.linalg.norm(got["phobos"] - position("PHOBOS", t))))
            worst["deimosKm"] = max(worst["deimosKm"], float(np.linalg.norm(got["deimos"] - position("DEIMOS", t))))
            worst["moonOffsetKm"] = max(worst["moonOffsetKm"], float(np.linalg.norm(got["moon"] - moon_offset(t))))
            want = moon_from_mars(disc, t)
            worst["moonDiscRelative"] = max(worst["moonDiscRelative"], abs(got["moonDisc"] / want - 1))

        truths = []
        for t in np.sort(span[0] + rng.random(TRUTH_MOMENTS) * (span[1] - span[0])):
            truths.append(
                {
                    "utc": spice.et2utc(t, "ISOC", 3) + "Z",
                    "tdbSecondsPastJ2000": float(t),
                    "phobosJ2000Km": position("PHOBOS", t).tolist(),
                    "deimosJ2000Km": position("DEIMOS", t).tolist(),
                    "moonOffsetJ2000Km": moon_offset(t).tolist(),
                    "moonDiscKm2": moon_from_mars(disc, t),
                    "j2000ToPhobos": [list(r) for r in spice.pxform("J2000", "IAU_PHOBOS", t)],
                    "j2000ToDeimos": [list(r) for r in spice.pxform("J2000", "IAU_DEIMOS", t)],
                }
            )
        rotations = {"phobos": rotation(401), "deimos": rotation(402)}
        radii = {n: [float(x) for x in spice.bodvrd(n, "RADII", 3)[1]] for n in ("PHOBOS", "DEIMOS")}
    finally:
        spice.kclear()

    manifest = {
        "story": "docs/stories/SS-14.md (W8)",
        "positions": {
            "encoding": "little-endian float32: Phobos (x, y, z) km every phobosStepMinutes, then Deimos every deimosStepMinutes, then the Moon's offset from Earth as seen from Mars every deimosStepMinutes, then the Moon's moonDisc (one value) every moonDiscStepMinutes; J2000, from one step before the month to two after",
            "frame": "J2000, from Mars's centre. Phobos and Deimos geometric (no correction); the Moon's offset is Moon minus Earth, each with LT+S, as the timeline's Earth",
            "moonDisc": "the Moon page's I/F (566 nm albedo map times per-tile Hapke over its value at the map's geometry) times area projected towards Mars, summed over 1 deg cells of the 1737.4 km sphere, km^2; MOON_ME at the light's departure",
            "moonDiscSources": disc.sources,
            "phobosStepMinutes": PHOBOS_STEP_MIN,
            "deimosStepMinutes": DEIMOS_STEP_MIN,
            "moonDiscStepMinutes": MOON_DISC_STEP_MIN,
            "interpolation": "4-point Lagrange through the samples either side (core/marsMoons.ts)",
            "measuredWorstError": {"moments": CHECK_MOMENTS, "seed": SEED, **{k: float(f"{v:.3g}") for k, v in worst.items()}},
            "months": files,
        },
        "shapes": shapes,
        "rotation": rotations,
        "pck00011RadiiKm": radii,
        "stickney": named,
        "gazetteer": {"url": GAZETTEER[0], "sha256": GAZETTEER[1], "retrieved": "2026-10-04"},
        "kernels": kernels,
    }
    OUT_JSON.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    OUT_TRUTH.write_text(
        json.dumps({"source": "SPICE via pipeline/moons_mars.py", "seed": SEED, "moments": truths}, indent=2, allow_nan=False) + "\n"
    )
    return manifest


if __name__ == "__main__":
    m = build()
    for name, s in m["shapes"].items():
        print(f"{name}: {s['vertices']} vertices, {s['triangles']} triangles, mean radius {s['meanRadiusKm']} km, {s['sha256'][:12]}")
    print(json.dumps(m["positions"]["measuredWorstError"]))
    print(json.dumps(m["stickney"]))
    total = sum((OUT_DIR / f["file"]).stat().st_size for f in m["positions"]["months"])
    print(f"{len(m['positions']['months'])} months, {total / 1e6:.2f} MB")
