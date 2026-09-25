# SS-8 · The Moon has real relief (part 1: lighting and shape)

Status: **in review** · Release 2 · 2026-09-25

As a learner, I want the Moon to have real relief, so that craters and mountains read as three-dimensional.

## Owner decisions

- **2026-09-25:** build it now, in two PRs. This one covers slope-based lighting and the displaced shape. The next adds cast shadows from horizon maps.
- **Combine every available source** (README). LOLA covers the whole Moon at this resolution. SLDEM2015 (LOLA with Kaguya, 59 m, ±60°) only adds detail beyond our 1.3 km map, so it belongs with streaming, SS-10.

## Source

LOLA gridded shape map `LDEM_64_FLOAT`, PDS data set `LRO-L-LOLA-4-GDR-V1.0`, pinned by SHA-256 in `pipeline/terrain.py`. From its label:

| | |
| --- | --- |
| Grid | 23040 × 11520, 32-bit float, 64 pixels/degree (474 m), pixel-registered |
| Projection | Simple cylindrical, `CENTER_LONGITUDE = 180` (column 0 at 0°E) |
| Longitude | `POSITIVE_LONGITUDE_DIRECTION = EAST`; latitude planetocentric |
| Values | Height in km above a 1737.4 km sphere (`PLANETARY_RADIUS = DN + OFFSET`, `OFFSET = 1737.4`) |
| Frame | "MEAN EARTH/POLAR AXIS OF DE421", the same frame as the albedo: no rotation between them |

## What ships

- **Normals, 4096 × 2048 (2.6 km per pixel):** the east and north components of the unit surface normal, as two lossy WebPs, 4.0 MB together.
  - Slopes come from central differences. Near the poles the east step widens so it is never shorter than the north step; without that, the last rows gave 89° "slopes".
  - Each component is stored as sign(c)·√|c|, which spends the 8 bits where lunar slopes are (median 3.3°, 99th percentile 19°, maximum 32°).
  - Quality chosen by measurement: the smallest whose mean angular error is at most a fifth of the median slope. q85 gives 0.60° mean error; linear 8-bit storage at 1.9 MB gave 1.26°, which would show as grain.
- **Height, 1024 × 512 (10.7 km per pixel):** metres + 32768 as 16 bits in a lossless WebP (red is the high byte, green the low), 0.67 MB. It drives displacement and the horizon.
- **Mesh:** 512 × 256 segments when relief is on (it was 256 × 128), displaced along the radius by the height, true scale.

## Lighting

- **Slopes:** Lommel–Seeliger uses the terrain normal for both μ0 and μ.
- **At full phase the relief vanishes by itself:** with sun and view aligned, I/F ≈ ϖ/8 whatever the slope. That is physics, not a fudge, and it is checked.
- **Past the terminator,** a point at height h sees the Sun until its depression reaches acos(R/(R+h)): high ground catches light, low ground does not. The edge is softened over the Sun's angular radius, 0.27°, using the IAU nominal solar radius.
- **No cast shadows yet.** A wall facing away from the Sun goes dark on its own, but a peak does not yet throw a shadow across the floor next to it. That is part 2.

## Ground truth

- **Chang'E-1 laser altimetry** (Li et al. 2010, a different mission and instrument), within 2 km of the published points:
  - Highest point (5.441°N, 158.656°W): LOLA +10.757 km, Chang'E-1 +10.629 km.
  - Lowest point (70.368°S, 172.413°W): LOLA −9.115 km, Chang'E-1 −9.178 km.
  - Test: they agree within 0.25 km.
- **IAU Gazetteer on the committed normals:**
  - Tycho's inner walls all face its centre: west wall east-facing, north wall south-facing, and so on.
  - The mirrored position shows no such wall.
  - Mare Crisium's floor lies more than 1 km below its rim.
- **Captures, machine-checked:**
  - `uniform-relief-full`: relief vanishes at full phase. 99.1% of disc pixels are within 2 levels of the smooth-sphere prediction; the requirement, set before the render, was 95%.
  - `uniform-relief-albategnius`: at first quarter the Sun is 7° up in the east, and Albategnius's west inner wall, which faces it, averages 74.7 against 57.5 for the east wall.
  - `uniform-relief-albategnius-flipped` (negative control, east-west flipped normals): fails, 40.1 against 83.9.
  - `moon-quarter` night side: every pixel more than 6.5° past the terminator is black. The margin is derived from the highest shipped height, 9.98 km, which sees the Sun until 6.14° below the smooth horizon, plus the Sun's radius. It is no longer 0.5°, because relief legitimately lights high ground past the terminator.
  - Heights are decoded exactly: the browser's sum of all 524,288 values must equal the pipeline's.
  - Every existing check is unchanged and passes. The smooth-sphere photometry views run with relief off, since they test the formula on a sphere.
- **`moon-albategnius`** is for eyes.

## Measurements

| | Value |
| --- | --- |
| Added download | 4.67 MB (normals 4.00, height 0.67) |
| Added GPU memory | 22.4 MB normals (RG8 with mips), 1 MB height (R16F) |
| Triangles | 262,144 (was 65,536) |

## Not verified

- **Anything on real hardware:** frame rate with the finer mesh and the extra texture, load time, memory on the iPhone.
- **Mipmaps average the square-root-encoded bytes,** not the normals themselves, so distant views are slightly biased towards flatter slopes. This is small; not measured.
- **A real photograph comparison of the terminator:** for eyes, once cast shadows land.

## Effort

Part of one session.
