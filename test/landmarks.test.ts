// The labelled landmarks (public/data/moon/landmarks.json, tools/data/landmarks.ts) against the
// Gazetteer fixture pinned for the albedo checks: two releases of the same Gazetteer must agree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readDbf, unzipEntry } from '../tools/data/landmarks';

const root = join(import.meta.dirname, '..');
const landmarks = JSON.parse(
  readFileSync(join(root, 'public/data/moon/landmarks.json'), 'utf8'),
) as {
  landmarks: { name: string; label: string; kind: string; lonDeg: number; latDeg: number }[];
};
const fixture = JSON.parse(
  readFileSync(join(root, 'test/fixtures/iau-gazetteer-moon.json'), 'utf8'),
) as { features: { name: string; lonDeg: number; latDeg: number }[] };

describe('landmarks', () => {
  it('agree with the pinned Gazetteer fixture on every feature both have', () => {
    const shared = fixture.features.filter((f) =>
      landmarks.landmarks.some((l) => l.name === f.name),
    );
    expect(shared.length).toBeGreaterThanOrEqual(6);
    for (const f of shared) {
      const l = landmarks.landmarks.find((x) => x.name === f.name);
      expect(l?.lonDeg).toBeCloseTo(f.lonDeg, 3);
      expect(l?.latDeg).toBeCloseTo(f.latDeg, 3);
    }
  });

  it('are unique, on the sphere, with longitude from -180 to 180', () => {
    const names = new Set(landmarks.landmarks.map((l) => l.name));
    expect(names.size).toBe(landmarks.landmarks.length);
    for (const l of landmarks.landmarks) {
      expect(l.lonDeg).toBeGreaterThanOrEqual(-180);
      expect(l.lonDeg).toBeLessThanOrEqual(180);
      expect(Math.abs(l.latDeg)).toBeLessThanOrEqual(90);
    }
  });
});

describe('Gazetteer readers', () => {
  it('reads a deflated zip entry and a dBASE table', () => {
    // A two-field, two-record table: C(6) name, N(8) lon; the second record deleted.
    const fields = [
      ['name', 'C', 6],
      ['lon', 'N', 8],
    ] as const;
    const headerLength = 32 + 32 * fields.length + 1;
    const recordLength = 1 + 6 + 8;
    const dbf = new Uint8Array(headerLength + 2 * recordLength);
    const view = new DataView(dbf.buffer);
    view.setUint32(4, 2, true);
    view.setUint16(8, headerLength, true);
    view.setUint16(10, recordLength, true);
    fields.forEach(([name, type, length], i) => {
      dbf.set(new TextEncoder().encode(name), 32 + 32 * i);
      dbf[32 + 32 * i + 11] = type.charCodeAt(0);
      dbf[32 + 32 * i + 16] = length;
    });
    dbf[headerLength - 1] = 0x0d;
    const row = (at: number, flag: string, text: string): void => {
      dbf[at] = flag.charCodeAt(0);
      dbf.set(new TextEncoder().encode(text), at + 1);
    };
    row(headerLength, ' ', 'Tycho ' + ' 348.785');
    row(headerLength + recordLength, '*', 'Gone  ' + '     0.0');
    expect(readDbf(dbf)).toEqual([{ name: 'Tycho', lon: '348.785' }]);

    // Wrap it in a zip with one deflated entry.
    const name = new TextEncoder().encode('t.dbf');
    const data = deflateRawSync(dbf);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, 0, true);
    central.set(name, 46);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(16, local.length, true);
    const zip = new Uint8Array(local.length + central.length + end.length);
    zip.set(local, 0);
    zip.set(central, local.length);
    zip.set(end, local.length + central.length);
    expect(unzipEntry(zip, 't.dbf')).toEqual(dbf);
  });
});
