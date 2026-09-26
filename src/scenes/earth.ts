import { Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3 } from 'three/webgpu';
import { Fn, max, normalize, positionWorld, dot, uniform, vec3, vec4 } from 'three/tsl';
import { j2000ToScene, type MoonEpoch } from '../core/moon';
import { AU_KM, EARTH_GEOMETRIC_ALBEDO, EXPOSURE, lambertAlbedoFor } from '../core/photometry';

/** Earth's radii from SPICE (pipeline/ephemeris.py, pck00011.tpc BODY399_RADII), km. */
export interface EarthBody {
  readonly radiiKm: readonly [number, number, number];
}

/**
 * Earth in the Moon's sky (docs/stories/SS-13b.md): where the ephemeris puts it at the epoch,
 * at its SPICE radii, lit by the same Sun with the same photometry as the Moon. Until Earth's own
 * round of the world recipe it is a uniform Lambert sphere of the fact sheet's geometric albedo,
 * with no surface, cloud or ocean data: labelled so in the About text.
 *
 * Its pole is taken as the J2000 z axis. Precession since J2000 moves it about 0.4°, which only
 * tilts a 0.3% flattening: invisible at the 1.9° Earth spans from the Moon.
 */
export function createEarth(epoch: MoonEpoch, body: EarthBody): Mesh {
  const [a, , c] = body.radiiKm;
  // SphereGeometry is Y-up: turn its pole onto scene axes of J2000 z, then flatten along it.
  const pole = new Vector3(...j2000ToScene([0, 0, 1]));
  const geometry = new SphereGeometry(1, 96, 48);
  const mesh = new Mesh(geometry, createEarthMaterial(epoch));
  mesh.name = 'earth';
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), pole);
  mesh.scale.set(a, c, a);
  const centre = j2000ToScene(epoch.earthDirectionJ2000);
  mesh.position.set(...centre).multiplyScalar(epoch.earthDistanceKm);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function createEarthMaterial(epoch: MoonEpoch): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const sun = uniform(new Vector3(...j2000ToScene(epoch.sunDirectionJ2000)));
  // Earth and the Moon are the same distance from the Sun to within 0.3%: the Moon's is used.
  const r = epoch.sunDistanceKm / AU_KM;
  const scale = uniform((EXPOSURE * lambertAlbedoFor(EARTH_GEOMETRIC_ALBEDO)) / (r * r));
  const centre = uniform(
    new Vector3(...j2000ToScene(epoch.earthDirectionJ2000)).multiplyScalar(epoch.earthDistanceKm),
  );
  material.colorNode = Fn(() => {
    // The ellipsoid's normal is close enough to the direction from its centre (0.3% flattening).
    const normal = normalize(positionWorld.sub(centre));
    const value = max(dot(normal, sun), 0).mul(scale);
    return vec4(vec3(value), 1);
  })();
  return material;
}
