// Mars's surface (docs/stories/SS-14.md, W7): its albedo and colour (W3), drawn with the
// scattering law fitted to its measured brightness and each band calibrated to its geometric
// albedo (core/marsPhotometry.ts, public/data/mars/photometry.json), on the smooth ellipsoid or on
// its terrain tiles from Mars's own data site (W4) or `npm run local` (W5).
//
// The surface material is the Moon's (scenes/moon.ts), given Mars's map, bands, law and shape.
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  type Mesh,
} from 'three/webgpu';
import type { TilesRenderer } from '3d-tiles-renderer';
import { hapke } from '../core/hapke';
import { colourWeights } from '../core/moonColour';
import type { MarsEpoch } from '../core/mars';
import type { MarsPhotometry } from '../core/marsPhotometry';
import { decodeChannels } from './decode';
import {
  createMoonMesh,
  createMoonTerrain,
  type MoonOptions,
  type MoonShading,
  type MoonTextures,
  type UniformHapke,
} from './moon';
import { siteUrl } from '../site';

/** The fields of public/data/mars/albedo.json the app reads. */
interface MarsAlbedoManifest {
  readonly texture: {
    readonly file: string;
    readonly width: number;
    readonly height: number;
    readonly encoding: { readonly curve: 'sqrt'; readonly maxReflectance: number };
  };
  readonly colour: {
    readonly file: string;
    readonly width: number;
    readonly height: number;
    readonly bandsNm: readonly [440, 530, 750, 970];
    readonly ranges: {
      readonly '750/530': readonly [number, number];
      readonly '440/530': readonly [number, number];
      readonly '970/530': readonly [number, number];
    };
  };
}

export { MARS_TERRAIN_SITE, MARS_TILE_SPHERE_KM } from './marsSite';
import { MARS_TERRAIN_SITE, MARS_TILE_SPHERE_KM } from './marsSite';

/** Mars's map bands in the colour weights' column order: shorter, reference, mid, longer (nm). */
const MARS_BANDS_NM = [440, 530, 750, 970] as const;

const base = siteUrl('data/mars/');

async function loadJson<T>(file: string): Promise<T> {
  const response = await fetch(`${base}${file}`);
  if (!response.ok) throw new Error(`${file} failed to load: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** The scattering law and calibration, as tools/data/marsPhotometry.ts fitted them. */
export async function loadMarsPhotometry(): Promise<MarsPhotometry> {
  return loadJson<MarsPhotometry>('photometry.json');
}

/** The law as the material takes it: its I/F over μ0 at the map's own geometry is `standard`. */
export function marsHapke(photometry: MarsPhotometry): UniformHapke {
  const { law, normalisation } = photometry;
  const mu0 = Math.cos((normalisation.incidenceDeg * Math.PI) / 180);
  const mu = Math.cos((normalisation.emissionDeg * Math.PI) / 180);
  const cosG = Math.cos((normalisation.phaseDeg * Math.PI) / 180);
  const parameters = { w: law.w, b: law.b, c: law.c, bs0: law.bs0, hs: law.hs };
  // The map is I/F / cos(i) (Ody et al. 2012): I/F there is the map's value times μ0.
  return {
    kind: 'uniform',
    parameters,
    thetaBarDeg: law.thetaBarDeg,
    standard: hapke(mu0, mu, cosG, parameters, law.thetaBarDeg) / mu0,
  };
}

function texture(
  data: Uint8Array,
  width: number,
  height: number,
  rgba: boolean,
  anisotropy: number,
) {
  const tex = new DataTexture(data, width, height, rgba ? RGBAFormat : RedFormat, UnsignedByteType);
  tex.colorSpace = NoColorSpace; // reflectance and ratios, linear: not colours to manage
  tex.wrapS = RepeatWrapping; // longitude wraps
  tex.wrapT = ClampToEdgeWrapping; // latitude does not
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** Mars's albedo at 530 nm and its colour ratios, with the calibration factors to apply. */
export async function loadMarsTextures(
  maxAnisotropy: number,
  photometry: MarsPhotometry,
): Promise<MoonTextures> {
  const manifest = await loadJson<MarsAlbedoManifest>('albedo.json');
  const { width, height } = manifest.texture;
  const cw = manifest.colour.width;
  const ch = manifest.colour.height;
  const [[albedoBytes], colourChannels] = await Promise.all([
    decodeChannels(`${base}${manifest.texture.file}`, width, height, [0]),
    decodeChannels(`${base}${manifest.colour.file}`, cw, ch, [0, 1, 2]),
  ]);
  if (albedoBytes === undefined) throw new Error('albedo.webp decoded to nothing');
  let sum = 0;
  for (let i = 0; i < albedoBytes.length; i++) sum += albedoBytes[i] ?? 0;
  const [red, green, blue] = colourChannels;
  const rgba = new Uint8Array(cw * ch * 4);
  for (let i = 0; i < cw * ch; i++) {
    rgba[i * 4] = red?.[i] ?? 0;
    rgba[i * 4 + 1] = green?.[i] ?? 0;
    rgba[i * 4 + 2] = blue?.[i] ?? 0;
    rgba[i * 4 + 3] = 255;
  }
  const factor = (nm: number): number => {
    const c = photometry.calibration.find((x) => x.nm === nm);
    if (c === undefined) throw new Error(`photometry.json has no calibration at ${nm} nm`);
    return c.factor;
  };
  const ranges = manifest.colour.ranges;
  return {
    albedo: texture(albedoBytes, width, height, false, maxAnisotropy),
    colour: texture(rgba, cw, ch, true, maxAnisotropy),
    bands: {
      maxIOverF: manifest.texture.encoding.maxReflectance,
      // red = R(750)/R(530), green = R(440)/R(530), blue = R(970)/R(530) (pipeline/mars.py).
      red: ranges['750/530'],
      green: ranges['440/530'],
      blue: ranges['970/530'],
      weights: colourWeights(MARS_BANDS_NM),
      factors: [factor(440), factor(530), factor(750), factor(970)],
    },
    gaps: null,
    manifest: null,
    decodedMean: sum / albedoBytes.length,
  };
}

export interface MarsSurface {
  readonly epoch: MarsEpoch;
  readonly radiiKm: readonly [number, number, number];
  readonly albedo: MoonTextures | { readonly uniform: number };
  readonly hapke: UniformHapke;
  readonly shading: MoonShading;
  readonly mirrored?: boolean;
}

function options(surface: MarsSurface, radiusKm: number): MoonOptions {
  const [a, , c] = surface.radiiKm;
  return {
    epoch: surface.epoch,
    radiusKm,
    polarRatio: c / a,
    name: 'mars',
    albedo: surface.albedo,
    hapke: surface.hapke,
    shading: surface.shading,
    mirrored: surface.mirrored ?? false,
  };
}

/** The smooth ellipsoid, pck00011's radii: what the photometry checks are written for. */
export function createMarsMesh(surface: MarsSurface): Mesh {
  return createMoonMesh(options(surface, surface.radiiKm[0]));
}

/** Mars as streamed polygons from its data site, or from `npm run local`'s `base`. */
export function createMarsTerrain(surface: MarsSurface, base = MARS_TERRAIN_SITE): TilesRenderer {
  return createMoonTerrain(options(surface, MARS_TILE_SPHERE_KM), base);
}
