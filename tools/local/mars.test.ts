import { describe, expect, it } from 'vitest';
import type { BlockStore, FileSpec } from './grids';
import {
  MAX_LEVEL,
  hiriseModels,
  hrscStrips,
  marsAvailability,
  megdr128,
  sampleRaster,
  vertexSpacingM,
} from './mars';

// Two lines of the HiRISE archive's cumulative DTM index (PDS/INDEX/DTMCUMINDEX.TAB, 2026-10-03):
// a DTM and its orthoimage.
const INDEX =
  '"MROHR_0001","DTM/PSP/ORB_001300_001399/PSP_001336_1560_PSP_001534_1560/DTEEC_001336_1560_001534_1560_U01.IMG","MRO","HIRISE","DTEEC_001336_1560_001534_1560_U01","1  ","MARS                            ","Fan/deltaic landform in west Eberswalde Crater                             ","PSP_001336_1560","PSP_001534_1560","NA                               ","DTM             ", 15166,  6789,  270.0000,  -23.9697,  -23.7115,  326.3230,  326.4460, 1.01, 58751.398,"EQUIRECTANGULAR    ",-20.0, 180.000,  -1393080.0,      3143.5,  -23.7216,  326.3240,  -23.7120,  326.4130,  -23.9584,  326.4450,  -23.9696,  326.3570\n"MROHR_0001","DTM/PSP/ORB_001300_001399/PSP_001336_1560_PSP_001534_1560/PSP_001336_1560_RED_C_01_ORTHO.JP2   ","MRO","HIRISE","PSP_001336_1560_RED_C_01_ORTHO   ","1  ","MARS                            ","Fan/deltaic landform in west Eberswalde Crater                             ","PSP_001336_1560","NA             ","DTEEC_001336_1560_001534_1560_U01","ORTHOIMAGE      ", 15166,  6789,  270.0000,  -23.9697,  -23.7115,  326.3230,  326.4460, 1.01, 58751.398,"EQUIRECTANGULAR    ",-20.0, 180.000,  -1393080.0,      3143.5,  -23.7216,  326.3240,  -23.7120,  326.4130,  -23.9584,  326.4450,  -23.9696,  326.3570';

describe('Mars local mode', () => {
  it("names MOLA's 128 px/deg files as PDS lists them", () => {
    const megt = megdr128('megt');
    const name = (row: number, col: number) => megt.locate(row, col)?.file.url.split('/').pop();
    expect(name(0, 0)).toBe('megt88n000hb.img');
    expect(name(44 * 128, 90 * 128)).toBe('megt44n090hb.img');
    expect(name(88 * 128, 180 * 128)).toBe('megt00n180hb.img');
    expect(name(176 * 128 - 1, 360 * 128 - 1)).toBe('megt44s270hb.img');
    expect(megdr128('megc').locate(0, 0)?.file.dtype).toBe('u8');
  });

  it('spaces vertices 1.3 km apart at level 7 and 1.3 m at level 17', () => {
    expect(vertexSpacingM(7)).toBeCloseTo(1302.2, 0);
    expect(vertexSpacingM(MAX_LEVEL)).toBeCloseTo(1.27, 2);
  });

  it('offers levels 13-17 only over HiRISE models', () => {
    const available = marsAvailability([{ south: -24, north: -23.7, west: 326.3, east: 326.5 }]);
    expect(available).toHaveLength(MAX_LEVEL + 1);
    expect(available[12]?.[0]).toEqual({ startX: 0, startY: 0, endX: 8191, endY: 4095 });
    const z13 = available[13]?.[0];
    const size = 180 / 2 ** 13;
    expect(z13?.startX).toBe(Math.floor((326.3 - 360 + 180) / size));
    expect(z13?.startY).toBe(Math.floor((-24 + 90) / size));
  });

  it('reads DTMs, not orthoimages, from the HiRISE index', () => {
    const models = hiriseModels(INDEX);
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('DTEEC_001336_1560_001534_1560_U01');
    expect(models[0]?.url).toBe(
      'https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_001300_001399/PSP_001336_1560_PSP_001534_1560/DTEEC_001336_1560_001534_1560_U01.IMG',
    );
    expect(models[0]?.box).toEqual({
      south: -23.9697,
      north: -23.7115,
      west: 326.323,
      east: 326.446,
    });
  });

  it('uses the strips the website used, with their fitted offsets, and none it left out', () => {
    const manifest = {
      composite: { leftOut: { h0002_0000_da4: {} } },
      fits: {
        h0001_0000_da4: { offsetM: 1.5, extent: { rows: [640, 1280], cols: [23000, 23100] } },
        h0002_0000_da4: { offsetM: 0, extent: { rows: [0, 10], cols: [0, 10] } },
      },
      localMode: { hrscWeight: { sha256: '' } },
    };
    const sources = {
      base: 'https://example/',
      strips: {
        h0001_0000_da4: { path: 'data/0001/h0001_0000_da4.img', sha256: 'a' },
        h0002_0000_da4: { path: 'data/0002/h0002_0000_da4.img', sha256: 'b' },
      },
    };
    const strips = hrscStrips(manifest as never, sources);
    expect(strips.map((s) => s.name)).toEqual(['h0001_0000_da4']);
    expect(strips[0]?.offsetM).toBe(1.5);
    expect(strips[0]?.url).toBe('https://example/data/0001/h0001_0000_da4.img');
    // Rows 640-1280 from +90 at 64 px/deg are 80 to 70 N, with a bin of margin; columns past
    // 360 E stay past it.
    expect(strips[0]?.box.north).toBeCloseTo(90 - 639 / 64, 9);
    expect(strips[0]?.box.east).toBeGreaterThan(360);
  });

  describe('sampling a projected raster', () => {
    // A 4 x 4 file whose pixel (r, c) holds 10 r + c, its last value unmeasured.
    const file: FileSpec = {
      id: 'fake',
      url: '',
      rows: 4,
      cols: 4,
      dtype: 'f32le-m',
      nodata: null,
      whole: true,
    };
    const data = Float32Array.from({ length: 16 }, (_, i) =>
      i === 15 ? Number.NaN : 10 * Math.floor(i / 4) + (i % 4),
    );
    const store = { block: () => Promise.resolve(data) } as unknown as BlockStore;
    const at = (row: number, col: number) => ({ toPixel: () => ({ row, col }) });
    const one = new Float64Array(1);

    it('is bilinear between measured samples', async () => {
      expect((await sampleRaster(store, file, at(1.5, 0.25), one, one))[0]).toBeCloseTo(15.25, 9);
    });

    it('refuses a point next to an unmeasured sample', async () => {
      expect((await sampleRaster(store, file, at(2.5, 2.5), one, one))[0]).toBeNaN();
    });

    it('averages a box of samples when vertices are far apart, if half are measured', async () => {
      expect((await sampleRaster(store, file, at(1.5, 1.5), one, one, 2))[0]).toBeCloseTo(16.5, 9);
      expect((await sampleRaster(store, file, at(3.5, 3.5), one, one, 2))[0]).toBeNaN();
    });

    it('has nothing outside the file', async () => {
      expect((await sampleRaster(store, file, at(-5, -5), one, one))[0]).toBeNaN();
    });
  });
});
