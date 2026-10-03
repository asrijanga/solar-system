"""Hapke's radiance factor in numpy: a port of src/core/hapke.ts, the app's unit-tested model,
for normalising images to a map's geometry (SS-14 W3 part 3). pipeline/test_hapke.py checks it
against values the TypeScript computes (test/fixtures/hapke-values.json), so the two cannot drift.

Python because the images it normalises are numpy arrays in the Mars pipeline (CLAUDE.md, Stack).
"""

from __future__ import annotations

import math

import numpy as np

TINY = 1e-6


def hapke_h(x: np.ndarray, w: float) -> np.ndarray:
    xs = np.maximum(x, TINY)
    gamma = math.sqrt(1 - w)
    r0 = (1 - gamma) / (1 + gamma)
    return 1 / (1 - w * xs * (r0 + ((1 - 2 * r0 * xs) / 2) * np.log((1 + xs) / xs)))


def roughness(mu0, mu, cos_psi, theta_bar_deg: float):
    tan_t = math.tan(math.radians(theta_bar_deg))
    chi = 1 / math.sqrt(1 + math.pi * tan_t * tan_t)
    sin_i = np.sqrt(np.maximum(0, 1 - mu0 * mu0))
    sin_e = np.sqrt(np.maximum(0, 1 - mu * mu))
    tan_i = np.maximum(sin_i / np.maximum(mu0, TINY), TINY)
    tan_e = np.maximum(sin_e / np.maximum(mu, TINY), TINY)
    with np.errstate(over="ignore", divide="ignore"):
        e1i = np.exp(-2 / (math.pi * tan_t * tan_i))
        e1e = np.exp(-2 / (math.pi * tan_t * tan_e))
        e2i = np.exp(-1 / (math.pi * tan_t * tan_t * tan_i * tan_i))
        e2e = np.exp(-1 / (math.pi * tan_t * tan_t * tan_e * tan_e))
    eta_i = chi * (mu0 + sin_i * tan_t * (e2i / (2 - e1i)))
    eta_e = chi * (mu + sin_e * tan_t * (e2e / (2 - e1e)))
    psi = np.arccos(np.clip(cos_psi, -1, 1))
    sin_half_psi2 = np.sin(psi / 2) ** 2
    f = np.exp(-2 * np.tan(np.minimum(psi, math.pi - TINY) / 2))
    d_a = 2 - e1e - (psi / math.pi) * e1i
    mu0e_a = chi * (mu0 + sin_i * tan_t * ((cos_psi * e2e + sin_half_psi2 * e2i) / d_a))
    mue_a = chi * (mu + sin_e * tan_t * ((e2e - sin_half_psi2 * e2i) / d_a))
    s_a = (mue_a / eta_e) * (mu0 / eta_i) * (chi / (1 - f + f * chi * (mu0 / eta_i)))
    d_b = 2 - e1i - (psi / math.pi) * e1e
    mu0e_b = chi * (mu0 + sin_i * tan_t * ((e2i - sin_half_psi2 * e2e) / d_b))
    mue_b = chi * (mu + sin_e * tan_t * ((cos_psi * e2i + sin_half_psi2 * e2e) / d_b))
    s_b = (mue_b / eta_e) * (mu0 / eta_i) * (chi / (1 - f + f * chi * (mu / eta_e)))
    a = mu0 >= mu
    return np.where(a, mu0e_a, mu0e_b), np.where(a, mue_a, mue_b), np.where(a, s_a, s_b)


def hapke(mu0, mu, cos_g, p: dict, theta_bar_deg: float) -> np.ndarray:
    """I/F for cosines mu0 and mu and cos g, broadcast; 0 where the Sun is down or the surface
    faces away. `p` holds w, b, c, bs0 and hs, as core/hapke.ts's HapkeParameters."""
    mu0, mu, cos_g = np.broadcast_arrays(
        np.asarray(mu0, float), np.asarray(mu, float), np.asarray(cos_g, float)
    )
    s = np.sqrt(np.maximum(0, 1 - mu0 * mu0) * np.maximum(0, 1 - mu * mu))
    cos_psi = np.where(s < TINY, 1.0, np.clip((cos_g - mu0 * mu) / np.maximum(s, TINY), -1, 1))
    mu0e, mue, sh = roughness(mu0, mu, cos_psi, theta_bar_deg)
    b, c = p["b"], p["c"]
    back = (1 - b * b) / (1 - 2 * b * cos_g + b * b) ** 1.5
    forward = (1 - b * b) / (1 + 2 * b * cos_g + b * b) ** 1.5
    phase = ((1 + c) / 2) * back + ((1 - c) / 2) * forward
    sin_g = np.sqrt(np.maximum(0, 1 - cos_g * cos_g))
    tan_half = sin_g / np.maximum(1 + cos_g, TINY)
    surge = 1 + p["bs0"] / (1 + tan_half / max(p["hs"], TINY))
    w = p["w"]
    multiple = hapke_h(mu0e, w) * hapke_h(mue, w) - 1
    out = (w / 4) * (mu0e / (mu0e + mue)) * (phase * surge + multiple) * sh
    return np.where((mu0 > 0) & (mu > 0), out, 0.0)
