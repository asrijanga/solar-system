"""Mercury's true albedo and colour (docs/stories/SS-16.md, W3).

    npm run pipeline:mercury

Python for the array maths on about 27 GB of PDS tiles (CLAUDE.md, Stack). Too large for CI;
pipeline/test_mercury.py checks the committed files instead.

Owner decisions (SS-16, 2026-10-08):
- "MD3 colour": MESSENGER MDIS's 3-colour map, the lowest-incidence campaign averaged over many
  images (residual shading at most about a tenth of a deliberately low-Sun map's, measured in W3).
- "MDR there, cross-calibrated": MD3 stops at 43.755 S. South of about 40 S, MDR's same three
  filters, scaled band by band to MD3 where both measured, blended across 38-43 S, provenance kept.
  Where neither measured stays a gap.

Sources (pipeline/mercury_sources.json, every file MD5-checked as it streams): PDS Imaging
MSGRMDS_6001 (MD3 v2, 45 tiles, 128 px/deg) and MSGRMDS_5001 (MDR v4, 55 tiles at 64 px/deg,
including the south polar tile and its gap-filling "_2700_" version). Both are reflectance at
i = 30, e = 0, g = 30 deg by a Kaasalainen-Shkuratov model with the same parameters per band
(MDIS_CDR_RDRSIS.PDF 2.4), on a 2439.4 km sphere, planetocentric, east-positive.

Tile geometry, from each label (PDS3 map projection keywords, DSMAP convention), 0-based pixel
centres i (line) and j (sample):
- EQUIRECTANGULAR: y = R lat, x = R (lon - CENTER_LONGITUDE) cos(CENTER_LATITUDE);
  i = LINE_PROJECTION_OFFSET - 1 - y / MAP_SCALE, j = SAMPLE_PROJECTION_OFFSET - 1 + x / MAP_SCALE.
  Checked against every label's MAXIMUM_LATITUDE and longitude edges: the tile's edges fall at
  -0.5 and LINES - 0.5 (tile_edges_check).
- POLAR STEREOGRAPHIC: rho = 2 R tan(45 - |lat| / 2) deg; the eight ways to lay rho's x and y on
  the tile were each tried against the equatorial tiles the polar tile overlaps (53.8 to 65 deg),
  and the one that matches is used and recorded (polar_orientation). The convention is not assumed:
  the Moon's polar products had a label formula that disagreed with their prose (SS-6b).

Outputs in public/data/mercury/, column 0 = longitude -180 deg, row 0 = latitude +90:
- albedo.webp, 8192 x 4096, grey, lossless: reflectance at 750 nm, byte = 255 sqrt(R / MAX).
- albedo-colour.png, 2048 x 1024, RGB: red R(1000)/R(750), green R(430)/R(750), each linear over
  the range the manifest gives; blue is unused (0).
- albedo-source.png, 2048 x 1024, grey: 0 gap, 85 MD3, 170 MDR (calibrated), 255 blend.
- albedo.json: the sources, the calibration fit, the blend, coverage and checks.
"""

from __future__ import annotations

import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

import mercury_tiles as tiles
from download import sha256

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "mercury"
WIDTH, HEIGHT = 8192, 4096
COLOUR_SCALE = 4  # colour is four times coarser than brightness, as for the Moon and Mars
BANDS_NM = (430, 750, 1000)
# MD3 alone north of BLEND_NORTH, MDR alone south of BLEND_SOUTH, smoothstep between (owner).
BLEND_NORTH, BLEND_SOUTH = -38.0, -43.0
# Where MD3 and MDR are both compared for the calibration: MD3's southern tiles, clear of the blend.
CALIBRATION_BAND = (-37.0, -20.0)
# The albedo file's cap. Lossy WebP smeared the plains into blocks even at q95, as on Mars; lossless
# at 8192 x 4096 is 12.4 MB (owner, 2026-10-08, "Lossless 8192, 12.4 MB", docs/stories/ss16-albedo-encoding.png).
MAX_BYTES = 13_000_000


def grid() -> tuple[np.ndarray, np.ndarray]:
    lat = 90 - (np.arange(HEIGHT) + 0.5) * 180 / HEIGHT
    lon = -180 + (np.arange(WIDTH) + 0.5) * 360 / WIDTH
    return lat, lon


def source_coords(meta: dict, lat: np.ndarray, lon: np.ndarray, orientation: tuple[int, int, bool] = (1, 1, False)) -> tuple[np.ndarray, np.ndarray]:
    """Fractional 0-based (line, sample) in the reduced tile for lat/lon in degrees."""
    r = meta["radiusKm"] * 1000
    scale = meta["mapScaleM"]
    if meta["projection"] == "EQUIRECTANGULAR":
        dlon = (lon - meta["centerLongitude"] + 180) % 360 - 180
        y = r * np.radians(lat)
        x = r * np.radians(dlon) * math.cos(math.radians(meta["centerLatitude"]))
        i = meta["lineOffset"] - 1 - y / scale
        j = meta["sampleOffset"] - 1 + x / scale
    elif meta["projection"] == "POLAR STEREOGRAPHIC":
        north = meta["centerLatitude"] > 0
        rho = 2 * r * np.tan(np.radians(45 - np.abs(lat) / 2))
        dlon = np.radians(lon - meta["centerLongitude"])
        a = rho * np.sin(dlon) / scale
        b = rho * np.cos(dlon) / scale * (1 if north else -1)
        sx, sy, swap = orientation
        u, v = (b, a) if swap else (a, b)
        j = meta["sampleOffset"] - 1 + sx * u
        i = meta["lineOffset"] - 1 + sy * v
    else:
        raise ValueError(meta["projection"])
    k = meta["block"]
    return (i - (k - 1) / 2) / k, (j - (k - 1) / 2) / k


def sample(bands: np.ndarray, i: np.ndarray, j: np.ndarray) -> np.ndarray:
    """Bilinear, ignoring missing neighbours; NaN outside the tile or where none is measured."""
    out = np.full((bands.shape[0],) + i.shape, np.nan)
    inside = (i >= -0.5) & (i <= bands.shape[1] - 0.5) & (j >= -0.5) & (j <= bands.shape[2] - 0.5)
    if not inside.any():
        return out
    ii, jj = np.clip(i[inside], 0, bands.shape[1] - 1), np.clip(j[inside], 0, bands.shape[2] - 1)
    for b in range(bands.shape[0]):
        ok = np.isfinite(bands[b])
        num = map_coordinates(np.where(ok, bands[b], 0), [ii, jj], order=1, mode="nearest")
        den = map_coordinates(ok.astype(np.float32), [ii, jj], order=1, mode="nearest")
        out[b][inside] = np.where(den > 0.5, num / np.maximum(den, 1e-9), np.nan)
    return out


def tile_region(meta: dict, lat: np.ndarray, lon: np.ndarray) -> tuple[slice, np.ndarray]:
    rows = (lat <= meta["maximumLatitude"] + 0.1) & (lat >= meta["minimumLatitude"] - 0.1)
    return slice(int(np.argmax(rows)), int(len(rows) - np.argmax(rows[::-1]))), lon


def place(kind: str, entries: list[dict], orientations: dict) -> tuple[np.ndarray, dict]:
    """Every tile of one product on the global grid; the first measured value wins."""
    lat, lon = grid()
    out = np.full((3, HEIGHT, WIDTH), np.nan, np.float32)
    count = {}
    # The 2700 m south polar MDR tile only fills what the nominal tile left.
    entries = sorted(entries, key=lambda e: "_2700_" in e["path"])
    for entry in entries:
        t = tiles.reduce_tile(kind, entry)
        meta, bands = t["meta"], t["bands"]
        rs, _ = tile_region(meta, lat, lon)
        la, lo = np.meshgrid(lat[rs], lon, indexing="ij")
        orient = orientations.get(Path(entry["path"]).name, (1, 1, False))
        i, j = source_coords(meta, la, lo, orient)
        values = sample(bands, i, j)
        target = out[:, rs]
        fill = np.isnan(target[1]) & np.isfinite(values[1])
        for b in range(3):
            target[b][fill] = values[b][fill]
        count[Path(entry["path"]).name] = int(fill.sum())
    return out, count


ORIENTATIONS = [(sx, sy, swap) for swap in (False, True) for sx in (1, -1) for sy in (1, -1)]


def polar_orientation(kind: str, entry: dict, others: list[dict]) -> dict:
    """The polar tile's orientation that best matches its equatorial neighbours where they overlap."""
    lat, lon = grid()
    meta = tiles.reduce_tile(kind, entry)["meta"]
    north = meta["centerLatitude"] > 0
    band = (lat > 60) & (lat < 66) if north else (lat < -60) & (lat > -66)
    la, lo = np.meshgrid(lat[band], lon, indexing="ij")
    # The neighbours' 750 nm band over the overlap, from the equirectangular tiles only.
    reference = np.full(la.shape, np.nan)
    for other in others:
        t = tiles.reduce_tile(kind, other)
        if t["meta"]["projection"] != "EQUIRECTANGULAR":
            continue
        v = sample(t["bands"][1:2], *source_coords(t["meta"], la, lo))[0]
        reference = np.where(np.isnan(reference), v, reference)
    bands = tiles.reduce_tile(kind, entry)["bands"][1:2]
    scores = []
    for o in ORIENTATIONS:
        v = sample(bands, *source_coords(meta, la, lo, o))[0]
        ok = np.isfinite(v) & np.isfinite(reference)
        r = float(np.corrcoef(v[ok], reference[ok])[0, 1]) if ok.sum() > 1000 else float("nan")
        scores.append({"orientation": list(o), "correlation": round(r, 4), "pixels": int(ok.sum())})
    best = max(scores, key=lambda s: -1 if math.isnan(s["correlation"]) else s["correlation"])
    others_r = sorted((s["correlation"] for s in scores if s is not best and not math.isnan(s["correlation"])), reverse=True)
    if not best["correlation"] >= 0.8 or (others_r and others_r[0] > best["correlation"] - 0.3):
        raise ValueError(f"{entry['path']}: no clear polar orientation: {scores}")
    return {"tile": Path(entry["path"]).name, "chosen": best, "all": scores}


def tile_edges_check(entries: list[dict]) -> dict:
    """Each equirectangular tile's first and last line centres sit half a pixel in from its labelled
    latitude limits, by the formula used."""
    worst = 0.0
    for kind, entry in entries:
        meta = tiles.reduce_tile(kind, entry)["meta"]
        if meta["projection"] != "EQUIRECTANGULAR":
            continue
        r, s = meta["radiusKm"] * 1000, meta["mapScaleM"]
        top = meta["lineOffset"] - 1 - r * math.radians(meta["maximumLatitude"]) / s
        bottom = meta["lineOffset"] - 1 - r * math.radians(meta["minimumLatitude"]) / s
        worst = max(worst, abs(top + 0.5), abs(bottom - (meta["lines"] - 0.5)))
    if worst > 1.0:
        raise ValueError(f"tile edges off by {worst:.2f} px")
    return {"worstEdgeOffsetPx": round(worst, 3)}


def calibrate(md3: np.ndarray, mdr: np.ndarray) -> dict:
    lat, _ = grid()
    rows = (lat > CALIBRATION_BAND[0]) & (lat < CALIBRATION_BAND[1])
    fits = []
    for b, nm in enumerate(BANDS_NM):
        a, m = md3[b][rows], mdr[b][rows]
        ok = np.isfinite(a) & np.isfinite(m)
        gain = float(np.sum(a[ok] * m[ok]) / np.sum(m[ok] ** 2))
        ratio = a[ok] / m[ok]
        resid = a[ok] - gain * m[ok]
        # Stability: the gain in each 5-degree latitude strip of the band.
        strips = []
        for lo in np.arange(CALIBRATION_BAND[0], CALIBRATION_BAND[1], 5.0):
            s = (lat[rows] > lo) & (lat[rows] < lo + 5)
            sel = ok & s[:, None]
            if sel.sum() > 1000:
                strips.append(round(float(np.sum(a[sel] * m[sel]) / np.sum(m[sel] ** 2)), 4))
        fits.append(
            {
                "nm": nm,
                "gainMd3OverMdr": round(gain, 4),
                "medianRatio": round(float(np.median(ratio)), 4),
                "correlation": round(float(np.corrcoef(a[ok], m[ok])[0, 1]), 4),
                "rmsRelativeResidual": round(float(np.sqrt(np.mean((resid / a[ok]) ** 2))), 4),
                "gainBy5DegreeStrip": strips,
                "pixels": int(ok.sum()),
            }
        )
    return {"latitudeBandDeg": list(CALIBRATION_BAND), "model": "MD3 = gain x MDR, least squares through the origin, per band", "bands": fits}


def products_agreement(md3: np.ndarray, mdr: np.ndarray) -> dict:
    """MD3 against MDR at 750 nm, 4 px/deg, by 15-degree band: two independently assembled PDS
    products, so a region where they disagree would show a problem in either."""
    a, b = bin_mean(md3[1].astype(np.float64), 720, 1440), bin_mean(mdr[1].astype(np.float64), 720, 1440)
    lat = 90 - (np.arange(720) + 0.5) / 4
    out = {}
    for top in range(90, -45, -15):
        ok = ((lat <= top) & (lat > top - 15))[:, None] & np.isfinite(a) & np.isfinite(b)
        if ok.sum() > 100:
            out[f"{top} to {top - 15}"] = round(float(np.corrcoef(a[ok], b[ok])[0, 1]), 4)
    return {"band": "750 nm, 4 px/deg", "correlationBy15DegreeBand": out}


def combine(md3: np.ndarray, mdr: np.ndarray, fit: dict) -> tuple[np.ndarray, np.ndarray]:
    lat, _ = grid()
    gains = np.array([f["gainMd3OverMdr"] for f in fit["bands"]])[:, None, None]
    mdr_cal = mdr * gains
    t = np.clip((lat - BLEND_SOUTH) / (BLEND_NORTH - BLEND_SOUTH), 0, 1)
    w = (t * t * (3 - 2 * t))[:, None] * np.ones((1, WIDTH))
    have3 = np.isfinite(md3[1])
    haver = np.isfinite(mdr_cal[1])
    w = np.where(have3, w, 0.0)
    w = np.where(haver, w, np.where(have3, 1.0, 0.0))
    out = np.where(w > 0, np.nan_to_num(md3) * w, 0) + np.where(w < 1, np.nan_to_num(mdr_cal) * (1 - w), 0)
    out = np.where(have3 | haver, out, np.nan)
    source = np.where(~(have3 | haver), 0, np.where(w >= 1, 1, np.where(w <= 0, 2, 3)))
    return out.astype(np.float32), source.astype(np.uint8)


def block_mean(a: np.ndarray, k: int) -> np.ndarray:
    h, w = a.shape[-2] // k, a.shape[-1] // k
    with np.errstate(invalid="ignore"):
        return np.nanmean(a[..., : h * k, : w * k].reshape(a.shape[:-2] + (h, k, w, k)), axis=(-3, -1))


def bin_mean(a: np.ndarray, rows: int, cols: int) -> np.ndarray:
    """Mean of every grid pixel whose centre falls in each of rows x cols equal cells (NaN ignored)."""
    r = (np.arange(a.shape[0]) * rows) // a.shape[0]
    c = (np.arange(a.shape[1]) * cols) // a.shape[1]
    ok = np.isfinite(a)
    total = np.zeros((rows, cols))
    count = np.zeros((rows, cols))
    np.add.at(total, (r[:, None], c[None, :]), np.where(ok, a, 0))
    np.add.at(count, (r[:, None], c[None, :]), ok)
    with np.errstate(invalid="ignore"):
        return np.where(count > 0, total / np.maximum(count, 1), np.nan)


# North of 45 N USGS's copy disagrees with both PDS products, which agree with each other
# (SS-16 W3: by 15-degree band, USGS against MD3 0.38 and 0.78 above 60 N, MD3 against MDR 0.85 and
# 0.96), so the test is applied south of it; every band is still recorded.
USGS_NORTH_LIMIT = 45.0
USGS_MD3 = "https://planetarymaps.usgs.gov/mosaic/Mercury_MESSENGER_MDIS_Basemap_MD3Color_Mosaic_Global_665m.tif"


def usgs_agreement(r750: np.ndarray) -> dict:
    """Ours against USGS's own mosaic of the same MD3 tiles (an independent assembly: its 8-bit
    stretch of about 0 to 0.2, 64 px/deg, Simple Cylindrical centred on 0). Every 16th row, columns
    averaged in 16s, so 4 px/deg. USGS's stretch clips much of the far north (a third of the pixels
    at 85 N read 1, and a sixth 255), and it fills MD3's gaps; neither is compared. Also against ours mirrored east-west and shifted by 1 deg, which
    must agree less: the check can see a mirrored or misplaced map."""
    import rasterio
    from rasterio.windows import Window

    cache = tiles.TILE_CACHE / "usgs_md3_750_4ppd_unclipped.npy"
    if cache.exists():
        usgs = np.load(cache)
    else:
        rows = []
        with rasterio.open("/vsicurl/" + USGS_MD3) as d:
            for r in range(8, d.height, 16):
                raw = d.read(2, window=Window(0, r, d.width, 1))[0]
                a = raw.astype(np.float64)
                a[raw == 0] = np.nan
                with np.errstate(invalid="ignore"):
                    mean = np.nanmean(a.reshape(-1, 16), axis=1)
                # A cell holding a value clipped by the 8-bit stretch (1 or 255) is not a measurement.
                clipped = ((raw == 1) | (raw == 255)).reshape(-1, 16).any(axis=1)
                rows.append(np.where(clipped, np.nan, mean))
        usgs = np.array(rows)  # 720 x 1440, 750 nm band (green)
        np.save(cache, usgs)
    ours = bin_mean(r750.astype(np.float64), *usgs.shape)
    lat = 90 - (np.arange(usgs.shape[0]) + 0.5) * 180 / usgs.shape[0]
    whole = (lat > -40)[:, None] & np.isfinite(usgs) & np.isfinite(ours)
    region = whole & ((lat > -40) & (lat < USGS_NORTH_LIMIT))[:, None]

    def corr(o: np.ndarray, rows: np.ndarray | None = None) -> float:
        ok = (whole if rows is not None else region) & np.isfinite(o)
        if rows is not None:
            ok &= rows[:, None]
        return round(float(np.corrcoef(o[ok], usgs[ok])[0, 1]), 4)

    result = {
        "source": USGS_MD3,
        "sampling": "every 16th USGS row, 16-column means: 4 px/deg, 45 N to 40 S; cells holding a value clipped by USGS's 8-bit stretch (1 or 255) left out",
        "cellsCompared": int(region.sum()),
        "correlation": corr(ours),
        "correlationBy15DegreeBand": {f"{a} to {a - 15}": corr(ours, (lat <= a) & (lat > a - 15)) for a in range(90, -40, -15)},
        "mirroredEastWest": corr(ours[:, ::-1]),
        "shifted1DegEast": corr(np.roll(ours, 4, axis=1)),
    }
    if not result["correlation"] > 0.9 > max(result["mirroredEastWest"], result["shifted1DegEast"]):
        raise ValueError(f"ours does not match USGS's MD3 mosaic: {result}")
    return result


def build() -> dict:
    src = tiles.SOURCES
    orientations, records = {}, []
    for kind in ("md3", "mdr"):
        entries = src[kind]
        polar = [e for e in entries if "_H01NP" in e["path"] or "H15SP" in e["path"]]
        for p in polar:
            hemisphere = "H01" if "H01" in p["path"] else "H15"
            neighbours = [e for e in entries if e not in polar and (any(f"/{h}/" in e["path"] for h in (("H02", "H03", "H04", "H05") if hemisphere == "H01" else ("H11", "H12", "H13", "H14"))))]
            rec = polar_orientation(kind, p, neighbours)
            orientations[rec["tile"]] = tuple(rec["chosen"]["orientation"])
            records.append(rec)
    edges = tile_edges_check([("md3", e) for e in src["md3"]] + [("mdr", e) for e in src["mdr"]])
    md3, md3_count = place("md3", src["md3"], orientations)
    mdr, mdr_count = place("mdr", src["mdr"], orientations)
    agreement = usgs_agreement(md3[1])
    fit = calibrate(md3, mdr)
    products = products_agreement(md3, mdr)
    albedo, source = combine(md3, mdr, fit)
    r750 = albedo[1]
    measured = np.isfinite(r750)
    max_reflectance = round(float(np.ceil(np.nanpercentile(r750.astype(np.float64), 99.99) * 100) / 100), 2)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    master = np.where(measured, np.clip(np.rint(255 * np.sqrt(np.clip(r750, 0, max_reflectance) / max_reflectance)), 1, 255), 0).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(master, "L").save(buf, format="WEBP", lossless=True, method=6)
    webp = buf.getvalue()
    if not np.array_equal(np.asarray(Image.open(io.BytesIO(webp)).convert("L")), master):
        raise RuntimeError("lossless WebP did not decode to the master")
    if len(webp) > MAX_BYTES:
        raise RuntimeError(f"albedo is {len(webp)} bytes, over the {MAX_BYTES} cap")
    (OUT_DIR / "albedo.webp").write_bytes(webp)
    # Colour: band ratios over 4 x 4 blocks, linear over their 0.5 and 99.5 percentiles.
    small = block_mean(albedo.astype(np.float64), COLOUR_SCALE)
    with np.errstate(invalid="ignore", divide="ignore"):
        red, green = small[2] / small[1], small[0] / small[1]
    ranges = {}
    channels = []
    for name, v in (("1000/750", red), ("430/750", green)):
        lo, hi = (float(np.round(x, 3)) for x in np.nanpercentile(v, [0.5, 99.5]))
        ranges[name] = [lo, hi]
        channels.append(np.where(np.isfinite(v), np.clip(np.rint((v - lo) / (hi - lo) * 255), 0, 255), 0).astype(np.uint8))
    rgb = np.stack(channels + [np.zeros_like(channels[0])], axis=-1)
    Image.fromarray(rgb, "RGB").save(OUT_DIR / "albedo-colour.png", optimize=True)
    src_small = source[COLOUR_SCALE // 2 :: COLOUR_SCALE, COLOUR_SCALE // 2 :: COLOUR_SCALE]
    Image.fromarray((src_small.astype(np.uint16) * 85).astype(np.uint8), "L").save(OUT_DIR / "albedo-source.png", optimize=True)
    lat, _ = grid()
    area = np.cos(np.radians(lat))[:, None] * np.ones((1, WIDTH))
    share = lambda code: round(float(area[source == code].sum() / area.sum()), 5)  # noqa: E731
    manifest = {
        "story": "docs/stories/SS-16.md (W3)",
        "chosen": "owner, 2026-10-08: MD3 colour; south of 40 S, MDR cross-calibrated, blended across 38-43 S",
        "sources": {
            "md3": {"volume": "MSGRMDS_6001", "product": "MDIS MD3 v2, 128 px/deg, 430/750/1000 nm", "tiles": len(src["md3"])},
            "mdr": {"volume": "MSGRMDS_5001", "product": "MDIS MDR v4, 64 px/deg, bands 430/750/1000 nm of 8", "tiles": len(src["mdr"])},
            "pins": "pipeline/mercury_sources.json (PDS-published MD5 of every file, checked while streaming)",
            "normalisation": "reflectance corrected to i = 30, e = 0, g = 30 deg, Kaasalainen-Shkuratov (MDIS_CDR_RDRSIS.PDF 2.4)",
        },
        "conventions": "equirectangular, planetocentric, east-positive, 2439.4 km sphere; column 0 = -180 deg, row 0 = +90 deg",
        "tileGeometry": {"edges": edges, "polarOrientation": records},
        "pixelsPlaced": {"md3": md3_count, "mdr": mdr_count},
        "usgsAgreement": agreement,
        "md3AgainstMdr": products,
        "calibration": fit,
        "blend": {"md3AloneNorthOfDeg": BLEND_NORTH, "mdrAloneSouthOfDeg": BLEND_SOUTH, "weight": "smoothstep in latitude; where only one product measured, that one"},
        "coverage": {"md3": share(1), "mdr": share(2), "blend": share(3), "gap": share(0)},
        "texture": {
            "file": "albedo.webp",
            "width": WIDTH,
            "height": HEIGHT,
            "values": f"reflectance at 750 nm (i = 30, e = 0, g = 30), byte = 255 sqrt(R / {max_reflectance}); 0 = not measured",
            "encoding": {"curve": "sqrt", "maxReflectance": max_reflectance},
            "bytes": len(webp),
            "sha256": sha256(OUT_DIR / "albedo.webp"),
            "median750": round(float(np.nanmedian(r750)), 5),
        },
        "colour": {
            "file": "albedo-colour.png",
            "width": WIDTH // COLOUR_SCALE,
            "height": HEIGHT // COLOUR_SCALE,
            "bandsNm": list(BANDS_NM),
            "channels": "red = R(1000)/R(750), green = R(430)/R(750), each byte linear over its range; blue unused",
            "ranges": ranges,
            "sha256": sha256(OUT_DIR / "albedo-colour.png"),
        },
        "source": {"file": "albedo-source.png", "codes": {"0": "gap", "85": "MD3", "170": "MDR, calibrated", "255": "blend"}, "sha256": sha256(OUT_DIR / "albedo-source.png")},
    }
    (OUT_DIR / "albedo.json").write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    return manifest


if __name__ == "__main__":
    m = build()
    print(json.dumps({k: m[k] for k in ("coverage", "usgsAgreement", "md3AgainstMdr", "calibration")}, indent=1))
    for r in m["tileGeometry"]["polarOrientation"]:
        print(r["tile"], r["chosen"])
    print("texture", m["texture"]["bytes"], "bytes; median 750", m["texture"]["median750"])
