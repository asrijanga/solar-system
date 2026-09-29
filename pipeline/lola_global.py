"""The Moon's albedo where the base map never measured it, from LOLA's global laser albedo.

Owner decision, 2026-09-26: "This purple is distracting and disrupting the cinematic effect,
drop purple and fill gaps." The gaps are filled with a measurement, not invented. LOLA lights
the surface with its own laser, so it measured albedo everywhere the cameras missed (README,
"Combine every available source"). Since SS-5b the base map is LRO WAC's Hapke-normalised
mosaic (wac.py); before, it was Clementine.

Source: LOLA LDAM_10_FLOAT, Lemelin et al. (2016), PDS data set LRO-L-LOLA-4-GDR-V1.0. From its
label (ldam_10_float.lbl):
- **Format:** 3600 x 1800 32-bit little-endian floats, SIMPLE CYLINDRICAL, 10 pixels per degree
  (3032.34 m/pixel true at the equator), R = 1737.4 km.
- **Registration:** pixel registered. CENTER_LONGITUDE = 180, WESTERNMOST_LONGITUDE = 0,
  LINE_PROJECTION_OFFSET = 899.5, SAMPLE_PROJECTION_OFFSET = 1799.5. So 0-based sample j is
  longitude 0.05 + 0.1 j degrees east, and 0-based line i is latitude 89.95 - 0.1 i.
- **Frame and values:** planetocentric latitude, POSITIVE_LONGITUDE_DIRECTION = EAST, frame
  "MEAN EARTH/POLAR AXIS OF DE421". Values are 1064 nm normal albedo (0.13 to 0.57).
- **Interpolation:** the label says the ground tracks were interpolated with Generic Mapping
  Tools; that is the publisher's product.

Combination, in the base map's units (I/F):
- **Calibration:** base = gain * LOLA albedo + offset, least squares, over |latitude| < 60
  degrees where the base measured. The fit's r and RMS residual are recorded.
- **Local match:** the base and LOLA differ in wavelength and resolution, so a gap filled with
  the global fit alone can show its outline. The difference (base minus calibrated LOLA) is
  known wherever the base measured. Inside each gap it is carried in from the gap's
  surroundings by the same pull-push spreading the encoder uses (moon.pull_push_fill), and
  added to the calibrated LOLA value. At a gap's edge the fill then meets the base; inside, the
  detail is LOLA's. The recorded statistics say how large this local correction is.
- **Where:** used only where no earlier source measured a pixel (after the LOLA polar step,
  lola_poles.py). Every earlier value is unchanged.
"""

from __future__ import annotations

import numpy as np
from typing import Callable

from download import fetch

URL = (
    "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/"
    "cylindrical/float_img/ldam_10_float.img"
)
# LOLA publishes no checksum for it. Pinned 2026-09-26 from the first download, which matched its
# label exactly: 25,920,000 bytes and MINIMUM 0.130483299494, MAXIMUM 0.572705984116.
SHA256 = "6a14cac07b26e3d2c8576823e20c7f4aa47afb0b65ba55df11cf67e64c7b3761"
LINES, SAMPLES, PPD = 1800, 3600, 10
FIT_MAX_LAT = 60.0


def load() -> np.ndarray:
    path = fetch(URL, SHA256, "ldam_10_float.img")
    return np.fromfile(path, dtype="<f4").reshape(LINES, SAMPLES).astype(np.float64)


def pixel_coordinates(lat_deg: np.ndarray, lon_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """0-based fractional (line, sample) of a point, from the label's projection offsets."""
    line = (89.95 - lat_deg) * PPD
    sample = (np.mod(lon_deg, 360.0) - 0.05) * PPD
    return line, sample


def bilinear(image: np.ndarray, line: np.ndarray, sample: np.ndarray) -> np.ndarray:
    """Bilinear sample, clamped at the poles and wrapping in longitude."""
    line = np.clip(line, 0.0, LINES - 1.0)
    l0 = np.floor(line).astype(np.int64)
    s0 = np.floor(sample).astype(np.int64)
    fl = line - l0
    fs = sample - s0
    l1 = np.minimum(l0 + 1, LINES - 1)
    s0w = np.mod(s0, SAMPLES)
    s1w = np.mod(s0 + 1, SAMPLES)
    top = image[l0, s0w] * (1 - fs) + image[l0, s1w] * fs
    bottom = image[l1, s0w] * (1 - fs) + image[l1, s1w] * fs
    return top * (1 - fl) + bottom * fl


def fill(
    combined: np.ndarray, spread: Callable[[np.ndarray, np.ndarray], np.ndarray]
) -> tuple[np.ndarray, dict]:
    """Fill the pixels still NaN (never measured) in the combined I/F map with calibrated LOLA.

    `spread(values, valid)` carries values into the invalid pixels from their surroundings
    (moon.pull_push_fill). Returns the filled map and a record of the fit and the fill.
    """
    height, width = combined.shape
    lola = load()
    lat = 90.0 - (np.arange(height) + 0.5) * 180.0 / height
    lon = (np.arange(width) + 0.5) * 360.0 / width - 180.0
    lat_g = np.repeat(lat[:, None], width, axis=1)
    lon_g = np.repeat(lon[None, :], height, axis=0)
    line, sample = pixel_coordinates(lat_g, lon_g)
    l_vals = bilinear(lola, line, sample)
    del lat_g, lon_g, line, sample

    measured = np.isfinite(combined)
    values = np.nan_to_num(combined)
    fit = measured & (np.abs(lat)[:, None] < FIT_MAX_LAT) & np.isfinite(l_vals)
    x = l_vals[fit]
    y = values[fit]
    gain, offset = np.polyfit(x, y, 1)
    residual = y - (gain * x + offset)
    r = float(np.corrcoef(x, y)[0, 1])
    calibrated = gain * l_vals + offset

    gaps = ~measured
    correction = spread(np.where(measured, values - calibrated, 0.0), measured)
    out = np.where(gaps, calibrated + correction, values)
    c = correction[gaps]

    record = {
        "product": "LDAM_10_FLOAT",
        "url": URL,
        "sha256": SHA256,
        "fit": {
            "model": "base I/F = gain * lola_albedo + offset",
            "band": f"|latitude| < {FIT_MAX_LAT:g} deg, base measured",
            "pixels": int(fit.sum()),
            "gain": round(float(gain), 6),
            "offset": round(float(offset), 6),
            "r": round(r, 4),
            "rmsResidual": round(float(np.sqrt(np.mean(residual**2))), 6),
        },
        "localMatch": {
            "method": "base minus calibrated LOLA, spread into each gap by pull-push",
            "medianAbsCorrection": round(float(np.median(np.abs(c))), 6) if c.size else 0.0,
            "p99AbsCorrection": round(float(np.percentile(np.abs(c), 99)), 6) if c.size else 0.0,
        },
        "pixelsFilled": int(gaps.sum()),
    }
    return out, record
