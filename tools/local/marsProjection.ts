// Map projections of Mars's projected elevation products (docs/stories/SS-14.md, W5): HRSC
// stereo strips (sinusoidal, or stereographic at the poles), HiRISE DTMs (equirectangular, or
// polar stereographic), and MOLA's polar MEGDR grids. Each file's own PDS label gives the
// parameters; the formulas are the spherical ones of Snyder (1987) that the labels cite.
//
// Pixel convention, the same for HRSC and HiRISE and checked against GDAL's PDS driver
// (test/fixtures/mars-local-projections.json): rows and columns 0-based with pixel centres on
// whole numbers, col = SAMPLE_PROJECTION_OFFSET + x / scale, row = LINE_PROJECTION_OFFSET - y / scale.

const RAD = Math.PI / 180;

/** A PDS3 label's keys and their raw values (the first occurrence of each). */
export type Label = ReadonlyMap<string, string>;

/** Reads `KEY = value` pairs from a PDS3 label up to its END line. Multi-line values are skipped. */
export function parseLabel(text: string): Label {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*END\s*$/.test(line)) break;
    const match = /^\s*(\^?[A-Z0-9_:]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null) continue;
    const [, key, value] = match as unknown as [string, string, string];
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

/** A label value as a number, in the unit the caller wants: `<km>` and `<METERS/PIXEL>` aware. */
export function labelNumber(label: Label, key: string, unit: 'km' | 'm' | 'none' = 'none'): number {
  const raw = label.get(key);
  if (raw === undefined) throw new Error(`label has no ${key}`);
  const match = /^"?\s*([-+0-9.eE]+)\s*"?\s*(?:<([^>]*)>)?/.exec(raw);
  if (match === null) throw new Error(`${key} = ${raw} is not a number`);
  const value = Number(match[1]);
  const given = (match[2] ?? '').toUpperCase();
  if (unit === 'none' || given === '') return value;
  const inMetres = given.startsWith('KM') ? value * 1000 : value;
  return unit === 'm' ? inMetres : inMetres / 1000;
}

export interface Projection {
  /** Fractional (row, col) of a point, or null where the projection cannot place it. */
  toPixel(latDeg: number, lonDeg: number): { row: number; col: number } | null;
}

/** Longitude difference wrapped to [-180, 180). */
function dLon(lonDeg: number, centreDeg: number): number {
  return ((((lonDeg - centreDeg) % 360) + 540) % 360) - 180;
}

/** The projection a label describes. */
export function projectionOf(label: Label): Projection {
  const type = (label.get('MAP_PROJECTION_TYPE') ?? '').replace(/"/g, '').trim();
  // HRSC gives MAP_SCALE in km/pixel, HiRISE in m/pixel: the unit says which.
  const scale = labelNumber(label, 'MAP_SCALE', 'm');
  // The projection's sphere is the one its own scale and resolution imply: scale x pixels per
  // degree x 180 / pi. That is A_AXIS_RADIUS for HRSC and HiRISE's equirectangular DTMs, but
  // the polar radius (C_AXIS_RADIUS, 3376.2 km) for HiRISE's polar stereographic ones, whose
  // labels give the full ellipsoid; GDAL agrees (test/fixtures/mars-local-projections.json).
  const radius = label.has('MAP_RESOLUTION')
    ? (scale * labelNumber(label, 'MAP_RESOLUTION') * 180) / Math.PI
    : labelNumber(label, 'A_AXIS_RADIUS', 'm');
  const lineOffset = labelNumber(label, 'LINE_PROJECTION_OFFSET');
  const sampleOffset = labelNumber(label, 'SAMPLE_PROJECTION_OFFSET');
  const centreLat = labelNumber(label, 'CENTER_LATITUDE');
  const centreLon = labelNumber(label, 'CENTER_LONGITUDE');
  const pixel = (x: number, y: number) => ({
    row: lineOffset - y / scale,
    col: sampleOffset + x / scale,
  });
  if (type === 'SINUSOIDAL') {
    return {
      toPixel: (lat, lon) =>
        pixel(radius * dLon(lon, centreLon) * RAD * Math.cos(lat * RAD), radius * lat * RAD),
    };
  }
  if (type === 'EQUIRECTANGULAR') {
    const cosStandard = Math.cos(centreLat * RAD);
    return {
      toPixel: (lat, lon) =>
        pixel(radius * dLon(lon, centreLon) * RAD * cosStandard, radius * lat * RAD),
    };
  }
  if (type === 'STEREOGRAPHIC' || type === 'POLAR STEREOGRAPHIC') {
    if (Math.abs(centreLat) !== 90)
      throw new Error(`stereographic centred at ${centreLat}: not polar`);
    const north = centreLat > 0;
    // True scale at the pole (GDAL: +lat_ts=+-90): rho = 2 R tan(45 deg -+ lat / 2).
    return {
      toPixel: (lat, lon) => {
        if (north ? lat <= -90 : lat >= 90) return null;
        const rho = 2 * radius * Math.tan((90 - (north ? lat : -lat)) * 0.5 * RAD);
        const t = dLon(lon, centreLon) * RAD;
        return pixel(rho * Math.sin(t), (north ? -1 : 1) * rho * Math.cos(t));
      },
    };
  }
  throw new Error(`unsupported projection ${type}`);
}

/**
 * MOLA's polar MEGDR grids (DSMAP_POLAR.CAT): N x N, MAP_RESOLUTION pixels per degree at the
 * pole, R = (360 / pi) tan((90 - |lat|) / 2) in degrees. Longitude 0 points down the grid in the
 * north and up in the south, as the catalogue's text says; measured 2026-10-03 against the
 * cylindrical MEGDR (median 2.5 m north and 2.0 m south, against 352 m and 704 m the other way).
 */
export function molaPolar(north: boolean, n: number, ppd: number): Projection {
  return {
    toPixel: (lat, lon) => {
      if (north ? lat <= 0 : lat >= 0) return null;
      const r = (360 / Math.PI) * Math.tan((90 - Math.abs(lat)) * 0.5 * RAD);
      const x = r * Math.sin(lon * RAD);
      const y = (north ? 1 : -1) * r * Math.cos(lon * RAD);
      return { row: y * ppd + n / 2 - 0.5, col: x * ppd + n / 2 - 0.5 };
    },
  };
}
