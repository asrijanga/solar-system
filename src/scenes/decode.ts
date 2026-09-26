/**
 * Decodes chosen 8-bit channels of an image, in strips so that no full-size RGBA copy
 * (128 MB at 8192 x 4096) ever exists next to the bitmap. The images are untagged and colour
 * conversion is off, so the bytes are the file's values. Channel 0 is red.
 */
export async function decodeChannels(
  url: string,
  width: number,
  height: number,
  channels: readonly number[],
): Promise<Uint8Array[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed to load: HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  try {
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new Error(
        `${url} is ${bitmap.width}x${bitmap.height}, manifest says ${width}x${height}`,
      );
    }
    const strip = 256;
    const canvas = new OffscreenCanvas(width, strip);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('no 2D context to decode textures');
    context.imageSmoothingEnabled = false;
    const outs = channels.map(() => new Uint8Array(width * height));
    for (let y = 0; y < height; y += strip) {
      const rows = Math.min(strip, height - y);
      context.clearRect(0, 0, width, strip);
      context.drawImage(bitmap, 0, y, width, rows, 0, 0, width, rows);
      const rgba = context.getImageData(0, 0, width, rows).data;
      const offset = y * width;
      channels.forEach((channel, k) => {
        const out = outs[k] as Uint8Array;
        for (let i = 0, n = width * rows; i < n; i++) out[offset + i] = rgba[i * 4 + channel] ?? 0;
      });
    }
    return outs;
  } finally {
    bitmap.close();
  }
}
