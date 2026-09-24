// The scene's unit of length is the kilometre, everywhere (README, "Decisions to lock").
// SPICE works in km, and km are readable in overlays and test failures. Convert at the
// edges with these constants; never scatter bare 1000s through the code.

/** One kilometre, in scene units. */
export const KM = 1;
/** One metre, in scene units. */
export const METRE = KM / 1000;
