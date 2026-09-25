import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
  type Object3D,
  type UniformNode,
} from 'three/webgpu';
import {
  abs,
  asin,
  atan,
  cameraPosition,
  clamp,
  dFdx,
  dFdy,
  dot,
  float,
  floor,
  Fn,
  fract,
  int,
  ivec2,
  length,
  max,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  mix,
  smoothstep,
  sqrt,
  step,
  texture,
  textureLoad,
  uint,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { TilesRenderer } from '3d-tiles-renderer';
import { QuantizedMeshPlugin } from '3d-tiles-renderer/plugins';
import { bodyFixedToSceneMatrix, j2000ToScene, type MoonEpoch } from '../core/moon';
import { EXPOSURE, AU_KM } from '../core/photometry';

/** The manifest's relevant fields (public/data/moon/albedo.json). */
export interface AlbedoManifest {
  readonly texture: {
    readonly file: string;
    readonly mask: string;
    readonly width: number;
    readonly height: number;
  };
  readonly calibration: { readonly albedoScale: number; readonly discMeanTextureValue: number };
}

export interface MoonTextures {
  readonly albedo: DataTexture;
  /** One bit per texel, 8 texels per byte along a row; bit set = never imaged. */
  readonly gaps: DataTexture;
  readonly manifest: AlbedoManifest;
  /** Mean of the decoded albedo bytes, 0-255, for the harness to compare with the pipeline. */
  readonly decodedMean: number;
}

const base = `${import.meta.env.BASE_URL}data/moon/`;

/**
 * Decodes chosen 8-bit channels of an image, in strips so that no full-size RGBA copy
 * (128 MB at 8192 x 4096) ever exists next to the bitmap. The images are untagged and colour
 * conversion is off, so the bytes are the file's values. Channel 0 is red.
 */
async function decodeChannels(
  url: string,
  width: number,
  height: number,
  channels: readonly number[],
): Promise<Uint8Array[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed to load: HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  try {
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new Error(
        `${url} is ${bitmap.width}x${bitmap.height}, manifest says ${width}x${height}`,
      );
    }
    const strip = 256;
    const canvas = new OffscreenCanvas(width, strip);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('no 2D context to decode textures');
    context.imageSmoothingEnabled = false;
    const outs = channels.map(() => new Uint8Array(width * height));
    for (let y = 0; y < height; y += strip) {
      const rows = Math.min(strip, height - y);
      context.clearRect(0, 0, width, strip);
      context.drawImage(bitmap, 0, y, width, rows, 0, 0, width, rows);
      const rgba = context.getImageData(0, 0, width, rows).data;
      const offset = y * width;
      channels.forEach((channel, k) => {
        const out = outs[k] as Uint8Array;
        for (let i = 0, n = width * rows; i < n; i++) out[offset + i] = rgba[i * 4 + channel] ?? 0;
      });
    }
    return outs;
  } finally {
    bitmap.close();
  }
}

async function decodeGrey(url: string, width: number, height: number): Promise<Uint8Array> {
  const [grey] = await decodeChannels(url, width, height, [0]);
  return grey as Uint8Array;
}

export async function loadMoonTextures(maxAnisotropy: number): Promise<MoonTextures> {
  const response = await fetch(`${base}albedo.json`);
  if (!response.ok) throw new Error(`albedo.json failed to load: HTTP ${response.status}`);
  const manifest = (await response.json()) as AlbedoManifest;
  const { width, height } = manifest.texture;
  const [albedoBytes, maskBytes] = await Promise.all([
    decodeGrey(`${base}${manifest.texture.file}`, width, height),
    decodeGrey(`${base}${manifest.texture.mask}`, width, height),
  ]);

  let sum = 0;
  for (let i = 0; i < albedoBytes.length; i++) sum += albedoBytes[i] ?? 0;

  const albedo = new DataTexture(albedoBytes, width, height, RedFormat, UnsignedByteType);
  albedo.colorSpace = NoColorSpace; // relative albedo, linear: not a colour
  albedo.wrapS = RepeatWrapping; // longitude wraps
  albedo.wrapT = ClampToEdgeWrapping; // latitude does not
  albedo.magFilter = LinearFilter;
  albedo.minFilter = LinearMipmapLinearFilter;
  albedo.generateMipmaps = true;
  albedo.anisotropy = maxAnisotropy;
  albedo.needsUpdate = true;

  const packedWidth = width / 8;
  const packed = new Uint8Array(packedWidth * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((maskBytes[y * width + x] ?? 0) > 127) {
        const i = y * packedWidth + (x >> 3);
        packed[i] = (packed[i] ?? 0) | (1 << (x & 7));
      }
    }
  }
  const gaps = new DataTexture(packed, packedWidth, height, RedFormat, UnsignedByteType);
  gaps.colorSpace = NoColorSpace;
  gaps.magFilter = NearestFilter;
  gaps.minFilter = NearestFilter;
  gaps.generateMipmaps = false;
  gaps.needsUpdate = true;

  return { albedo, gaps, manifest, decodedMean: sum / albedoBytes.length };
}

export type MoonShading = 'lommel-seeliger' | 'lambert' | 'albedo';

export interface MoonOptions {
  readonly epoch: MoonEpoch;
  readonly radiusKm: number;
  /** The mapped albedo, or a uniform Lommel–Seeliger ϖ for photometry checks. */
  readonly albedo: MoonTextures | { readonly uniform: number };
  /**
   * 'lommel-seeliger' is the Moon. 'lambert' exists only for a negative control. 'albedo'
   * is unlit: every point as it would look at zero phase, for checking the map itself.
   */
  readonly shading: MoonShading;
  /** Negative control only: sample the map at −longitude, a mirrored Moon. */
  readonly mirrored?: boolean;
  /**
   * Explicit texture gradients at the ±180° wrap (default on). Off only for the negative
   * control that proves the seam check can see a seam.
   */
  readonly seamFix?: boolean;
  /**
   * 0 for sunlight. 1 for even lighting: every point at its zero-phase brightness, as if the
   * Sun were behind the viewer everywhere at once. Not physical, and labelled as such on
   * screen; it lets the night side and the far side be seen. A uniform when it can change.
   */
  readonly evenLight?: number | UniformNode<'float', number>;
  /** Negative control only, on terrain: east-west flipped normals, the classic sign error. */
  readonly reliefFlipped?: boolean;
}

/** IAU 2015 Resolution B3 nominal solar radius, km. */
const SUN_RADIUS_KM = 695_700;

/** Hue for never-imaged surface: shaded like the Moon, coloured like nothing on it. */
const GAP_COLOUR = [1, 0, 1] as const;

/** The epoch's body-fixed (MOON_ME) to scene rotation, as a three.js matrix. */
function bodyToSceneMatrix4(epoch: MoonEpoch): Matrix4 {
  const m = bodyFixedToSceneMatrix(epoch);
  return new Matrix4().set(
    m[0] ?? 0,
    m[1] ?? 0,
    m[2] ?? 0,
    0,
    m[3] ?? 0,
    m[4] ?? 0,
    m[5] ?? 0,
    0,
    m[6] ?? 0,
    m[7] ?? 0,
    m[8] ?? 0,
    0,
    0,
    0,
    0,
    1,
  );
}

/**
 * The Moon's surface material. On the smooth sphere, object space is the body frame and
 * the sphere's own normal lights it. On terrain, each fragment's body-fixed position comes
 * from its world position, and the normal is the vertex normal the pipeline computed from
 * the measured heights (pipeline/quantized_mesh.py): nothing about the shape is drawn from
 * an image.
 */
function createMoonMaterial(
  options: MoonOptions,
  surface: 'sphere' | 'terrain',
): MeshBasicNodeMaterial {
  const { epoch, radiusKm } = options;
  const terrain = surface === 'terrain';

  const sunScene = j2000ToScene(epoch.sunDirectionJ2000);
  const sun = uniform(new Vector3(...sunScene));
  const r = epoch.sunDistanceKm / AU_KM;
  // Linear display value per unit I/F: exposure and the sun's inverse square (core/photometry.ts).
  const scale = uniform(EXPOSURE / (r * r));
  // The Sun's angular radius at the epoch: the width of the penumbra at the horizon.
  const sunRadius = Math.asin(SUN_RADIUS_KM / epoch.sunDistanceKm);
  // Scene to body frame. The Moon is at the scene origin and only rotated, so the inverse is
  // the transpose.
  const sceneToBody = uniform(new Matrix3().setFromMatrix4(bodyToSceneMatrix4(epoch)).transpose());

  // Texture coordinates of a body-fixed direction. Column 0 at −180°, row 0 at +90°
  // (pipeline/moon.py). A DataTexture's first row is at v = 0 under WebGPU, and three applies
  // no flip to it.

  const material = new MeshBasicNodeMaterial();
  material.colorNode = Fn(() => {
    // Body-fixed position, km: +x at longitude 0, +z at the north pole.
    const bodyPosition = terrain ? sceneToBody.mul(positionWorld) : positionLocal;
    const d = normalize(bodyPosition);
    const lon = atan(d.y, d.x); // −π to π, east-positive
    const lat = asin(clamp(d.z, -1, 1));
    const signedLon = options.mirrored === true ? lon.negate() : lon;
    const u = signedLon.div(2 * Math.PI).add(0.5);
    const v = float(0.5).sub(lat.div(Math.PI));

    // No `select` or `If` anywhere before the texture samples. TSL compiles `select` to
    // if/else, and derivatives (explicit, or implicit in a texture sample) inside non-uniform
    // control flow are undefined in WGSL: on SwiftShader they came out as zero, silently
    // sharpening the whole Moon (docs/stories/SS-6.md). Everything that takes a derivative is
    // evaluated into a variable in uniform flow first, and choices are made with mix/step.
    const uv = vec2(u, v).toVar('moonUv');
    const dx = dFdx(uv).toVar('moonUvDx');
    const dy = dFdy(uv).toVar('moonUvDy');
    // Tarini's method: u jumps from 1 to 0 at the wrap, and its screen derivatives there
    // would pick the smallest mip, a visible line. A second u with its jump at longitude 0 is
    // smooth at the wrap; take whichever derivative is smaller. Only u wraps; v's derivatives
    // are used as they are.
    const uShifted = fract(signedLon.div(2 * Math.PI).add(1));
    const dxShifted = dFdx(vec2(uShifted, v)).x.toVar('moonUShiftedDx');
    const dyShifted = dFdy(vec2(uShifted, v)).x.toVar('moonUShiftedDy');
    // step(a, b) is 1 when b >= a: keep the unshifted derivative unless it is the larger.
    const gradX = vec2(mix(dxShifted, dx.x, step(abs(dx.x), abs(dxShifted))), dx.y);
    const gradY = vec2(mix(dyShifted, dy.x, step(abs(dy.x), abs(dyShifted))), dy.y);

    let albedo;
    let gap = null;
    if ('uniform' in options.albedo) {
      albedo = float(options.albedo.uniform);
    } else {
      const maps = options.albedo;
      const map = texture(maps.albedo, uv);
      const sample = (options.seamFix === false ? map : map.grad(gradX, gradY)).toVar(
        'moonAlbedoSample',
      );
      albedo = sample.r.mul(maps.manifest.calibration.albedoScale);

      const { width, height } = maps.manifest.texture;
      const column = int(clamp(floor(fract(u).mul(width)), 0, width - 1));
      const row = int(clamp(floor(v.mul(height)), 0, height - 1));
      const byte = uint(
        textureLoad(maps.gaps, ivec2(column.shiftRight(3), row))
          .r.mul(255)
          .round(),
      );
      // 1 where the surface was never imaged, else 0.
      gap = float(byte.shiftRight(uint(column.bitAnd(7))).bitAnd(1)).toVar('moonGap');
      // Gaps are shaded with the disc-mean albedo, so their shape and lighting read, and
      // coloured so they can never pass for data.
      const meanAlbedo =
        maps.manifest.calibration.albedoScale * maps.manifest.calibration.discMeanTextureValue;
      albedo = mix(albedo, float(meanAlbedo), gap);
    }

    // The Moon is at the origin with a rotation-only placement, so the direction of the
    // world position is the smooth sphere's normal.
    const sphereNormal = normalize(positionWorld);
    let normal = sphereNormal;
    let sunVisible = null;
    if (terrain) {
      let bodyNormal = sceneToBody.mul(normalize(normalWorld));
      if (options.reliefFlipped === true) {
        // Mirror the normal's east component. East is undefined exactly at a pole, where the
        // tiny floor keeps it finite.
        const eastAxis = vec3(d.y.negate(), d.x, 0).div(
          max(sqrt(d.x.mul(d.x).add(d.y.mul(d.y))), 1e-6),
        );
        bodyNormal = bodyNormal.sub(eastAxis.mul(dot(bodyNormal, eastAxis).mul(2)));
      }
      // Row vector times matrix: the transpose, body to scene.
      normal = normalize(bodyNormal.mul(sceneToBody));

      // Beyond the terminator the Sun is below the smooth sphere's horizon. A point at height
      // h still sees it while its depression is under acos(R / (R + h)) ≈ sqrt(2h / R): high
      // ground catches light past the terminator, low ground does not. Soft over the Sun's
      // angular radius. Cast shadows from nearby terrain come with horizon maps (SS-8, part 2).
      const h = length(bodyPosition).sub(radiusKm);
      const depression = sqrt(max(h.mul(2 / radiusKm), 0));
      const mu0Sphere = dot(sphereNormal, sun);
      sunVisible = smoothstep(
        depression.negate().sub(sunRadius),
        depression.negate().add(sunRadius),
        mu0Sphere,
      );
    }
    const mu0 = dot(normal, sun);
    const mu = dot(normal, normalize(cameraPosition.sub(positionWorld)));
    let radianceFactor;
    switch (options.shading) {
      case 'lommel-seeliger': {
        let sunlit = albedo
          .div(4)
          .mul(max(mu0, 0))
          .div(max(max(mu0, 0).add(max(mu, 0)), 1e-6));
        if (sunVisible !== null) sunlit = sunlit.mul(sunVisible);
        const even = options.evenLight ?? 0;
        radianceFactor =
          typeof even === 'number' && even === 0 ? sunlit : mix(sunlit, albedo.div(8), even);
        break;
      }
      case 'lambert':
        // Negative control: equal to Lommel–Seeliger at the disc centre at zero phase.
        radianceFactor = albedo.div(8).mul(max(mu0, 0));
        break;
      case 'albedo':
        radianceFactor = albedo.div(8);
        break;
    }
    const value = radianceFactor.mul(scale);
    const colour =
      gap === null ? vec3(value) : mix(vec3(value), vec3(...GAP_COLOUR).mul(value), gap);
    return vec4(colour, 1);
  })();
  return material;
}

/**
 * The Moon as a smooth sphere in km whose object space is the MOON_ME body frame, placed at
 * the scene origin and rotated by the epoch's orientation. Texture coordinates are computed
 * per fragment from the object-space direction, never from mesh UVs. The photometry checks
 * are written for it.
 */
export function createMoonMesh(options: MoonOptions): Mesh {
  // SphereGeometry is Y-up; turn it so its poles sit on the body frame's +z. Only the
  // tessellation cares: shading and texturing use the direction alone.
  const geometry = new SphereGeometry(options.radiusKm, 256, 128).rotateX(Math.PI / 2);
  const mesh = new Mesh(geometry, createMoonMaterial(options, 'sphere'));
  mesh.name = 'moon';
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(bodyToSceneMatrix4(options.epoch));
  mesh.matrixWorldNeedsUpdate = true;
  return mesh;
}

/**
 * Screen-space error the terrain refines to, in drawing-buffer pixels. A tile's geometric
 * error is a quarter of its vertex spacing (3d-tiles-renderer's QuantizedMeshPlugin), so
 * vertices land at most 4 pixels apart wherever the data goes that deep. The library
 * recommends 2 for Earth imagery; the Moon's shape here is carried by vertices alone.
 */
const TERRAIN_ERROR_TARGET = 1;

/** Terrain tiles, built at deploy time by `npm run pipeline:tiles` (docs/stories/SS-10.md). */
const terrainBase = `${import.meta.env.BASE_URL}terrain/`;

/**
 * The Moon as streamed polygons: LOLA quantized-mesh tiles (pipeline/terrain_tiles.py),
 * every vertex on a measured height, refined as the camera comes closer. The caller sets
 * the camera and resolution and calls `update()` once per frame before drawing.
 */
export function createMoonTerrain(options: MoonOptions): TilesRenderer {
  const tiles = new TilesRenderer(terrainBase);
  const radiusM = options.radiusKm * 1000;
  tiles.ellipsoid.radius.set(radiusM, radiusM, radiusM);
  tiles.registerPlugin(new QuantizedMeshPlugin({ useRecommendedSettings: false }));
  tiles.errorTarget = TERRAIN_ERROR_TARGET;

  const material = createMoonMaterial(options, 'terrain');
  tiles.addEventListener('load-model', ({ scene }: { scene: Object3D }) => {
    scene.traverse((object) => {
      if (object instanceof Mesh) object.material = material;
    });
  });

  // Tiles are body-fixed metres; the scene is km.
  const group = tiles.group;
  group.name = 'moon';
  group.matrixAutoUpdate = false;
  group.matrix
    .copy(bodyToSceneMatrix4(options.epoch))
    .multiply(new Matrix4().makeScale(1e-3, 1e-3, 1e-3));
  group.updateMatrixWorld(true);
  return tiles;
}
