// Measured height grids held in memory, sampled bilinearly, and combined, for the website's
// terrain build (SS-10; formerly Region and Blend in pipeline/quantized_mesh.py). Heights come out in metres above
// the 1737.4 km sphere; NaN wherever a grid has no measurement.

/** A grid of km heights over part (or all) of the Moon, simple cylindrical. */
export class Grid {
  readonly latBottom: number;
  readonly lonEast: number;
  readonly km: Float32Array;
  readonly rows: number;
  readonly cols: number;
  readonly latTop: number;
  readonly lonWest: number;
  readonly ppd: number;
  /** Longitude wraps (a global grid): columns continue across 360 degrees. */
  readonly wraps: boolean;

  /**
   * `km` row-major from `latTop` down and `lonWest` east, pixel-registered: sample centres half
   * a pixel inside the edges. A grid whose samples sit on the grid lines is described by
   * moving its edges half a pixel out.
   */
  constructor(
    km: Float32Array,
    rows: number,
    cols: number,
    latTop: number,
    lonWest: number,
    ppd: number,
    wraps = false,
  ) {
    if (km.length !== rows * cols)
      throw new Error(`grid has ${km.length} samples, not ${rows} x ${cols}`);
    this.km = km;
    this.rows = rows;
    this.cols = cols;
    this.latTop = latTop;
    this.lonWest = lonWest;
    this.ppd = ppd;
    this.wraps = wraps;
    this.latBottom = latTop - rows / ppd;
    this.lonEast = lonWest + cols / ppd;
  }

  contains(west: number, south: number, east: number, north: number): boolean {
    if (this.wraps) return south >= this.latBottom && north <= this.latTop;
    return (
      west >= this.lonWest &&
      east <= this.lonEast &&
      south >= this.latBottom &&
      north <= this.latTop
    );
  }

  /** Bilinear, with edge rows and columns clamped as the Python original did. */
  heightM(lat: number, lon: number): number {
    const { rows, cols, km } = this;
    const row = (this.latTop - lat) * this.ppd - 0.5;
    const r0 = Math.min(Math.max(Math.floor(row), 0), rows - 2);
    const fr = Math.min(Math.max(row - r0, 0), 1);
    let c0: number;
    let c1: number;
    let fc: number;
    if (this.wraps) {
      const col = ((((lon - this.lonWest) % 360) + 360) % 360) * this.ppd - 0.5;
      const f = Math.floor(col);
      fc = col - f;
      c0 = ((f % cols) + cols) % cols;
      c1 = (c0 + 1) % cols;
    } else {
      const col = (lon - this.lonWest) * this.ppd - 0.5;
      c0 = Math.min(Math.max(Math.floor(col), 0), cols - 2);
      c1 = c0 + 1;
      fc = Math.min(Math.max(col - c0, 0), 1);
    }
    const a = km[r0 * cols + c0] ?? Number.NaN;
    const b = km[r0 * cols + c1] ?? Number.NaN;
    const c = km[(r0 + 1) * cols + c0] ?? Number.NaN;
    const d = km[(r0 + 1) * cols + c1] ?? Number.NaN;
    return (a * (1 - fc) * (1 - fr) + b * fc * (1 - fr) + c * (1 - fc) * fr + d * fc * fr) * 1000;
  }
}

export interface HeightField {
  contains(west: number, south: number, east: number, north: number): boolean;
  heightM(lat: number, lon: number): number;
}

/**
 * A finer grid over a box, blended into a base across a band at the box's edge. Inside the
 * box, `bandDeg` or more from its edge, heights are the fine grid's; at the edge and outside,
 * the base's; linear between. Where the fine grid has no measurement, the base's measurement
 * is used, never an interpolation across the hole.
 */
export class Blend implements HeightField {
  readonly fine: HeightField;
  readonly base: HeightField;
  readonly box: readonly [number, number, number, number];
  readonly bandDeg: number;

  constructor(
    fine: HeightField,
    base: HeightField,
    box: readonly [number, number, number, number],
    bandDeg: number,
  ) {
    this.fine = fine;
    this.base = base;
    this.box = box;
    this.bandDeg = bandDeg;
  }

  contains(west: number, south: number, east: number, north: number): boolean {
    return this.base.contains(west, south, east, north);
  }

  weight(lat: number, lon: number): number {
    const [w, s, e, n] = this.box;
    const inside = Math.min(lon - w, e - lon, lat - s, n - lat);
    return Math.min(Math.max(inside / this.bandDeg, 0), 1);
  }

  heightM(lat: number, lon: number): number {
    const base = this.base.heightM(lat, lon);
    const fine = this.fine.heightM(lat, lon);
    if (Number.isNaN(fine)) return base;
    return base + this.weight(lat, lon) * (fine - base);
  }
}

/** Mean over the n x n neighbourhood of every sample (n odd); edges repeat outwards. */
export function boxMean(values: Float32Array, rows: number, cols: number, n: number): Float32Array {
  const half = Math.floor(n / 2);
  const clampC = (c: number): number => Math.min(Math.max(c, 0), cols - 1);
  const clampR = (r: number): number => Math.min(Math.max(r, 0), rows - 1);
  // Horizontal pass, then vertical, each a running sum over clamped indices.
  const horizontal = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    let sum = 0;
    for (let k = -half; k <= half; k++) sum += values[r * cols + clampC(k)] ?? 0;
    for (let c = 0; c < cols; c++) {
      horizontal[r * cols + c] = sum;
      sum +=
        (values[r * cols + clampC(c + half + 1)] ?? 0) - (values[r * cols + clampC(c - half)] ?? 0);
    }
  }
  const out = new Float32Array(rows * cols);
  for (let c = 0; c < cols; c++) {
    let sum = 0;
    for (let k = -half; k <= half; k++) sum += horizontal[clampR(k) * cols + c] ?? 0;
    for (let r = 0; r < rows; r++) {
      out[r * cols + c] = sum / (n * n);
      sum +=
        (horizontal[clampR(r + half + 1) * cols + c] ?? 0) -
        (horizontal[clampR(r - half) * cols + c] ?? 0);
    }
  }
  return out;
}
