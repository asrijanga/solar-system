// npm run pipeline:landmarks
//
// The Moon's popular landmarks for labels (docs/stories/SS-15.md), taken from the IAU Gazetteer
// of Planetary Nomenclature: names, centres and diameters exactly as the Gazetteer gives them.
// Nothing here is typed in by hand except which features to show and, for landing sites, which
// mission to name; the script checks every mission against the Gazetteer's own "origin" note.
//
// Conventions, from the file's own metadata (metadata_nomenclature_points_MOON.xml and .prj):
// planetocentric latitude, longitude positive east 0 to 360, sphere of radius 1737400 m,
// datum "Moon 2000". The output converts longitude to -180 to 180, as the texture uses.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fetchPinned } from './download.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'public', 'data', 'moon', 'landmarks.json');
const URL =
  'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip';
// Pinned 2026-09-26. The Gazetteer is updated in place; test/fixtures/iau-gazetteer-moon.json
// pinned an earlier release (2026-09-24), and test/landmarks.test.ts checks the two agree on
// every feature they share.
const SHA256 = '404a951d514821590f244c1858d9dc15e64f9e93e2cde45e35e9cf413fc60fea';
const DBF = 'MOON_nomenclature_center_pts.dbf';

type Kind = 'crater' | 'mare' | 'mountains' | 'valley' | 'landing';

/** Which features to label: the Gazetteer name, what kind it is, and for a landing site the mission. */
const CHOSEN: readonly (readonly [string, Kind, string?])[] = [
  // Maria.
  ['Oceanus Procellarum', 'mare'],
  ['Mare Imbrium', 'mare'],
  ['Mare Serenitatis', 'mare'],
  ['Mare Tranquillitatis', 'mare'],
  ['Mare Crisium', 'mare'],
  ['Mare Fecunditatis', 'mare'],
  ['Mare Nectaris', 'mare'],
  ['Mare Nubium', 'mare'],
  ['Mare Humorum', 'mare'],
  ['Mare Frigoris', 'mare'],
  ['Mare Vaporum', 'mare'],
  ['Sinus Medii', 'mare'],
  ['Sinus Iridum', 'mare'],
  ['Mare Orientale', 'mare'],
  ['Mare Moscoviense', 'mare'],
  // Craters.
  ['Tycho', 'crater'],
  ['Copernicus', 'crater'],
  ['Kepler', 'crater'],
  ['Aristarchus', 'crater'],
  ['Plato', 'crater'],
  ['Archimedes', 'crater'],
  ['Eratosthenes', 'crater'],
  ['Ptolemaeus', 'crater'],
  ['Alphonsus', 'crater'],
  ['Arzachel', 'crater'],
  ['Albategnius', 'crater'],
  ['Hipparchus', 'crater'],
  ['Theophilus', 'crater'],
  ['Cyrillus', 'crater'],
  ['Catharina', 'crater'],
  ['Clavius', 'crater'],
  ['Grimaldi', 'crater'],
  ['Langrenus', 'crater'],
  ['Petavius', 'crater'],
  ['Posidonius', 'crater'],
  ['Cassini', 'crater'],
  ['Autolycus', 'crater'],
  ['Aristillus', 'crater'],
  ['Gassendi', 'crater'],
  ['Tsiolkovskiy', 'crater'],
  ['Korolev', 'crater'],
  ['Hertzsprung', 'crater'],
  ['Apollo', 'crater'],
  ['Shackleton', 'crater'],
  ['Von Kármán', 'crater'],
  // Mountains and valleys.
  ['Montes Apenninus', 'mountains'],
  ['Montes Alpes', 'mountains'],
  ['Montes Caucasus', 'mountains'],
  ['Vallis Alpes', 'valley'],
  ['Vallis Schröteri', 'valley'],
  ['Rima Hadley', 'valley'],
  ['Rupes Recta', 'valley'],
  // Landing sites, with the mission as the Gazetteer's origin note names it.
  ['Statio Tranquillitatis', 'landing', 'Apollo 11'],
  ['Surveyor', 'landing', 'Apollo 12'],
  ['Cone', 'landing', 'Apollo 14'],
  ['Apennine Front', 'landing', 'Apollo 15'],
  ['North Ray', 'landing', 'Apollo 16'],
  ['Taurus-Littrow Valley', 'landing', 'Apollo 17'],
  ['Guang Han Gong', 'landing', 'Chang’e-3'],
  ['Statio Tianhe', 'landing', 'Chang’e-4'],
  ['Statio Tianchuan', 'landing', 'Chang’e-5'],
];

/** The bytes of one file inside a zip archive (stored or deflated). */
export function unzipEntry(zip: Uint8Array, name: string): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory: the last record with signature 0x06054b50.
  let end = zip.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip archive');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('bad central directory');
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const entry = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    if (entry === name) {
      const start =
        local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = zip.subarray(start, start + compressed);
      if (method === 0) return data;
      if (method === 8) return new Uint8Array(inflateRawSync(data));
      throw new Error(`${name}: unsupported zip method ${method}`);
    }
    at += 46 + nameLength + extra + comment;
  }
  throw new Error(`${name} is not in the archive`);
}

/** Records of a dBASE III table, every field as trimmed text. */
export function readDbf(bytes: Uint8Array): Record<string, string>[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const decoder = new TextDecoder('utf-8');
  const fields: { name: string; length: number }[] = [];
  for (let at = 32; bytes[at] !== 0x0d; at += 32) {
    const raw = bytes.subarray(at, at + 11);
    const zero = raw.indexOf(0);
    fields.push({
      name: decoder.decode(zero < 0 ? raw : raw.subarray(0, zero)),
      length: bytes[at + 16] ?? 0,
    });
  }
  const out: Record<string, string>[] = [];
  for (let r = 0; r < records; r++) {
    const base = headerLength + r * recordLength;
    if (bytes[base] === 0x2a) continue; // deleted
    let at = base + 1;
    const record: Record<string, string> = {};
    for (const { name, length } of fields) {
      record[name] = decoder.decode(bytes.subarray(at, at + length)).trim();
      at += length;
    }
    out.push(record);
  }
  return out;
}

export interface Landmark {
  readonly name: string;
  readonly label: string;
  readonly kind: Kind;
  readonly lonDeg: number;
  readonly latDeg: number;
  readonly diameterKm: number;
  readonly gazetteer: string;
}

export function choose(records: readonly Record<string, string>[]): Landmark[] {
  const byName = new Map(records.map((r) => [r['name'] ?? '', r]));
  return CHOSEN.map(([name, kind, mission]) => {
    const r = byName.get(name);
    if (r === undefined) throw new Error(`${name} is not in the Gazetteer`);
    // The Gazetteer writes Chang’e with a curly or straight apostrophe; compare without either.
    const bare = (text: string): string => text.replace(/[’']/g, '');
    if (mission !== undefined && !bare(r['origin'] ?? '').includes(bare(mission))) {
      throw new Error(`${name}: the Gazetteer's origin does not name ${mission}: ${r['origin']}`);
    }
    const lonEast = Number(r['center_lon']);
    const label =
      name === 'Statio Tranquillitatis'
        ? 'Tranquility Base · Apollo 11'
        : mission === undefined
          ? name
          : `${name} · ${mission}`;
    return {
      name,
      label,
      kind,
      lonDeg: lonEast > 180 ? lonEast - 360 : lonEast,
      latDeg: Number(r['center_lat']),
      diameterKm: Number(r['diameter']),
      gazetteer: (r['link'] ?? '').replace('http://', 'https://'),
    };
  });
}

if (import.meta.main) {
  const zip = new Uint8Array(readFileSync(await fetchPinned(URL, SHA256, 'moon-nomenclature.zip')));
  const landmarks = choose(readDbf(unzipEntry(zip, DBF)));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        source:
          'Gazetteer of Planetary Nomenclature (IAU WGPSN / USGS), MOON_nomenclature_center_pts',
        url: URL,
        sha256: SHA256,
        retrieved: '2026-09-26',
        conventions:
          'planetocentric latitude; longitude east-positive, converted from 0-360 to -180-180; sphere R = 1737.4 km; datum Moon 2000 (the file metadata)',
        script: 'tools/data/landmarks.ts',
        landmarks,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`${landmarks.length} landmarks written to ${OUT}`);
}
