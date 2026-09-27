// Earth's orientation in the Moon's sky (docs/stories/SS-13c.md): a texel at a given longitude
// and geodetic latitude must land on the ellipsoid where SPICE's IAU_EARTH rotation puts that
// place, so the satellites' clouds sit over the right oceans and the map is neither mirrored
// nor turned.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { j2000ToScene, type MoonEphemeris } from '../core/moon';
import { createEarth } from './earth';

const ephemeris = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../public/data/moon/ephemeris.json'), 'utf8'),
) as MoonEphemeris;

describe('Earth', () => {
  for (const epoch of ephemeris.epochs) {
    it(`puts each texel where IAU_EARTH puts its place at ${epoch.id}`, () => {
      const earth = createEarth(epoch, ephemeris.earth, null, uniform(1));
      earth.updateMatrixWorld();
      const centre = new Vector3().setFromMatrixPosition(earth.matrixWorld);
      const positions = earth.geometry.getAttribute('position');
      const uvs = earth.geometry.getAttribute('uv');
      const [a, , c] = ephemeris.earth.radiiKm;
      const m = epoch.j2000ToEarthFixed;
      let checked = 0;
      for (let i = 0; i < positions.count; i += 97) {
        const lon = (uvs.getX(i) * 360 - 180) * (Math.PI / 180);
        const lat = (uvs.getY(i) * 180 - 90) * (Math.PI / 180);
        // The place, at geodetic latitude `lat` on the ellipsoid, in IAU_EARTH; to J2000 (the
        // transpose), to scene axes.
        const e2 = 1 - (c * c) / (a * a);
        const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
        const fixed = new Vector3(
          n * Math.cos(lat) * Math.cos(lon),
          n * Math.cos(lat) * Math.sin(lon),
          n * (1 - e2) * Math.sin(lat),
        );
        const [r0, r1, r2] = m;
        const j2000 = new Vector3()
          .addScaledVector(new Vector3(...r0), fixed.x)
          .addScaledVector(new Vector3(...r1), fixed.y)
          .addScaledVector(new Vector3(...r2), fixed.z);
        const expected = new Vector3(...j2000ToScene([j2000.x, j2000.y, j2000.z]));
        const vertex = new Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(earth.matrixWorld);
        expect(vertex.sub(centre).distanceTo(expected)).toBeLessThan(1e-3);
        checked++;
      }
      expect(checked).toBeGreaterThan(50);
    });
  }

  it('sits where the ephemeris puts it', () => {
    const epoch = ephemeris.epochs[1];
    if (epoch === undefined) throw new Error('no first-quarter epoch');
    const earth = createEarth(epoch, ephemeris.earth, null, uniform(1));
    earth.updateMatrixWorld();
    const centre = new Vector3().setFromMatrixPosition(earth.matrixWorld);
    const expected = new Vector3(...j2000ToScene(epoch.earthDirectionJ2000)).multiplyScalar(
      epoch.earthDistanceKm,
    );
    expect(centre.distanceTo(expected)).toBeLessThan(1e-6 * epoch.earthDistanceKm);
  });
});
