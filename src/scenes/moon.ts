import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
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
  max,
  normalize,
  positionLocal,
  positionWorld,
  mix,
  step,
  texture,
  textureLoad,
  uint,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
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
 * Decodes an 8-bit greyscale image into one byte per pixel, in strips so that no full-size
 * RGBA copy (128 MB at 8192 x 4096) ever exists next to the bitmap. The image is untagged
 * and colour conversion is off, so the bytes are the file's values.
 */
async function decodeGrey(url: string, width: number, height: number): Promise<Uint8Array> {
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
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y += strip) {
      const rows = Math.min(strip, height - y);
      context.clearRect(0, 0, width, strip);
      context.drawImage(bitmap, 0, y, width, rows, 0, 0, width, rows);
      const rgba = context.getImageData(0, 0, width, rows).data;
      const offset = y * width;
      for (let i = 0, n = width * rows; i < n; i++) out[offset + i] = rgba[i * 4] ?? 0;
    }
    return out;
  } finally {
    bitmap.close();
  }
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
}

/** Hue for never-imaged surface: shaded like the Moon, coloured like nothing on it. */
const GAP_COLOUR = [1, 0, 1] as const;

/**
 * The Moon as a sphere in km whose object space is the MOON_ME body frame, placed at the
 * scene origin and rotated by the epoch's orientation. Texture coordinates are computed per
 * fragment from the object-space direction, never from mesh UVs.
 */
export function createMoonMesh(options: MoonOptions): Mesh {
  const { epoch, radiusKm } = options;

  // SphereGeometry is Y-up; turn it so its poles sit on the body frame's +z. Only the
  // tessellation cares: shading and texturing use the direction alone.
  const geometry = new SphereGeometry(radiusKm, 256, 128).rotateX(Math.PI / 2);

  const sunScene = j2000ToScene(epoch.sunDirectionJ2000);
  const sun = uniform(new Vector3(...sunScene));
  const r = epoch.sunDistanceKm / AU_KM;
  // Linear display value per unit I/F: exposure and the sun's inverse square (core/photometry.ts).
  const scale = uniform(EXPOSURE / (r * r));

  const material = new MeshBasicNodeMaterial();
  material.colorNode = Fn(() => {
    // Body-fixed direction: +x at longitude 0, +z at the north pole.
    const d = normalize(positionLocal);
    const lon = atan(d.y, d.x); // −π to π, east-positive
    const lat = asin(clamp(d.z, -1, 1));
    const signedLon = options.mirrored === true ? lon.negate() : lon;
    // Texture: column 0 at −180°, row 0 at +90° (pipeline/moon.py). A DataTexture's first
    // row is at v = 0 under WebGPU, and three applies no flip to it.
    const u = signedLon.div(2 * Math.PI).add(0.5);
    const v = float(0.5).sub(lat.div(Math.PI));

    // No `select` or `If` anywhere before the texture sample. TSL compiles `select` to
    // if/else, and derivatives (explicit, or implicit in a texture sample) inside non-uniform
    // control flow are undefined in WGSL: on SwiftShader they came out as zero, silently
    // sharpening the whole Moon (docs/stories/SS-6.md). Everything that takes a derivative is
    // evaluated into a variable in uniform flow first, and choices are made with mix/step.
    let albedo;
    let gap = null;
    if ('uniform' in options.albedo) {
      albedo = float(options.albedo.uniform);
    } else {
      const maps = options.albedo;
      const uv = vec2(u, v).toVar('moonUv');
      const map = texture(maps.albedo, uv);
      let sample;
      if (options.seamFix === false) {
        sample = map.toVar('moonAlbedoSample');
      } else {
        // Tarini's method: u jumps from 1 to 0 at the wrap, and its screen derivatives there
        // would pick the smallest mip, a visible line. A second u with its jump at longitude 0
        // is smooth at the wrap; take whichever derivative is smaller. Only u wraps; v's
        // derivatives are used as they are.
        const uShifted = fract(signedLon.div(2 * Math.PI).add(1));
        const dx = dFdx(uv).toVar('moonUvDx');
        const dy = dFdy(uv).toVar('moonUvDy');
        const dxShifted = dFdx(vec2(uShifted, v)).x.toVar('moonUShiftedDx');
        const dyShifted = dFdy(vec2(uShifted, v)).x.toVar('moonUShiftedDy');
        // step(a, b) is 1 when b >= a: keep the unshifted derivative unless it is the larger.
        const keepX = step(abs(dx.x), abs(dxShifted));
        const keepY = step(abs(dy.x), abs(dyShifted));
        const gradX = vec2(mix(dxShifted, dx.x, keepX), dx.y);
        const gradY = vec2(mix(dyShifted, dy.x, keepY), dy.y);
        sample = map.grad(gradX, gradY).toVar('moonAlbedoSample');
      }
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

    // The Moon is at the origin with a rotation-only model matrix, so the world-space normal
    // of the true sphere is the normalised world position.
    const n = normalize(positionWorld);
    const mu0 = dot(n, sun);
    const mu = dot(n, normalize(cameraPosition.sub(positionWorld)));
    let radianceFactor;
    switch (options.shading) {
      case 'lommel-seeliger': {
        const sunlit = albedo
          .div(4)
          .mul(max(mu0, 0))
          .div(max(max(mu0, 0).add(max(mu, 0)), 1e-6));
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

  const mesh = new Mesh(geometry, material);
  mesh.name = 'moon';
  const m = bodyFixedToSceneMatrix(epoch);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(
    new Matrix4().set(
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
    ),
  );
  mesh.matrixWorldNeedsUpdate = true;
  return mesh;
}
