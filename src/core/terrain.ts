// Tile maths for the streamed terrain (SS-10): which level of detail was measured where,
// and how close that lets the camera come. Pure: no three.js.

/** A block of available tiles in one level of a quantized-mesh layer.json, inclusive. */
export interface TileRange {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
}

/** Vertex intervals along a tile edge: 65 x 65 vertices (pipeline/terrain_tiles.py). */
export const TILE_INTERVALS = 64;

/**
 * Vertex spacing along a meridian at `level`, km. Geographic TMS (EPSG:4326): level 0 is two
 * tiles of 180°, and each level halves the tile.
 */
export function vertexSpacingKm(level: number, radiusKm: number): number {
  return (Math.PI * radiusKm) / (TILE_INTERVALS * 2 ** level);
}

/**
 * The deepest level whose tiles cover a point, from layer.json's `available` (index = level,
 * TMS rows counted from the south). -1 where nothing covers it.
 */
export function finestLevelAt(
  available: readonly (readonly TileRange[])[],
  lonDeg: number,
  latDeg: number,
): number {
  const lon = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  const lat = Math.max(-90, Math.min(90, latDeg));
  for (let level = available.length - 1; level >= 0; level--) {
    const size = 180 / 2 ** level;
    const x = Math.min(Math.floor((lon + 180) / size), 2 ** (level + 1) - 1);
    const y = Math.min(Math.floor((lat + 90) / size), 2 ** level - 1);
    const ranges = available[level] ?? [];
    if (ranges.some((r) => x >= r.startX && x <= r.endX && y >= r.startY && y <= r.endY)) {
      return level;
    }
  }
  return -1;
}

/**
 * How many vertex spacings the view must span, at least, vertically. Closer than this the
 * screen would hold a few flat polygons: the measurement's limit, shown as nothing.
 */
export const MIN_SPACINGS_IN_VIEW = 40;

/**
 * The lowest altitude, km, at which a camera with vertical field `fovDeg` looking straight
 * down still sees MIN_SPACINGS_IN_VIEW vertex spacings of the finest data at its point.
 */
export function minAltitudeKm(
  available: readonly (readonly TileRange[])[],
  lonDeg: number,
  latDeg: number,
  radiusKm: number,
  fovDeg: number,
): number {
  const level = Math.max(finestLevelAt(available, lonDeg, latDeg), 0);
  const view = 2 * Math.tan((fovDeg * Math.PI) / 360);
  return (MIN_SPACINGS_IN_VIEW * vertexSpacingKm(level, radiusKm)) / view;
}
