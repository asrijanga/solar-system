// HTTP byte ranges: building a multi-range request and reading the answer. PDS serves several
// ranges in one request as multipart/byteranges (RFC 9110, section 14.6), which lets one
// request fetch a block of a map whose rows are far apart in the file.

/** Inclusive start, exclusive end. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

export function rangeHeader(ranges: readonly ByteRange[]): string {
  return `bytes=${ranges.map((r) => `${r.start}-${r.end - 1}`).join(',')}`;
}

/**
 * The bytes of each requested range, in request order. The server may answer a single range
 * with a plain 206 body, and may merge adjacent or overlapping ranges into one part; both are
 * handled by locating every requested range inside whichever part contains it.
 */
export function splitRanges(
  body: Uint8Array,
  contentType: string,
  contentRange: string | null,
  ranges: readonly ByteRange[],
): Uint8Array[] {
  const parts: { start: number; bytes: Uint8Array }[] = [];
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (boundary === null) {
    const match = /bytes (\d+)-(\d+)\//.exec(contentRange ?? '');
    if (match === null) throw new Error(`206 without Content-Range: ${contentType}`);
    parts.push({ start: Number(match[1]), bytes: body });
  } else {
    const text = new TextDecoder('latin1').decode(body);
    const marker = `--${(boundary[1] ?? boundary[2] ?? '').trim()}`;
    let at = text.indexOf(marker);
    while (at >= 0) {
      const headerEnd = text.indexOf('\r\n\r\n', at);
      if (headerEnd < 0) break;
      const header = text.slice(at, headerEnd);
      const match = /content-range:\s*bytes (\d+)-(\d+)\//i.exec(header);
      if (match === null) break;
      const start = Number(match[1]);
      const length = Number(match[2]) - start + 1;
      const dataStart = headerEnd + 4;
      parts.push({ start, bytes: body.subarray(dataStart, dataStart + length) });
      at = text.indexOf(marker, dataStart + length);
    }
  }
  return ranges.map((range) => {
    const part = parts.find((p) => p.start <= range.start && p.start + p.bytes.length >= range.end);
    if (part === undefined) throw new Error(`range ${range.start}-${range.end} missing from reply`);
    return part.bytes.subarray(range.start - part.start, range.end - part.start);
  });
}
