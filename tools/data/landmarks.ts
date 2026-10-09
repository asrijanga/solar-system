// npm run pipeline:landmarks          (the Moon)
// npm run pipeline:landmarks:mars     (Mars, docs/stories/SS-14.md W7)
// npm run pipeline:landmarks:mercury  (Mercury, docs/stories/SS-16.md W7)
//
// A world's popular landmarks for labels (docs/stories/SS-15.md), taken from the IAU Gazetteer
// of Planetary Nomenclature: names, centres and diameters exactly as the Gazetteer gives them.
// Nothing here is typed in by hand except which features to show and, for landing sites, which
// mission to name; the script checks every mission against the Gazetteer's own "origin" note.
//
// Conventions, from each file's own metadata (metadata_nomenclature_points_<WORLD>.xml and .prj):
// - The Moon: planetocentric latitude, longitude positive east 0 to 360, sphere of radius
//   1737400 m, datum "Moon 2000".
// - Mars: "<lattype>Planetocentric", "<londir>Positive East", 0 to 360; the .prj names
//   GCS_Mars_2000 on the Mars_2000_IAU_IAG spheroid, 3396190 m.
// - Mercury: the .prj names GCS_Mercury_2000 on the Mercury_2000_IAU_IAG sphere, 2439700 m. Its
//   metadata XML says "<lattype>Planetographic" and "<londir>Positive West", but the records are
//   east-positive, 0 to 360: Hokusai at 16.65, Kuiper at 328.68 and Debussy at 12.54 are bright
//   rayed craters in the MDIS albedo (W3) at those east longitudes and not at the west ones
//   (checked 2026-10-09, SS-16 W7). On a sphere planetographic and planetocentric latitude agree.
// The output converts longitude to -180 to 180, as the textures use.
//
// Mars's Gazetteer has no landing-site features, and none of its origin notes names a mission
// (searched 2026-10-03). So Mars's labels name the features the landers came down in under their
// Gazetteer names, and no mission: a mission name would be typed in by hand, unchecked.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fetchPinned } from './download.ts';

const ROOT = join(import.meta.dirname, '..', '..');

type Kind = 'crater' | 'mare' | 'mountains' | 'valley' | 'landing';

/** Which features to label: the Gazetteer name, what kind it is, and for a landing site the mission. */
type Chosen = readonly (readonly [string, Kind, string?])[];

const MOON_CHOSEN: Chosen = [
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

/**
 * Mars. Kinds reuse the Moon's label styles: 'mare' (italic) for the great plains, plateaus and
 * highlands, 'mountains' for volcanoes, 'valley' for canyons and channels.
 */
const MARS_CHOSEN: Chosen = [
  // Volcanoes.
  ['Olympus Mons', 'mountains'],
  ['Arsia Mons', 'mountains'],
  ['Pavonis Mons', 'mountains'],
  ['Ascraeus Mons', 'mountains'],
  ['Alba Mons', 'mountains'],
  ['Elysium Mons', 'mountains'],
  ['Hecates Tholus', 'mountains'],
  ['Apollinaris Mons', 'mountains'],
  ['Hadriacus Mons', 'mountains'],
  ['Tharsis Montes', 'mountains'],
  ['Aeolis Mons', 'mountains'],
  // Canyons and channels.
  ['Valles Marineris', 'valley'],
  ['Noctis Labyrinthus', 'valley'],
  ['Candor Chasma', 'valley'],
  ['Ophir Chasma', 'valley'],
  ['Melas Chasma', 'valley'],
  ['Coprates Chasma', 'valley'],
  ['Ius Chasma', 'valley'],
  ['Kasei Valles', 'valley'],
  ['Ares Vallis', 'valley'],
  ['Mawrth Vallis', 'valley'],
  // Plains, plateaus and highlands.
  ['Hellas Planitia', 'mare'],
  ['Argyre Planitia', 'mare'],
  ['Isidis Planitia', 'mare'],
  ['Utopia Planitia', 'mare'],
  ['Chryse Planitia', 'mare'],
  ['Acidalia Planitia', 'mare'],
  ['Amazonis Planitia', 'mare'],
  ['Arcadia Planitia', 'mare'],
  ['Elysium Planitia', 'mare'],
  ['Vastitas Borealis', 'mare'],
  ['Syrtis Major Planum', 'mare'],
  ['Meridiani Planum', 'mare'],
  ['Lunae Planum', 'mare'],
  ['Solis Planum', 'mare'],
  ['Syria Planum', 'mare'],
  ['Hesperia Planum', 'mare'],
  ['Malea Planum', 'mare'],
  ['Planum Boreum', 'mare'],
  ['Planum Australe', 'mare'],
  ['Arabia Terra', 'mare'],
  ['Noachis Terra', 'mare'],
  ['Terra Cimmeria', 'mare'],
  ['Terra Sirenum', 'mare'],
  ['Tempe Terra', 'mare'],
  ['Promethei Terra', 'mare'],
  // Craters, among them the ones Curiosity (Gale), Perseverance (Jezero) and Spirit (Gusev) came
  // down in, and Endeavour, which Opportunity explored. Labelled by Gazetteer name only (above).
  ['Gale', 'crater'],
  ['Jezero', 'crater'],
  ['Gusev', 'crater'],
  ['Endeavour', 'crater'],
  ['Eberswalde', 'crater'],
  ['Holden', 'crater'],
  ['Huygens', 'crater'],
  ['Schiaparelli', 'crater'],
  ['Cassini', 'crater'],
  ['Antoniadi', 'crater'],
  ['Herschel', 'crater'],
  ['Newton', 'crater'],
  ['Lyot', 'crater'],
  ['Korolev', 'crater'],
  // Near the terminator on 26 January 2026: the relief check's crater (src/capture/viewpoints.ts).
  ['Teisserenc de Bort', 'crater'],
];

/**
 * Mercury. Kinds reuse the label styles: 'mare' for the great plains, 'mountains' for Caloris
 * Montes, 'valley' for the scarps (rupēs) and fossae.
 */
const MERCURY_CHOSEN: Chosen = [
  // Plains.
  ['Borealis Planitia', 'mare'],
  ['Caloris Planitia', 'mare'],
  ['Stilbon Planitia', 'mare'],
  ['Sobkou Planitia', 'mare'],
  ['Budh Planitia', 'mare'],
  ['Tir Planitia', 'mare'],
  ['Caloris Montes', 'mountains'],
  // Scarps and troughs.
  ['Enterprise Rupes', 'valley'],
  ['Discovery Rupes', 'valley'],
  ['Carnegie Rupes', 'valley'],
  ['Beagle Rupes', 'valley'],
  ['Victoria Rupes', 'valley'],
  ['Altair Rupes', 'valley'],
  ['Pantheon Fossae', 'valley'],
  // Basins and large craters.
  ['Rembrandt', 'crater'],
  ['Beethoven', 'crater'],
  ['Tolstoj', 'crater'],
  ['Rachmaninoff', 'crater'],
  ['Raditladi', 'crater'],
  ['Mendelssohn', 'crater'],
  ['Shakespeare', 'crater'],
  ['Dostoevskij', 'crater'],
  ['Goethe', 'crater'],
  ['Homer', 'crater'],
  ['Vivaldi', 'crater'],
  ['Bach', 'crater'],
  ['Mozart', 'crater'],
  ['Sanai', 'crater'],
  ['Raphael', 'crater'],
  ['Haydn', 'crater'],
  ['Praxiteles', 'crater'],
  // Bright rayed craters.
  ['Hokusai', 'crater'],
  ['Debussy', 'crater'],
  ['Kuiper', 'crater'],
  ['Degas', 'crater'],
  ['Bashō', 'crater'],
  // Hun Kal: the small crater whose centre defines 20° W, Mercury's longitude reference.
  ['Hun Kal', 'crater'],
  // Polar craters with permanently shadowed floors.
  ['Prokofiev', 'crater'],
  ['Chao Meng-Fu', 'crater'],
  // Others often pictured.
  ['Kandinsky', 'crater'],
  ['Calvino', 'crater'],
  ['Eminescu', 'crater'],
  ['Abedin', 'crater'],
  ['Xiao Zhao', 'crater'],
];

/** Where each world's Gazetteer file is, pinned, and what to label. */
const WORLDS = {
  moon: {
    url: 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip',
    // Pinned 2026-09-26. The Gazetteer is updated in place; test/fixtures/iau-gazetteer-moon.json
    // pinned an earlier release (2026-09-24), and test/landmarks.test.ts checks the two agree on
    // every feature they share.
    sha256: '404a951d514821590f244c1858d9dc15e64f9e93e2cde45e35e9cf413fc60fea',
    retrieved: '2026-09-26',
    dbf: 'MOON_nomenclature_center_pts.dbf',
    cacheName: 'moon-nomenclature.zip',
    chosen: MOON_CHOSEN,
    source: 'Gazetteer of Planetary Nomenclature (IAU WGPSN / USGS), MOON_nomenclature_center_pts',
    conventions:
      'planetocentric latitude; longitude east-positive, converted from 0-360 to -180-180; sphere R = 1737.4 km; datum Moon 2000 (the file metadata)',
  },
  mars: {
    url: 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.zip',
    // Pinned 2026-10-03. test/fixtures/iau-gazetteer-mars.json pinned an earlier release
    // (2026-09-29); test/landmarks.test.ts checks the two agree on every feature they share.
    sha256: '5faab9136a1e55f0e544286271c9cbff36677e35ea84368ed5cb858f335bce9c',
    retrieved: '2026-10-03',
    dbf: 'MARS_nomenclature_center_pts.dbf',
    cacheName: 'mars-nomenclature-2026-10-03.zip',
    chosen: MARS_CHOSEN,
    source: 'Gazetteer of Planetary Nomenclature (IAU WGPSN / USGS), MARS_nomenclature_center_pts',
    conventions:
      'planetocentric latitude; longitude east-positive, converted from 0-360 to -180-180; GCS_Mars_2000, Mars_2000_IAU_IAG spheroid, 3396.19 km (the file metadata and .prj). No mission names: the Mars Gazetteer has no landing-site features and its notes name no mission',
  },
  mercury: {
    url: 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MERCURY_nomenclature_center_pts.zip',
    // Pinned 2026-10-09. The bucket rebuilds its zips in place (SS-14 W8), so a later run may need
    // a new pin; landmarks.json keeps every record used.
    sha256: '78af6ff8e25457ee9c497031fd37e9b21cc2dd3d85c1e27bf9eac1f8c2b2856c',
    retrieved: '2026-10-09',
    dbf: 'MERCURY_nomenclature_center_pts.dbf',
    cacheName: 'mercury-nomenclature-2026-10-09.zip',
    chosen: MERCURY_CHOSEN,
    source:
      'Gazetteer of Planetary Nomenclature (IAU WGPSN / USGS), MERCURY_nomenclature_center_pts',
    conventions:
      'latitude on the 2439.7 km sphere (GCS_Mercury_2000, the .prj); longitude east-positive in the records, 0-360, converted to -180-180, though the metadata XML says positive west: checked against the MDIS albedo (tools/data/landmarks.ts)',
  },
} as const;

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

export function choose(
  records: readonly Record<string, string>[],
  chosen: Chosen = MOON_CHOSEN,
): Landmark[] {
  const byName = new Map(records.map((r) => [r['name'] ?? '', r]));
  // A name listed twice must be one feature (Mercury's file lists Discovery Rupes twice, with one
  // Gazetteer link and centres 0.0002° apart): two different features would be ambiguous.
  for (const [name] of chosen) {
    const links = new Set(records.filter((r) => r['name'] === name).map((r) => r['link']));
    if (links.size > 1) throw new Error(`${name} names ${links.size} different Gazetteer features`);
  }
  return chosen.map(([name, kind, mission]) => {
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
  const name = process.argv[2] ?? 'moon';
  if (name !== 'moon' && name !== 'mars' && name !== 'mercury')
    throw new Error(`no world ${name}: moon, mars or mercury`);
  const world = WORLDS[name];
  const out = join(ROOT, 'public', 'data', name, 'landmarks.json');
  const zip = new Uint8Array(
    readFileSync(await fetchPinned(world.url, world.sha256, world.cacheName)),
  );
  const landmarks = choose(readDbf(unzipEntry(zip, world.dbf)), world.chosen);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        source: world.source,
        url: world.url,
        sha256: world.sha256,
        retrieved: world.retrieved,
        conventions: world.conventions,
        script: 'tools/data/landmarks.ts',
        landmarks,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`${landmarks.length} landmarks written to ${out}`);
}
