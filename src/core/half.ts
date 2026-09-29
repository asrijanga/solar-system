// IEEE 754 binary16 ("half") encoding. The Hapke parameter texture is half floats because
// WebGPU filters rgba16float linearly on every adapter, and rgba32float only with an optional
// feature (docs/stories/SS-8b.md).

const scratch = new DataView(new ArrayBuffer(4));

/** The nearest binary16 to x, ties to even, as its 16-bit pattern. */
export function floatToHalf(x: number): number {
  scratch.setFloat32(0, x);
  const bits = scratch.getUint32(0);
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  const mantissa = bits & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa !== 0 ? 0x200 : 0);
  const e = exponent - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    // Subnormal: shift the implicit bit in, round to nearest even.
    const m = mantissa | 0x800000;
    const shift = 14 - e;
    const half = 1 << (shift - 1);
    const rest = m & ((1 << shift) - 1);
    let out = m >>> shift;
    if (rest > half || (rest === half && (out & 1) === 1)) out++;
    return sign | out;
  }
  let out = (e << 10) | (mantissa >>> 13);
  const rest = mantissa & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (out & 1) === 1)) out++;
  return sign | out;
}

/** The number a binary16 bit pattern stands for. */
export function halfToFloat(h: number): number {
  const sign = (h & 0x8000) !== 0 ? -1 : 1;
  const exponent = (h >>> 10) & 0x1f;
  const mantissa = h & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa !== 0 ? Number.NaN : sign * Infinity;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}
