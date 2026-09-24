// Decodes the star binary written by pipeline/stars.py into render-ready typed arrays.
// Positions arrive as ICRF unit vectors and leave in scene axes; brightness and colour are
// derived here once, at load, never per frame.
import { icrfToScene } from './frames';
import { bvToLinearSrgb } from './starColour';

export const FLOATS_PER_STAR = 6;

export interface StarField {
  readonly count: number;
  /** Scene-frame unit vectors, 3 per star. */
  readonly directions: Float32Array;
  /** Flux relative to a magnitude-0 star: 10^(−0.4·V). */
  readonly flux: Float32Array;
  /** Linear sRGB of unit luminance, 3 per star. Neutral where B−V is missing. */
  readonly colours: Float32Array;
  readonly vmag: Float32Array;
  /** Harvard Revised numbers. */
  readonly hr: Float32Array;
}

/** Relative flux of magnitude m against magnitude 0 (Pogson's ratio). */
export const fluxOfMagnitude = (m: number): number => 10 ** (-0.4 * m);

export function decodeStars(buffer: ArrayBuffer): StarField {
  if (buffer.byteLength % (FLOATS_PER_STAR * 4) !== 0) {
    throw new Error(`star binary is ${buffer.byteLength} bytes, not a whole number of stars`);
  }
  const raw = new Float32Array(buffer);
  const count = raw.length / FLOATS_PER_STAR;
  const directions = new Float32Array(count * 3);
  const flux = new Float32Array(count);
  const colours = new Float32Array(count * 3);
  const vmag = new Float32Array(count);
  const hr = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_STAR;
    icrfToScene(raw[o] ?? 0, raw[o + 1] ?? 0, raw[o + 2] ?? 0, directions, i * 3);
    const v = raw[o + 3] ?? Number.NaN;
    vmag[i] = v;
    flux[i] = fluxOfMagnitude(v);
    const [r, g, b] = bvToLinearSrgb(raw[o + 4] ?? Number.NaN);
    colours[i * 3] = r;
    colours[i * 3 + 1] = g;
    colours[i * 3 + 2] = b;
    hr[i] = raw[o + 5] ?? 0;
  }
  return { count, directions, flux, colours, vmag, hr };
}
