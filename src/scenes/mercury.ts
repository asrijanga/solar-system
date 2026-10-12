// Mercury's surface (docs/stories/SS-16.md, W7): its albedo and colour (W3), drawn with the
// scattering law fitted to its measured brightness and each band calibrated to its geometric
// albedo (core/mercuryPhotometry.ts, public/data/mercury/photometry.json), on the smooth
// ellipsoid or on its terrain tiles from Mercury's own data site (W4).
//
// The surface material is the Moon's (scenes/moon.ts), given Mercury's map, bands, law and shape.
// Mercury has three bands, 430, 750 and 1000 nm, against the material's four: in its column order
// (shorter, reference, mid, longer) they are 430, 750 (the reference) and 1000 nm; the fourth
// column's weight is zero (core/moonColour.ts colourWeights of three bands).
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
import { MERCURY_EXPOSURE } from '../core/photometry';
import { colourWeights } from '../core/moonColour';
import type { MercuryEpoch } from '../core/mercury';
import type { MercuryPhotometry } from '../core/mercuryPhotometry';
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

/** The fields of public/data/mercury/albedo.json the app reads. */
interface MercuryAlbedoManifest {
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
    readonly bandsNm: readonly [430, 750, 1000];
    readonly ranges: {
      readonly '1000/750': readonly [number, number];
      readonly '430/750': readonly [number, number];
    };
  };
}

/** The sphere the MDIS maps, the USGS DEM and MLA are given on, km: labels sit on it. */
export const MERCURY_DATUM_KM = 2439.4;

const MERCURY_BANDS_NM = [430, 750, 1000] as const;

const base = siteUrl('data/mercury/');

async function loadJson<T>(file: string): Promise<T> {
  const response = await fetch(`${base}${file}`);
  if (!response.ok) throw new Error(`${file} failed to load: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** The scattering law and calibration, as tools/data/mercuryPhotometry.ts fitted them. */
export async function loadMercuryPhotometry(): Promise<MercuryPhotometry> {
  return loadJson<MercuryPhotometry>('photometry.json');
}

/** The law as the material takes it. MDIS's maps are I/F at the normalisation geometry itself
 * (not I/F / cos i, as Mars's OMEGA map is), so `standard` is the law there, undivided. */
export function mercuryHapke(photometry: MercuryPhotometry): UniformHapke {
  const { law, normalisation } = photometry;
  const mu0 = Math.cos((normalisation.incidenceDeg * Math.PI) / 180);
  const mu = Math.cos((normalisation.emissionDeg * Math.PI) / 180);
  const cosG = Math.cos((normalisation.phaseDeg * Math.PI) / 180);
  const parameters = { w: law.w, b: law.b, c: law.c, bs0: law.bs0, hs: law.hs };
  return {
    kind: 'uniform',
    parameters,
    thetaBarDeg: law.thetaBarDeg,
    standard: hapke(mu0, mu, cosG, parameters, law.thetaBarDeg),
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

/** Mercury's albedo at 750 nm and its colour ratios, with the calibration factors to apply. */
export async function loadMercuryTextures(
  maxAnisotropy: number,
  photometry: MercuryPhotometry,
): Promise<MoonTextures> {
  const manifest = await loadJson<MercuryAlbedoManifest>('albedo.json');
  const { width, height } = manifest.texture;
  const cw = manifest.colour.width;
  const ch = manifest.colour.height;
  const [[albedoBytes], colourChannels] = await Promise.all([
    decodeChannels(`${base}${manifest.texture.file}`, width, height, [0]),
    decodeChannels(`${base}${manifest.colour.file}`, cw, ch, [0, 1, 2]),
  ]);
  if (albedoBytes === undefined) throw new Error('albedo.webp decoded to nothing');
  // The mean over measured pixels only: byte 0 is "not measured" (pipeline/mercury.py).
  let sum = 0;
  let measured = 0;
  for (let i = 0; i < albedoBytes.length; i++) {
    const b = albedoBytes[i] ?? 0;
    if (b > 0) {
      sum += b;
      measured++;
    }
  }
  const [red, green] = colourChannels;
  const rgba = new Uint8Array(cw * ch * 4);
  for (let i = 0; i < cw * ch; i++) {
    rgba[i * 4] = red?.[i] ?? 0;
    rgba[i * 4 + 1] = green?.[i] ?? 0;
    rgba[i * 4 + 2] = 0;
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
      // red = R(1000)/R(750), green = R(430)/R(750) (pipeline/mercury.py); no fourth band.
      red: ranges['1000/750'],
      green: ranges['430/750'],
      blue: [0, 0],
      weights: colourWeights(MERCURY_BANDS_NM),
      factors: [factor(430), factor(750), factor(1000), 0],
    },
    gaps: null,
    manifest: null,
    decodedMean: sum / measured,
  };
}

export interface MercurySurface {
  readonly epoch: MercuryEpoch;
  readonly radiiKm: readonly [number, number, number];
  readonly albedo: MoonTextures | { readonly uniform: number };
  readonly hapke: UniformHapke;
  readonly shading: MoonShading;
  readonly mirrored?: boolean;
}

export { MERCURY_TERRAIN_SITE } from './mercurySite';
import { MERCURY_TERRAIN_SITE } from './mercurySite';

function options(surface: MercurySurface, radiusKm: number): MoonOptions {
  const [a, , c] = surface.radiiKm;
  return {
    epoch: surface.epoch,
    radiusKm,
    polarRatio: c / a,
    name: 'mercury',
    exposure: MERCURY_EXPOSURE,
    albedo: surface.albedo,
    hapke: surface.hapke,
    shading: surface.shading,
    mirrored: surface.mirrored ?? false,
  };
}

/** The smooth ellipsoid, pck00011's radii: what the photometry checks are written for. */
export function createMercuryMesh(surface: MercurySurface): Mesh {
  return createMoonMesh(options(surface, surface.radiiKm[0]));
}

/**
 * Mercury as streamed polygons from its data site (W4): heights above the 2439.4 km sphere the
 * USGS DEM and MLA share (tools/terrain/mercury.ts).
 */
export function createMercuryTerrain(
  surface: MercurySurface,
  base = MERCURY_TERRAIN_SITE,
): TilesRenderer {
  return createMoonTerrain(options(surface, MERCURY_DATUM_KM), base);
}
