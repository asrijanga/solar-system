import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  RepeatWrapping,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  type UniformNode,
} from 'three/webgpu';
import {
  Fn,
  max,
  normalize,
  positionWorld,
  dot,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { j2000ToScene, type MoonEpoch } from '../core/moon';
import { displayValue, EARTH_GEOMETRIC_ALBEDO, lambertAlbedoFor } from '../core/photometry';
import { decodeChannels } from './decode';

/** Earth's radii from SPICE (pipeline/ephemeris.py, pck00011.tpc BODY399_RADII), km. */
export interface EarthBody {
  readonly radiiKm: readonly [number, number, number];
}

/**
 * Earth's face at one instant: the geostationary satellites' reflectance, I/F, in 0.64 / 0.51 /
 * 0.47 µm under that instant's Sun (pipeline/earth.py, docs/stories/SS-13c.md). Plate carrée,
 * longitude -180 to 180 left to right, geodetic latitude 90 to -90 top to bottom, in IAU_EARTH.
 */
export interface EarthFace {
  readonly map: DataTexture;
  readonly utc: string;
  /** Earth's I/F averaged over its disc as the Moon sees it, per channel: earthshine's source. */
  readonly discIOverF: readonly [number, number, number];
}

interface FacesManifest {
  readonly instants: Readonly<
    Record<
      string,
      {
        readonly image: string;
        readonly utc: string;
        readonly discIOverFFromMoon: { readonly rgb: readonly [number, number, number] };
      }
    >
  >;
}

const FACE_WIDTH = 2048;
const FACE_HEIGHT = 1024;

/** The face measured at this epoch, or null where no satellite data was built for it. */
export async function loadEarthFace(
  epochId: string,
  url: (path: string) => string,
  maxAnisotropy: number,
): Promise<EarthFace | null> {
  const response = await fetch(url('data/earth/faces.json'));
  if (!response.ok) throw new Error(`faces.json failed to load: HTTP ${response.status}`);
  const instant = ((await response.json()) as FacesManifest).instants[epochId];
  if (instant === undefined) return null;
  // Decoded byte for byte, as the Moon's map is: no colour management between file and texture.
  const [r, g, b] = await decodeChannels(url(instant.image), FACE_WIDTH, FACE_HEIGHT, [0, 1, 2]);
  // A data texture's first row is v = 0, latitude -90 on SphereGeometry: the file's rows go in
  // bottom first.
  const rgba = new Uint8Array(FACE_WIDTH * FACE_HEIGHT * 4);
  for (let row = 0; row < FACE_HEIGHT; row++) {
    const from = row * FACE_WIDTH;
    const to = (FACE_HEIGHT - 1 - row) * FACE_WIDTH;
    for (let col = 0; col < FACE_WIDTH; col++) {
      const k = (to + col) * 4;
      rgba[k] = r?.[from + col] ?? 0;
      rgba[k + 1] = g?.[from + col] ?? 0;
      rgba[k + 2] = b?.[from + col] ?? 0;
      rgba[k + 3] = 255;
    }
  }
  const map = new DataTexture(rgba, FACE_WIDTH, FACE_HEIGHT, RGBAFormat, UnsignedByteType);
  // The file stores I/F sRGB-encoded; sampling decodes it back to linear I/F.
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = ClampToEdgeWrapping;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = maxAnisotropy;
  map.needsUpdate = true;
  return { map, utc: instant.utc, discIOverF: instant.discIOverFFromMoon.rgb };
}

/**
 * Earth in the Moon's sky: where the ephemeris puts it at the epoch, at its SPICE radii, turned
 * as IAU_EARTH was when its light left for the Moon.
 *
 * With a face (docs/stories/SS-13c.md) it shows what the satellites measured: clouds, oceans,
 * land, the air's blue and the terminator are all in the data, so there is no lighting to add.
 * Display = exposure · I/F / r², as for the Moon. Without one (an instant no satellite set was
 * built for) it is SS-13b's uniform Lambert sphere of the fact sheet's geometric albedo, lit by
 * the Sun, and the About text says which.
 */
export function createEarth(
  epoch: MoonEpoch,
  body: EarthBody,
  face: EarthFace | null,
  exposure: UniformNode<'float', number>,
): Mesh {
  const geometry = ellipsoid(body.radiiKm);
  const mesh = new Mesh(
    geometry,
    face === null
      ? createUniformMaterial(epoch, exposure)
      : createFaceMaterial(epoch, face, exposure),
  );
  mesh.name = 'earth';
  // The geometry is built in IAU_EARTH-like axes (see `ellipsoid`): its x, y and -z are
  // IAU_EARTH's x, z and y. The rows of j2000ToEarthFixed are those axes in J2000.
  const [x, y, z] = epoch.j2000ToEarthFixed;
  const along = (v: readonly [number, number, number]): Vector3 => new Vector3(...j2000ToScene(v));
  const basis = new Matrix4().makeBasis(along(x), along(z), along([-y[0], -y[1], -y[2]]));
  const centre = along(epoch.earthDirectionJ2000).multiplyScalar(epoch.earthDistanceKm);
  mesh.matrix.copy(basis).setPosition(centre);
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldNeedsUpdate = true;
  return mesh;
}

/**
 * Earth's ellipsoid, km, with each vertex at the geodetic latitude its texture row stands for:
 * the satellites' navigation (CGMS, GOES-R PUG) works in geodetic latitude, so the map's rows are
 * geodetic. SphereGeometry's (u, v) and layout are kept: longitude 360 u - 180, latitude
 * 180 v - 90, the point (cos φ cos λ, sin φ, -cos φ sin λ) on a sphere, here moved onto the
 * ellipsoid where the surface normal has that latitude.
 */
function ellipsoid(radiiKm: readonly [number, number, number]): SphereGeometry {
  const [a, , c] = radiiKm;
  const e2 = 1 - (c * c) / (a * a);
  const geometry = new SphereGeometry(1, 128, 64);
  const position = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    const lon = (uvs.getX(i) * 360 - 180) * (Math.PI / 180);
    const lat = (uvs.getY(i) * 180 - 90) * (Math.PI / 180);
    const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    const across = n * Math.cos(lat);
    position.setXYZ(
      i,
      across * Math.cos(lon),
      n * (1 - e2) * Math.sin(lat),
      -across * Math.sin(lon),
    );
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createFaceMaterial(
  epoch: MoonEpoch,
  face: EarthFace,
  exposure: UniformNode<'float', number>,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const scale = exposure.mul(displayValue(1, epoch.earthSunDistanceKm));
  material.colorNode = vec4(texture(face.map, uv()).rgb.mul(scale), 1);
  return material;
}

function createUniformMaterial(
  epoch: MoonEpoch,
  exposure: UniformNode<'float', number>,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const sun = uniform(new Vector3(...j2000ToScene(epoch.sunDirectionJ2000)));
  const scale = exposure.mul(
    displayValue(lambertAlbedoFor(EARTH_GEOMETRIC_ALBEDO), epoch.earthSunDistanceKm),
  );
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
