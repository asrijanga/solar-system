// Photometry: how bright a sunlit surface and a star are on screen, in one set of units.
//
// The display quantity is the radiance factor I/F (radiance over the radiance of a perfect
// white Lambert disc facing a sun at the same distance), scaled by the inverse square of the
// sun's distance in AU and by one exposure. A star uses the same exposure: its irradiance is
// expressed as the I/F an extended surface would need to put the same light into one pixel.
// Everything that changes exposure changes stars and surfaces together.

/** IAU 2012 Resolution B2: the astronomical unit, exactly, in km. */
export const AU_KM = 149_597_870.7;

/**
 * Apparent V magnitude of the Sun at 1 AU. NASA Sun Fact Sheet
 * (https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html): "Apparent visual magnitude
 * V(1,0) -26.74".
 */
export const SUN_V_MAGNITUDE = -26.74;

/**
 * The Moon's visual geometric albedo. NASA Moon Fact Sheet
 * (https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html): "Visual geometric albedo
 * 0.12". The Clementine map gives relative albedo only (docs/stories/SS-5.md); this is the
 * absolute scale it is calibrated to.
 */
export const MOON_GEOMETRIC_ALBEDO = 0.12;

/**
 * NASA Moon Fact Sheet, "Mean values at opposition from Earth": apparent visual magnitude
 * −12.74 at a distance of 378,000 km.
 */
export const MOON_OPPOSITION_MAGNITUDE = -12.74;
export const MOON_OPPOSITION_DISTANCE_KM = 378_000;

/**
 * Exposure: linear display value per unit I/F at 1 AU. Chosen once (docs/stories/SS-6.md).
 *
 * At exposure 1 a camera follows the "sunny 16" rule: an 18% grey card in sunlight displays
 * at 18% linear, photographic middle grey. The Moon is lit exactly as that card is, and
 * photographers expose it by the "looney 11" rule, one stop more, because at geometric albedo
 * 0.12 it is darker than the card: about as dark as worn asphalt. So the exposure is 2.
 * With it the brightest lunar highlands at any phase stay below display white, and nothing on
 * the Moon needs a tone curve.
 */
export const EXPOSURE = 2;

/**
 * Lommel–Seeliger radiance factor: I/F = (ϖ/4) · μ0 / (μ0 + μ), for single-scattering albedo
 * ϖ, μ0 the cosine of the incidence angle and μ the cosine of the emission angle. Zero where
 * the sun is below the horizon or the point faces away from the viewer.
 *
 * Unlike Lambert it has no darkening towards the limb at full phase: with μ0 = μ it is ϖ/8
 * everywhere on the disc, which is why a full Moon looks like a flat plate, not a ball.
 */
export function lommelSeeliger(albedo: number, mu0: number, mu: number): number {
  if (mu0 <= 0 || mu <= 0) return 0;
  return ((albedo / 4) * mu0) / (mu0 + mu);
}

/**
 * Lambert radiance factor: I/F = A · μ0. Not used to shade the Moon. It exists only for the
 * negative-control capture that proves the photometry check can tell the two apart.
 */
export function lambert(albedo: number, mu0: number, mu: number): number {
  if (mu0 <= 0 || mu <= 0) return 0;
  return albedo * mu0;
}

/**
 * Earth's geometric albedo. NASA Earth Fact Sheet
 * (https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html): "Geometric albedo 0.434".
 * Earth is drawn as a uniform Lambert sphere with it until its own round of the world recipe
 * gives it real surface, cloud and ocean data (docs/stories/SS-13b.md).
 */
export const EARTH_GEOMETRIC_ALBEDO = 0.434;

/**
 * Lambert albedo A for a uniform Lambert sphere of geometric albedo p. At zero phase the
 * disc's mean I/F is A times the mean of μ over the projected disc, which is 2/3, so A = 3p/2.
 */
export function lambertAlbedoFor(geometricAlbedo: number): number {
  return 1.5 * geometricAlbedo;
}

/**
 * Lommel–Seeliger ϖ for a surface of uniform albedo whose disc at zero phase has geometric
 * albedo p. At zero phase I/F = ϖ/8 at every point of the disc, and p is the disc's mean I/F
 * there, so ϖ = 8p. It exceeds 1 for p > 0.125: as used here ϖ is an effective parameter that
 * absorbs the opposition surge, not a physical single-scattering albedo (Hapke, SS-8b).
 */
export function lommelSeeligerAlbedoFor(geometricAlbedo: number): number {
  return 8 * geometricAlbedo;
}

/** Linear display value for a radiance factor, sun at `sunDistanceKm`. */
export function displayValue(radianceFactor: number, sunDistanceKm: number): number {
  const r = sunDistanceKm / AU_KM;
  return (EXPOSURE * radianceFactor) / (r * r);
}

/**
 * A star's integrated display value (linear display units times CSS pixels²) at physical
 * exposure, for a screen whose CSS pixels each subtend `pixelSolidAngleSr`.
 *
 * A surface with I/F = 1 has radiance F☉/π, where F☉ is the solar irradiance. A star of
 * magnitude m delivers irradiance F☉ · 10^(−0.4 (m − m☉)). Spread over pixels of solid angle
 * Ω, that is the radiance of I/F = π · 10^(−0.4 (m − m☉)) / Ω summed over the pixels it
 * covers. Stars are not sunlit, so the 1/r² factor does not apply.
 */
export function physicalStarExposure(pixelSolidAngleSr: number): number {
  return (EXPOSURE * Math.PI * 10 ** (-0.4 * (0 - SUN_V_MAGNITUDE))) / pixelSolidAngleSr;
}

/** Solid angle of one CSS pixel at the centre of a perspective view. */
export function pixelSolidAngle(verticalFovDeg: number, heightCssPx: number): number {
  const side = (2 * Math.tan((verticalFovDeg * Math.PI) / 360)) / heightCssPx;
  return side * side;
}

/**
 * Apparent magnitude of a sphere of geometric albedo p and radius R (km), seen at zero phase
 * from `observerDistanceKm`, with the sun at `sunDistanceAu` from both. The definition of
 * geometric albedo, used here to check the constants against the fact sheet's −12.74.
 */
export function zeroPhaseMagnitude(
  geometricAlbedo: number,
  radiusKm: number,
  observerDistanceKm: number,
  sunDistanceAu = 1,
): number {
  const ratio = (radiusKm / observerDistanceKm) ** 2;
  return SUN_V_MAGNITUDE - 2.5 * Math.log10((geometricAlbedo * ratio) / sunDistanceAu ** 2);
}

/** IEC 61966-2-1 sRGB transfer function: linear [0, 1] to encoded [0, 1], clamped. */
export function linearToSrgb(linear: number): number {
  const x = Math.min(1, Math.max(0, linear));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}
