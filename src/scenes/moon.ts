import { decodeChannels } from './decode';
import {
  ClampToEdgeWrapping,
  DataTexture,
  HalfFloatType,
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
  RGBAFormat,
  RGFormat,
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
import type { HapkeParameters } from '../core/hapke';
import { EXPOSURE, AU_KM, SUNLIT_FADE } from '../core/photometry';
import type Node from 'three/src/nodes/core/Node.js';
import { hapkeNode, type HapkeNodes } from './hapkeNode';
import { siteUrl } from '../site';

/** The manifest's relevant fields (public/data/moon/albedo.json). */
export interface AlbedoManifest {
  readonly texture: {
    readonly file: string;
    /** Present only while some texel was never measured (pipeline/moon.py). */
    readonly mask: string | null;
    readonly width: number;
    readonly height: number;
    /** byte = 255 sqrt(I/F / maxIOverF), I/F at the standard geometry (pipeline/moon.py). */
    readonly encoding: { readonly curve: 'sqrt'; readonly maxIOverF: number };
  };
  /**
   * The measured colour (docs/stories/SS-5b.md): red = I/F(643 nm) / I/F(566 nm) and green =
   * I/F(415 nm) / I/F(566 nm), each byte linear over its range.
   */
  readonly colour: {
    readonly file: string;
    readonly width: number;
    readonly height: number;
    readonly ranges: {
      readonly '643/566': readonly [number, number];
      readonly '415/566': readonly [number, number];
    };
  };
  readonly calibration: { readonly discMeanIOverF: number };
}

export interface MoonTextures {
  readonly albedo: DataTexture;
  /** The colour ratios, coarser than the albedo (AlbedoManifest.colour). */
  readonly colour: DataTexture;
  /** One bit per texel, 8 texels per byte along a row; bit set = never measured. Null when every
   * texel was measured. */
  readonly gaps: DataTexture | null;
  readonly manifest: AlbedoManifest;
  /** Mean of the decoded albedo bytes, 0-255, for the harness to compare with the pipeline. */
  readonly decodedMean: number;
}

const base = siteUrl('data/moon/');

/** The manifest's relevant fields (public/data/moon/hapke.json, tools/data/hapke.ts). */
interface HapkeManifest {
  readonly texture: { readonly file: string; readonly width: number; readonly height: number };
  readonly median: HapkeParameters;
  readonly medianAtStandard: number;
}

/**
 * The Moon's Hapke parameters per 1° tile (docs/stories/SS-8b.md). `parameters` holds
 * (w, b, c, Bs0) and `extra` (hs, I/F at the map's standard geometry), half floats, linearly
 * filtered, column 0 centred at 0.5°E and row 0 at 89.5°N. The median tile stands in where a
 * Moon of uniform albedo is drawn.
 */
export interface HapkeData {
  readonly parameters: DataTexture;
  readonly extra: DataTexture;
  readonly median: HapkeParameters;
  readonly medianAtStandard: number;
}

function halfTexture(
  data: Uint16Array,
  width: number,
  height: number,
  format: typeof RGBAFormat | typeof RGFormat,
): DataTexture {
  const tex = new DataTexture(data, width, height, format, HalfFloatType);
  tex.colorSpace = NoColorSpace;
  tex.wrapS = RepeatWrapping; // longitude wraps
  tex.wrapT = ClampToEdgeWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export async function loadHapke(): Promise<HapkeData> {
  const response = await fetch(`${base}hapke.json`);
  if (!response.ok) throw new Error(`hapke.json failed to load: HTTP ${response.status}`);
  const manifest = (await response.json()) as HapkeManifest;
  const { width, height, file } = manifest.texture;
  const bin = await fetch(`${base}${file}`);
  if (!bin.ok) throw new Error(`${file} failed to load: HTTP ${bin.status}`);
  const buffer = await bin.arrayBuffer();
  const texels = width * height;
  if (buffer.byteLength !== texels * 6 * 2) {
    throw new Error(`${file} is ${buffer.byteLength} bytes, expected ${texels * 12}`);
  }
  return {
    parameters: halfTexture(new Uint16Array(buffer, 0, texels * 4), width, height, RGBAFormat),
    extra: halfTexture(new Uint16Array(buffer, texels * 8, texels * 2), width, height, RGFormat),
    median: manifest.median,
    medianAtStandard: manifest.medianAtStandard,
  };
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
  const mask = manifest.texture.mask;
  const [albedoBytes, maskBytes, colourChannels] = await Promise.all([
    decodeGrey(`${base}${manifest.texture.file}`, width, height),
    mask === null ? null : decodeGrey(`${base}${mask}`, width, height),
    decodeChannels(
      `${base}${manifest.colour.file}`,
      manifest.colour.width,
      manifest.colour.height,
      [0, 1],
    ),
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

  // Red and green of the colour file into one two-channel texture: the ratios, linear.
  const [red, green] = colourChannels;
  const cw = manifest.colour.width;
  const ch = manifest.colour.height;
  const rg = new Uint8Array(cw * ch * 2);
  for (let i = 0; i < cw * ch; i++) {
    rg[i * 2] = red?.[i] ?? 0;
    rg[i * 2 + 1] = green?.[i] ?? 0;
  }
  const colour = new DataTexture(rg, cw, ch, RGFormat, UnsignedByteType);
  colour.colorSpace = NoColorSpace; // ratios, linear: not a colour to be managed
  colour.wrapS = RepeatWrapping;
  colour.wrapT = ClampToEdgeWrapping;
  colour.magFilter = LinearFilter;
  colour.minFilter = LinearMipmapLinearFilter;
  colour.generateMipmaps = true;
  colour.anisotropy = maxAnisotropy;
  colour.needsUpdate = true;

  return {
    albedo,
    colour,
    gaps: maskBytes === null ? null : packGaps(maskBytes, width, height),
    manifest,
    decodedMean: sum / albedoBytes.length,
  };
}

/** The mask as one bit per texel, so the shader reads it exactly with no filtering. */
function packGaps(maskBytes: Uint8Array, width: number, height: number): DataTexture {
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

  return gaps;
}

export type MoonShading = 'hapke' | 'lambert' | 'albedo';

export interface MoonOptions {
  readonly epoch: MoonEpoch;
  readonly radiusKm: number;
  /**
   * The mapped albedo, or for photometry checks a uniform one: I/F at the map's standard
   * geometry (core/hapke.ts MAP_STANDARD_DEG), scattered with the median tile's
   * parameters.
   */
  readonly albedo: MoonTextures | { readonly uniform: number };
  /** How the surface scatters light with angle, per tile (docs/stories/SS-8b.md). */
  readonly hapke: HapkeData;
  /**
   * 'hapke' is the Moon. 'lambert' exists only for a negative control. 'albedo' is unlit:
   * every point as it would look at zero phase, seen from straight above, for checking the map
   * itself.
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
  /**
   * Earthshine (docs/stories/SS-13e.md): Earth's direction in scene axes, its angular radius,
   * and per channel the fraction of sunlight it puts on a surface facing it squarely
   * (core/photometry.ts earthshineFactor). Null where no measured face of Earth exists for the
   * epoch.
   */
  readonly earthshine?: {
    readonly direction: readonly [number, number, number];
    readonly angularRadius: number;
    readonly factor: readonly [number, number, number];
  } | null;
  /**
   * 1 for physical earthshine, or the labelled boost (core/photometry.ts EARTHSHINE_BOOST_STOPS),
   * applied only where the Sun is down. A uniform, so it can change.
   */
  readonly earthshineBoost?: UniformNode<'float', number>;
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
 * the measured heights (tools/terrain/quantizedMesh.ts): nothing about the shape is drawn from
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
  const earthshineBoost = options.earthshineBoost ?? uniform(1);
  const earthshine = options.earthshine ?? null;
  const earthDirection = earthshine === null ? null : uniform(new Vector3(...earthshine.direction));
  const earthFactor = earthshine === null ? null : uniform(new Vector3(...earthshine.factor));
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

    // I/F at the map's standard geometry, and the tile's Hapke parameters with its own I/F at
    // that geometry: the map's value scales Hapke's angular behaviour (docs/stories/SS-8b.md).
    let albedo;
    // Measured colour relative to 566 nm; white where none is drawn (a uniform Moon).
    let tint: Node<'vec3'> = vec3(1, 1, 1);
    let gap = null;
    let hapke: HapkeNodes;
    let standard;
    if ('uniform' in options.albedo) {
      albedo = float(options.albedo.uniform);
      const m = options.hapke.median;
      hapke = { w: float(m.w), b: float(m.b), c: float(m.c), bs0: float(m.bs0), hs: float(m.hs) };
      standard = float(options.hapke.medianAtStandard);
    } else {
      // Tile centres sit on whole-and-a-half degrees from 0°E; u = longitude / 360°. Level 0,
      // no mipmaps, so no derivative is taken.
      const tileUv = vec2(fract(signedLon.div(2 * Math.PI)), v);
      const q = texture(options.hapke.parameters, tileUv, 0).toVar('moonHapke');
      const x = texture(options.hapke.extra, tileUv, 0).toVar('moonHapkeExtra');
      hapke = { w: q.r, b: q.g, c: q.b, bs0: q.a, hs: x.r };
      standard = x.g;
      const maps = options.albedo;
      const map = texture(maps.albedo, uv);
      const sample = (options.seamFix === false ? map : map.grad(gradX, gradY)).toVar(
        'moonAlbedoSample',
      );
      // byte = 255 sqrt(I/F / maxIOverF) (pipeline/moon.py): square it back.
      albedo = sample.r.mul(sample.r).mul(maps.manifest.texture.encoding.maxIOverF);
      const c = texture(maps.colour, uv);
      const colourSample = (options.seamFix === false ? c : c.grad(gradX, gradY)).toVar(
        'moonColourSample',
      );
      const [redLo, redHi] = maps.manifest.colour.ranges['643/566'];
      const blueLo = maps.manifest.colour.ranges['415/566'][0];
      const blueHi = maps.manifest.colour.ranges['415/566'][1];
      // Red, green and blue are 643, 566 and 415 nm, relative to 566 nm.
      tint = vec3(
        colourSample.r.mul(redHi - redLo).add(redLo),
        1,
        colourSample.g.mul(blueHi - blueLo).add(blueLo),
      );

      if (maps.gaps !== null) {
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
        const meanAlbedo = maps.manifest.calibration.discMeanIOverF;
        albedo = mix(albedo, float(meanAlbedo), gap);
      }
    }

    // The Moon is at the origin with a rotation-only placement, so the direction of the
    // world position is the smooth sphere's normal.
    const sphereNormal = normalize(positionWorld);
    let normal = sphereNormal;
    let sunVisible = null;
    let earthVisible = null;
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
      // Earth sets behind the horizon the same way, over its own angular radius.
      if (earthDirection !== null && earthshine !== null) {
        earthVisible = smoothstep(
          depression.negate().sub(earthshine.angularRadius),
          depression.negate().add(earthshine.angularRadius),
          dot(sphereNormal, earthDirection),
        );
      }
    }
    const view = normalize(cameraPosition.sub(positionWorld));
    const mu0 = dot(normal, sun);
    const mu = dot(normal, view);
    // I/F = (map's I/F at the standard geometry) × Hapke here / Hapke there, per tile.
    const ratio = albedo.div(standard);
    // Hapke is zero where the light is below the horizon or the surface faces away
    // (core/hapke.ts); step keeps that without branching.
    const lit = (cosLight: typeof mu0, cosG: typeof mu0) =>
      ratio
        .mul(hapkeNode(cosLight, mu, cosG, hapke))
        .mul(step(1e-6, cosLight))
        .mul(step(1e-6, mu));
    // Zero phase, seen from straight above: the map's own brightness.
    const zeroPhaseNormal = ratio.mul(hapkeNode(float(1), float(1), float(1), hapke));
    let radianceFactor;
    switch (options.shading) {
      case 'hapke': {
        let sunlit = lit(mu0, dot(sun, view));
        if (sunVisible !== null) sunlit = sunlit.mul(sunVisible);
        const even = options.evenLight ?? 0;
        // Even lighting: lit from behind the viewer everywhere at once, so i = e and g = 0.
        radianceFactor =
          typeof even === 'number' && even === 0 ? sunlit : mix(sunlit, lit(mu, float(1)), even);
        break;
      }
      case 'lambert':
        // Negative control: equal to Hapke at the disc centre at zero phase.
        radianceFactor = zeroPhaseNormal.mul(max(mu0, 0));
        break;
      case 'albedo':
        radianceFactor = zeroPhaseNormal;
        break;
    }
    let earthlit = null;
    if (options.shading === 'hapke' && earthDirection !== null && earthFactor !== null) {
      // Earthshine: the Moon scatters Earth's light as it scatters the Sun's, coloured by Earth.
      const fromEarth = lit(dot(normal, earthDirection), dot(earthDirection, view));
      earthlit = earthFactor.mul(earthVisible === null ? fromEarth : fromEarth.mul(earthVisible));
    }
    // With the labelled boost, earthshine is drawn brighter only where the Sun is down: its
    // extra weight fades out as the sunlit display value rises through SUNLIT_FADE, so the
    // sunlit Moon is untouched and the two meet without a seam (docs/stories/SS-13e.md).
    const sunDisplay = radianceFactor.mul(scale);
    const boost = mix(
      float(1),
      earthshineBoost,
      float(1).sub(smoothstep(0, SUNLIT_FADE, sunDisplay)),
    );
    const value = (
      earthlit === null ? vec3(sunDisplay) : vec3(sunDisplay).add(earthlit.mul(scale).mul(boost))
    ).mul(tint);
    const colour = gap === null ? value : mix(value, vec3(...GAP_COLOUR).mul(value), gap);
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
const terrainBase = siteUrl('terrain/');

/**
 * Inflates tiles stored gzip-compressed (tools/terrain/build.ts), recognised by the gzip header
 * 1f 8b; anything else, such as layer.json or the local server's uncompressed tiles, passes
 * through unchanged. GitHub Pages also gzips them in transit, which fetch undoes by itself.
 */
class GunzipPlugin {
  fetchData(url: string, options: RequestInit): Promise<Response> {
    return fetch(url, options).then(async (response) => {
      if (!response.ok) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const body =
        bytes[0] === 0x1f && bytes[1] === 0x8b
          ? new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
          : bytes;
      return new Response(body, { status: response.status });
    });
  }
}

/**
 * The Moon as streamed polygons: LOLA quantized-mesh tiles (tools/terrain/build.ts),
 * every vertex on a measured height, refined as the camera comes closer. The caller sets
 * the camera and resolution and calls `update()` once per frame before drawing.
 */
export function createMoonTerrain(options: MoonOptions, base = terrainBase): TilesRenderer {
  const tiles = new TilesRenderer(base);
  const radiusM = options.radiusKm * 1000;
  tiles.ellipsoid.radius.set(radiusM, radiusM, radiusM);
  tiles.registerPlugin(new GunzipPlugin());
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
