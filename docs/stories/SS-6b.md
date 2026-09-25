# SS-6b · The Moon's poles from LOLA

Status: **in review** · Release 1 follow-up · 2026-09-25

As the director, I want the Moon's polar albedo from every available source, so that the polar gaps and the baked-in polar shading are replaced by real measurements.

## Owner decisions

- **2026-09-25:** replace Clementine poleward of about 70° with LOLA's laser albedo, calibrated where the two maps agree and blended across a band. Chosen over filling only the gaps (mismatched patches), keeping the gaps, or waiting for terrain. The evidence is in `SS-6.md`, "Can we fill the gaps from another source?", and `ss6b-south-pole-comparison.png`.
- **2026-09-25:** combine every available source for each world. Added to the README and `CLAUDE.md`; this story is the first application.

## Source

LOLA LDAM polar albedo, Lemelin et al. (2016). PDS data set `LRO-L-LOLA-4-GDR-V1.0`, products `LDAM_50S_1000M_FLOAT` and `LDAM_50N_1000M_FLOAT`, pinned by SHA-256 in `pipeline/lola_poles.py`. From the labels:

| | |
| --- | --- |
| Projection | Polar stereographic, spherical, R = 1737.4 km, 1000 m/pixel true at the pole, 2532 × 2532 |
| Origin | `LINE_PROJECTION_OFFSET` = `SAMPLE_PROJECTION_OFFSET` = 1265.5 |
| Latitude | Planetocentric |
| Longitude | `POSITIVE_LONGITUDE_DIRECTION = EAST` |
| Frame | "MEAN EARTH/POLAR AXIS OF DE421", the frame `MOON_ME` is aligned to |
| Values | 1064 nm normal albedo, 32-bit float, 0.15 to 0.58 |
| Coverage | 50° to the pole, complete: the publisher interpolated between laser ground tracks |

## Registration

The data set's `DSMAP_POLAR.CAT` contradicts itself. Its prose says longitude 90°E points right at both poles, with longitude 0 up in the south and down in the north. Its inverse formula flips the sample direction for the south. The prose was tested against the formula by correlating each with Clementine where the Sun is high enough for Clementine to be albedo-like:

| Orientation | r at 60–70°S |
| --- | --- |
| Prose (used) | 0.44 |
| Inverse formula | 0.24 |
| Other mirrors | −0.26, −0.23 |

At 50–60° the prose orientation gives r = 0.726 (south) and 0.766 (north). Sub-pixel offsets of ±0.5 and ±1 pixel all correlate lower, so the label's origin is exact. `pipeline/test_lola_poles.py` pins the orientation, origin and scale.

## Combination

- **Calibration:** Clementine value = gain · LOLA albedo + offset, least squares, per pole, over 50–60° where both are valid.
  - South: gain 200.4, offset −16.1, r 0.726, RMS residual 7.2 levels (1.86 million pixels).
  - North: gain 182.2, offset −11.1, r 0.766, RMS residual 7.0 levels.
- **Blend:** the weight rises with a smoothstep from 0 at |latitude| 65° to 1 at 75°. Where Clementine never imaged a point and the weight is above 0, calibrated LOLA is used alone: it is a measurement.
- **Equatorward of 65°** nothing changes. Clementine's gaps there stay gaps.

## Results

- **Missing surface: 0.886% → 0.059%.** 277,358 of Clementine's 297,275 missing pixels were measured by LOLA (250,168 south, 27,190 north). No gaps remain poleward of 65°.
- **Baked polar shading is gone** poleward of 75°: the sun-facing crater walls and black shadows of Clementine's low-sun pictures (`ss6b-south-pole-before-after.png`).
- **The blend leaves no step.** Row means change across 60–80° no more than 10 times the typical row-to-row change at low latitude, tested at both poles.
- **Gazetteer checks unchanged** (all features are equatorward of 50°); all pass.
- **Albedo scale re-derived:** 7.8826 → 7.9149 (+0.4%); the disc mean includes some polar area.

### Encoding

The pipeline's SS-5 rule (smallest WebP with albedo plus mask ≤ 6 MB and PSNR ≥ 40 dB over imaged pixels) now picks **q70: 0.70 MB**, down from q85 at 2.57 MB. Clementine's noisy polar shading had consumed most of the bits.

Because the smooth polar rows are about 28% of the equirectangular pixels, I checked that the average was not hiding a loss elsewhere. PSNR per region at q70: 40.10 dB for Clementine (|latitude| < 65°) and 41.65 dB for the poles. Both meet the rule.

Even so, a limb crop shows q70 slightly blockier than q85 in smooth maria. **This is for the owner:** keep the rule's q70 (0.70 MB), or raise the PSNR floor so q85 (1.40 MB, 42.2 dB in the Clementine region) is chosen.

## Costs, stated

- **The polar cap looks flatter.** Albedo alone carries little crater relief, and the relief visible before was mostly Clementine's baked shading, which was wrong under our sun anyway. True relief returns with terrain and shadows (a later story).
- **LOLA's ground tracks show** as faint radial stripes near each pole.
- **Resolution** poleward of 75° is LOLA's 1 km, against Clementine's nominal 118 m (already averaged to 1.33 km in our 8192-pixel map).
- **Wavelength:** LOLA is 1064 nm and Clementine 750 nm. The linear fit absorbs the average difference, but not compositional variation in the ratio (r ≈ 0.75, residual ≈ 7 levels).

## Checked by machine

- `pipeline:test`: 38 tests, including the LOLA orientation, the blend continuity, no polar gaps, and the recorded fits.
- Captures: every check passes. Changed baselines are listed in the PR with before and after.
- A new canonical view, `moon-south-pole` (over 80°S, unlit albedo), is for eyes.

## Not verified

- Polar appearance on the owner's device.
- Northern cap by eye: only the south-pole comparison image was inspected closely.

## Effort

Actual: part of one session.
