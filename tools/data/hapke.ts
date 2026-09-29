// npm run pipeline:hapke
//
// The Moon's Hapke photometric parameters, per 1° tile, as LRO's Wide Angle Camera measured them
// (docs/stories/SS-8b.md), written to public/data/moon/hapke.bin and hapke.json.
//
// Source: WAC_HAPKEPARAMMAP_566NM (LRO-L-LROC-5-RDR, LROLRC_2001, product version v1.1), Sato,
// Robinson, Hapke, Denevi and Boyd (2014), "Resolved Hapke parameter maps of the Moon", JGR
// Planets 119, 1775-1805, doi:10.1002/2013JE004580. 566 nm is the WAC band nearest the V band
// the display's brightness is expressed in (core/photometry.ts).
//
// Conventions, from the product's attached PDS3 header and its PDS4 label: equirectangular,
// planetocentric, east-positive, sphere of 1737.4 km, 1 pixel per degree, 360 samples from 0°E
// and 140 lines from 70°N to 70°S; the centre of line 1, sample 1 is at 69.5°N, 0.5°E
// (LINE_PROJECTION_OFFSET 69.5, SAMPLE_PROJECTION_OFFSET -0.5). IEEE 754 little-endian 32-bit
// floats, band sequential, bands in the order w, b, c, Bc0, hc, Bs0, hs, theta, phi; missing
// value 0xFF7FFFFB.
//
// Where the image starts: the PDS3 header gives RECORD_BYTES = 1440, LABEL_RECORDS = 4 and
// ^IMAGE = 5, so byte 5760, and the file's size is exactly 5760 plus the image. The PDS4 label's
// Array_3D_Image offset says 1440; read from there, every band is shifted (w comes out with
// values of 1e33 and theta lands in the phi band). The header is followed.
//
// Output: 360 × 180 texels, row 0 at 89.5°N, column 0 at 0.5°E, texel centres on the source's
// tile centres. Two textures of half floats, back to back: RGBA = (w, b, c, Bs0), then
// RG = (hs, I/F at the map's standard geometry, i = 60, e = 0, g = 60). The 20 rows at each
// pole the product does not cover hold the median of every tile's parameters, and hapke.json
// says so.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchPinned } from './download.ts';
import { floatToHalf } from '../../src/core/half.ts';
import {
  HAPKE_ROUGHNESS_DEG,
  hapkeAtStandard,
  type HapkeParameters,
} from '../../src/core/hapke.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT_BIN = join(ROOT, 'public', 'data', 'moon', 'hapke.bin');
const OUT_JSON = join(ROOT, 'public', 'data', 'moon', 'hapke.json');

const URL =
  'https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/SDP/WAC_HAPKEPARAMMAP/WAC_HAPKEPARAMMAP_566NM.IMG';
const LABEL = URL.replace(/\.IMG$/, '.xml');
/** From the PDS4 label's md5_checksum; the SHA-256 is pinned here. */
const MD5 = '6d96176817e2b2b7e00d201d721669b5';
const SHA256 = '2868152f9c63b6887f68fa05bf671f425c335fe440988ebbc1bf7ed76ec71831';

const IMAGE_OFFSET = 5760;
const LINES = 140;
const SAMPLES = 360;
const BANDS = 9;
const MISSING = 0xff7ffffb;
const BAND = { w: 0, b: 1, c: 2, bc0: 3, hc: 4, bs0: 5, hs: 6, theta: 7, phi: 8 } as const;
/** Rows of the output: 180, of which the product fills 20 to 159. */
const ROWS = 180;
const FIRST_ROW = 20;

function median(values: Float64Array): number {
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? Number.NaN)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const round = (x: number, digits = 6): number => Number(x.toFixed(digits));

async function main(): Promise<void> {
  const path = await fetchPinned(URL, SHA256, 'wac_hapkeparammap_566nm.img');
  const file = readFileSync(path);
  const count = LINES * SAMPLES * BANDS;
  if (file.length !== IMAGE_OFFSET + count * 4) {
    throw new Error(`expected ${IMAGE_OFFSET + count * 4} bytes, got ${file.length}`);
  }
  const header = file.subarray(0, IMAGE_OFFSET).toString('latin1');
  for (const expected of ['RECORD_BYTES = 1440', 'LABEL_RECORDS = 4', '^IMAGE = 5']) {
    if (!header.replace(/ +/g, ' ').includes(expected)) {
      throw new Error(`PDS3 header lacks "${expected}"`);
    }
  }
  const view = new DataView(file.buffer, file.byteOffset + IMAGE_OFFSET, count * 4);
  const at = (band: number, line: number, sample: number): number => {
    const k = (band * LINES + line) * SAMPLES + sample;
    if (view.getUint32(k * 4, true) === MISSING) throw new Error(`missing value at ${k}`);
    return view.getFloat32(k * 4, true);
  };

  // The fixed parameters must be what the story's model assumes.
  const fixed = {
    bc0: new Set<number>(),
    hc: new Set<number>(),
    theta: new Set<number>(),
    phi: new Set<number>(),
  };
  const tiles = LINES * SAMPLES;
  const w = new Float64Array(tiles);
  const b = new Float64Array(tiles);
  const c = new Float64Array(tiles);
  const bs0 = new Float64Array(tiles);
  const hs = new Float64Array(tiles);
  for (let line = 0; line < LINES; line++) {
    for (let sample = 0; sample < SAMPLES; sample++) {
      const k = line * SAMPLES + sample;
      w[k] = at(BAND.w, line, sample);
      b[k] = at(BAND.b, line, sample);
      c[k] = at(BAND.c, line, sample);
      bs0[k] = at(BAND.bs0, line, sample);
      hs[k] = at(BAND.hs, line, sample);
      fixed.bc0.add(at(BAND.bc0, line, sample));
      fixed.hc.add(at(BAND.hc, line, sample));
      fixed.theta.add(round(at(BAND.theta, line, sample), 4));
      fixed.phi.add(at(BAND.phi, line, sample));
    }
  }
  const only = (s: Set<number>, name: string): number => {
    if (s.size !== 1) throw new Error(`${name} is not constant: ${[...s].join(', ')}`);
    return [...s][0] ?? Number.NaN;
  };
  const fixedValues = {
    bc0: only(fixed.bc0, 'Bc0'),
    hc: only(fixed.hc, 'hc'),
    thetaDeg: only(fixed.theta, 'theta'),
    phi: only(fixed.phi, 'phi'),
  };
  if (fixedValues.bc0 !== 0) throw new Error('the model assumes no coherent backscatter');
  if (fixedValues.thetaDeg !== HAPKE_ROUGHNESS_DEG) {
    throw new Error(`theta is ${fixedValues.thetaDeg}, core/hapke.ts has ${HAPKE_ROUGHNESS_DEG}`);
  }

  const medianParameters: HapkeParameters = {
    w: median(w),
    b: median(b),
    c: median(c),
    bs0: median(bs0),
    hs: median(hs),
  };
  const texels = SAMPLES * ROWS;
  const rgba = new Uint16Array(texels * 4);
  const rg = new Uint16Array(texels * 2);
  const standard = new Float64Array(tiles);
  for (let row = 0; row < ROWS; row++) {
    const line = row - FIRST_ROW;
    const measured = line >= 0 && line < LINES;
    for (let col = 0; col < SAMPLES; col++) {
      const k = line * SAMPLES + col;
      const p: HapkeParameters = measured
        ? { w: w[k] ?? 0, b: b[k] ?? 0, c: c[k] ?? 0, bs0: bs0[k] ?? 0, hs: hs[k] ?? 0 }
        : medianParameters;
      const atStandard = hapkeAtStandard(p);
      if (measured) standard[k] = atStandard;
      const t = row * SAMPLES + col;
      rgba[t * 4] = floatToHalf(p.w);
      rgba[t * 4 + 1] = floatToHalf(p.b);
      rgba[t * 4 + 2] = floatToHalf(p.c);
      rgba[t * 4 + 3] = floatToHalf(p.bs0);
      rg[t * 2] = floatToHalf(p.hs);
      rg[t * 2 + 1] = floatToHalf(atStandard);
    }
  }
  const bytes = new Uint8Array(rgba.byteLength + rg.byteLength);
  bytes.set(new Uint8Array(rgba.buffer), 0);
  bytes.set(new Uint8Array(rg.buffer), rgba.byteLength);
  writeFileSync(OUT_BIN, bytes);

  let zeroWidth = 0;
  for (const x of hs) if (x === 0) zeroWidth++;
  const manifest = {
    note: 'The Moon’s Hapke photometric parameters per 1° tile (docs/stories/SS-8b.md). Built by tools/data/hapke.ts.',
    product: {
      name: 'WAC_HAPKEPARAMMAP_566NM, LRO-L-LROC-5-RDR (LROLRC_2001), v1.1',
      url: URL,
      label: LABEL,
      md5: MD5,
      sha256: SHA256,
      citation:
        'Sato, H., Robinson, M.S., Hapke, B., Denevi, B.W., Boyd, A.K. (2014) Resolved Hapke parameter maps of the Moon. JGR Planets 119, 1775-1805. doi:10.1002/2013JE004580',
      wavelengthNm: 566,
      bandwidthNm: 20,
    },
    conventions:
      'equirectangular, planetocentric, east-positive, R = 1737.4 km, 1 px/deg, source 0-360E by 70N-70S with line 1 sample 1 centred at 69.5N 0.5E (PDS3 header LINE_PROJECTION_OFFSET 69.5, SAMPLE_PROJECTION_OFFSET -0.5)',
    imageOffset:
      'byte 5760, from the attached PDS3 header (RECORD_BYTES 1440, LABEL_RECORDS 4, ^IMAGE 5) and the file size; the PDS4 label says 1440, which misaligns every band',
    model:
      'Hapke (2012) as fitted by Sato et al. (2014): I/F = (w/4) mu0e/(mu0e+mue) [p(g) B_SH(g) + H(mu0e) H(mue) - 1] S, double Henyey-Greenstein p (b, c), B_SH = 1 + Bs0/(1 + tan(g/2)/hs), H in Hapke (2002) form, roughness theta per Hapke (1984), K = 1, no coherent backscatter (src/core/hapke.ts)',
    fixed: fixedValues,
    fixedNote:
      'The README says phi is fixed at 1.0; the archived band holds 0.0. K is 1 under either reading.',
    texture: {
      file: 'hapke.bin',
      width: SAMPLES,
      height: ROWS,
      layout:
        'half floats, little-endian: RGBA (w, b, c, Bs0) for all texels, then RG (hs, I/F at the map’s standard geometry i = 60, e = 0, g = 60, core/hapke.ts MAP_STANDARD_DEG); row 0 at 89.5N, column 0 at 0.5E',
    },
    poles: {
      rows: 'rows 0-19 (90N-70N) and 160-179 (70S-90S)',
      fill: 'median of each parameter over all 50,400 measured tiles; linear filtering blends it with the last measured row over 1 degree',
      why: 'the product ends at 70 degrees; the albedo there is still measured (LOLA, docs/stories/SS-6b.md), only how it scatters light with angle takes the Moon’s typical values',
    },
    median: Object.fromEntries(Object.entries(medianParameters).map(([k, v]) => [k, round(v)])),
    medianAtStandard: round(hapkeAtStandard(medianParameters)),
    standardRange: [round(Math.min(...standard)), round(Math.max(...standard))],
    tilesWithZeroSurgeWidth: zeroWidth,
    zeroSurgeWidthNote:
      'hs = 0 means the fitted surge is narrower than the data resolve: no surge outside zero phase. Kept as measured; the model floors hs at 1e-6 to stay finite.',
  };
  writeFileSync(OUT_JSON, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `wrote ${OUT_BIN} (${bytes.length} bytes); median ${JSON.stringify(manifest.median)}, at standard geometry ${manifest.medianAtStandard}`,
  );
}

await main();
