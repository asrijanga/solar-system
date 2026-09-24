// Canonical viewpoints for headless captures. Once a viewpoint has a committed baseline,
// it never changes: a new view gets a new id. The harness and the app both read this list.
import { raDecToScene } from '../core/frames.ts';
import type { MoonVantage } from '../core/moon.ts';

export type SceneId =
  'empty' | 'depth-test-10m' | 'depth-test-coplanar' | 'stars' | 'stars-mirrored' | 'moon';

/** Epoch ids in public/data/moon/ephemeris.json. */
export type MoonEpochId = 'full-2026-01' | 'first-quarter-2026-01';

/**
 * A Moon scene. The camera looks at the Moon's centre from `vantage`, lunar north up; the
 * harness rebuilds the same camera from these values in J2000, without the app's axis
 * mapping or three.js, to predict what each pixel must show.
 */
export interface MoonSetup {
  readonly epoch: MoonEpochId;
  readonly vantage: MoonVantage;
  /** From the Moon's centre, km. */
  readonly distanceKm: number;
  /** Vertical field of view, degrees. */
  readonly fovDeg: number;
  /** The Clementine map, or a uniform Lommel–Seeliger ϖ for photometry checks. */
  readonly albedo: 'map' | { readonly uniform: number };
  /** 'lambert' only in a negative control; 'albedo' is unlit, for checking the map itself. */
  readonly shading: 'lommel-seeliger' | 'lambert' | 'albedo';
  /** Negative control only: the map sampled at −longitude. */
  readonly mirrored: boolean;
  /** Explicit gradients at the ±180° wrap. Off only in a negative control. */
  readonly seamFix: boolean;
  /** Physical exposure, or the labelled boost (docs/stories/SS-4.md). */
  readonly stars: 'physical' | 'boosted';
}

/**
 * Checks on a Moon capture. The harness casts a ray through every pixel onto the sphere
 * itself, from ephemeris.json in J2000, and knows each pixel's longitude, latitude, μ0 and μ.
 */
export type MoonCheck =
  | {
      /**
       * Every pixel of the disc, more than `limbInsetPx` inside the limb, within `tolerance`
       * 8-bit levels of core/photometry.ts's Lommel–Seeliger value for a uniform ϖ. Proves the
       * TSL shading mirrors the unit-tested function, the sun direction, the terminator 90°
       * from the sub-solar point, the 1/r² and the exposure.
       */
      readonly kind: 'photometry';
      readonly name: string;
      readonly albedo: number;
      readonly tolerance: number;
      readonly minFraction: number;
      readonly limbInsetPx: number;
    }
  | {
      /**
       * An IAU Gazetteer feature must be brighter or darker than its surroundings: the mean
       * red channel within `coreKm` of it (great-circle, on the surface), against a ring, or
       * against the median of the whole lit disc. Coordinates are copied from
       * test/fixtures/iau-gazetteer-moon.json; a test asserts they still match.
       */
      readonly kind: 'feature';
      readonly name: string;
      readonly lonDeg: number;
      readonly latDeg: number;
      readonly coreKm: number;
      readonly against: readonly [number, number] | 'disc-median';
      readonly expect: 'brighter' | 'darker';
    }
  | {
      /** Where the sun is below the horizon by more than `minDepthDeg`, pixels are black. */
      readonly kind: 'night';
      readonly name: string;
      readonly minDepthDeg: number;
      readonly minFraction: number;
    }
  | {
      /**
       * No line along the ±180° meridian. For each image row the meridian crosses, the step
       * between the two pixels either side of it and the pixels around them, compared with
       * the same step at control positions a few pixels away in the same rows. Passes when
       * the meridian's mean step is at most `maxRatio` times the control's.
       */
      readonly kind: 'seam';
      readonly name: string;
      readonly maxRatio: number;
    };

/**
 * 'space' is true black, as space is. 'scaffold' is the SS-1 colour, kept for the harness
 * and depth viewpoints so a successful clear can never be mistaken for a failed one.
 */
export type Background = 'space' | 'scaffold';

/** Kilometres, in the scene's frame. */
export type Vec3 = readonly [number, number, number];

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  /** Vertical field of view, degrees. */
  readonly fovDeg: number;
  readonly near: number;
  readonly far: number;
}

/**
 * An assertion about the pixels of a capture, checked by the harness on every run. Region
 * and colour are in capture pixels and 8-bit sRGB. Passes when at least `minFraction` of the
 * region is within `tolerance` levels of `colour` on every channel.
 */
export interface PixelCheck {
  readonly name: string;
  readonly region: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly colour: readonly [number, number, number];
  readonly tolerance: number;
  readonly minFraction: number;
}

/**
 * Where a camera at the origin points on the sky, for the star-position checks. The harness
 * projects expected star positions with its own gnomonic projection from these values,
 * independently of the scene's axis mapping and of three.js.
 */
export interface SkyPointing {
  readonly raDeg: number;
  readonly decDeg: number;
  /** Vertical field of view, degrees. Celestial north is up. */
  readonly fovDeg: number;
}

/**
 * A star that must appear where an independent catalogue says it is: the brightest pixel
 * within `maxOffsetPx` of the expected position must be at least `minPeak` (0-255, max
 * channel). Coordinates are SIMBAD's, copied from test/fixtures/simbad-stars.json; a test
 * asserts they still match.
 */
export interface StarCheck {
  readonly name: string;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly maxOffsetPx: number;
  readonly minPeak: number;
}

export interface Viewpoint {
  readonly id: string;
  /** What the capture proves, in one sentence. */
  readonly description: string;
  readonly scene: SceneId;
  /** Canvas size in CSS pixels. Captures always run at devicePixelRatio 1. */
  readonly width: number;
  readonly height: number;
  /** Simulation time, as an ISO 8601 TDB epoch. null until the scene has a clock. */
  readonly epoch: string | null;
  /** null for scenes with nothing to look at. */
  readonly camera: CameraPose | null;
  readonly reversedDepthBuffer: boolean;
  readonly background: Background;
  /** For viewpoints with star checks: the camera's pointing on the sky. */
  readonly sky: SkyPointing | null;
  readonly checks: readonly PixelCheck[];
  readonly starChecks: readonly StarCheck[];
  /** For Moon scenes: what, and seen how. */
  readonly moon: MoonSetup | null;
  readonly moonChecks: readonly MoonCheck[];
  /**
   * A negative control: its checks are expected to FAIL, proving they can detect the fault.
   * If they pass, the harness errors. Never baselined.
   */
  readonly negativeControl: boolean;
}

/** Depth-test colours, unlit, so the check depends on depth alone. */
export const DEPTH_TEST_FRONT = [0xd0, 0x40, 0x40] as const;
export const DEPTH_TEST_BACK = [0x40, 0xa0, 0xd0] as const;

const DEPTH_TEST_CAMERA: CameraPose = {
  // 10,000 km out, looking at two face-on quads (see src/scenes/depthTest.ts).
  position: [0, 0, 10_000],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fovDeg: 30,
  near: 1,
  far: 100_000,
};

/** The central 20% of a 1024 x 1024 capture, well inside the front quad. */
const CENTRE = { x: 410, y: 410, width: 204, height: 204 };

const frontWins: PixelCheck = {
  name: 'front quad wins across the centre',
  region: CENTRE,
  colour: DEPTH_TEST_FRONT,
  tolerance: 2,
  minFraction: 0.999,
};

const backWinsTies: PixelCheck = {
  name: 'back quad wins exact ties across the centre',
  region: CENTRE,
  colour: DEPTH_TEST_BACK,
  tolerance: 2,
  minFraction: 0.999,
};

/** Orion, centred between the belt and the sword, celestial north up. */
const ORION_SKY: SkyPointing = { raDeg: 83.8, decDeg: -1.0, fovDeg: 40 };

const ORION_CAMERA: CameraPose = {
  position: [0, 0, 0],
  target: raDecToScene(ORION_SKY.raDeg, ORION_SKY.decDeg),
  // Scene +Y is the north celestial pole (core/frames.ts), so north is up on screen.
  up: [0, 1, 0],
  fovDeg: ORION_SKY.fovDeg,
  near: 0.1,
  far: 100,
};

/** SIMBAD ICRS J2000 (test/fixtures/simbad-stars.json). V magnitudes 0.5 to 2.2. */
const ORION_STARS: readonly StarCheck[] = [
  { name: 'Betelgeuse', raDeg: 88.79293899077537, decDeg: 7.407063995272694 },
  { name: 'Rigel', raDeg: 78.63446706693006, decDeg: -8.201638364722209 },
  { name: 'Bellatrix', raDeg: 81.28276355652378, decDeg: 6.3497032644440665 },
  { name: 'Saiph', raDeg: 86.93912016833333, decDeg: -9.66960491861111 },
  { name: 'Alnitak', raDeg: 85.18969642916667, decDeg: -1.9425723222222224 },
  { name: 'Alnilam', raDeg: 84.05338894077023, decDeg: -1.2019191358333312 },
  { name: 'Mintaka', raDeg: 83.00166705557675, decDeg: -0.29909510708333326 },
].map((s) => ({ ...s, maxOffsetPx: 2, minPeak: 100 }));

/** The Moon's radius from the PCK (public/data/moon/ephemeris.json), for choosing distances. */
const MOON_RADIUS_KM = 1737.4;

/** Four radii from the centre with a 40° field: the disc fills about 70% of the frame height. */
const MOON_SETUP: MoonSetup = {
  epoch: 'full-2026-01',
  vantage: { kind: 'earth' },
  distanceKm: 4 * MOON_RADIUS_KM,
  fovDeg: 40,
  albedo: 'map',
  shading: 'lommel-seeliger',
  mirrored: false,
  seamFix: true,
  stars: 'physical',
};

/**
 * ϖ = 8p for p = 0.12, the value that gives a uniform Moon the real Moon's geometric albedo
 * (core/photometry.ts).
 */
const UNIFORM_ALBEDO = 0.96;

/**
 * IAU Gazetteer features (test/fixtures/iau-gazetteer-moon.json). Radii and the qualitative
 * expectations are SS-5's texture tests (pipeline/test_moon.py), applied to rendered pixels.
 * The Apollo 11 site is compared with the median of the lit disc, as SS-5 compared it with
 * the map's median.
 */
const GAZETTEER_CHECKS: readonly MoonCheck[] = (
  [
    {
      name: 'Tycho',
      lonDeg: -11.2153,
      latDeg: -43.2958,
      coreKm: 30,
      against: [80, 160],
      expect: 'brighter',
    },
    {
      name: 'Copernicus',
      lonDeg: -20.0786,
      latDeg: 9.6209,
      coreKm: 30,
      against: [80, 160],
      expect: 'brighter',
    },
    {
      name: 'Aristarchus',
      lonDeg: -47.4901,
      latDeg: 23.7299,
      coreKm: 15,
      against: [40, 80],
      expect: 'brighter',
    },
    {
      name: 'Mare Crisium',
      lonDeg: 59.1037,
      latDeg: 16.1774,
      coreKm: 150,
      against: [350, 450],
      expect: 'darker',
    },
    {
      name: 'Statio Tranquillitatis',
      lonDeg: 23.4732,
      latDeg: 0.6741,
      coreKm: 20,
      against: 'disc-median',
      expect: 'darker',
    },
  ] as const
).map((f) => ({ kind: 'feature', ...f }));

const photometry = (name: string): MoonCheck => ({
  kind: 'photometry',
  name,
  albedo: UNIFORM_ALBEDO,
  tolerance: 2,
  minFraction: 0.99,
  limbInsetPx: 2,
});

/** Natural detail varies; a seam doubles the step or worse. */
const SEAM_CHECK: MoonCheck = { kind: 'seam', name: 'no line at ±180°', maxRatio: 1.5 };

const SPACE = {
  width: 1024,
  height: 1024,
  epoch: null,
  camera: null,
  reversedDepthBuffer: true,
  background: 'space',
  sky: null,
  checks: [],
  starChecks: [],
  moon: null,
  moonChecks: [],
  negativeControl: false,
} as const;

export const viewpoints: readonly Viewpoint[] = [
  {
    ...SPACE,
    id: 'clear',
    description:
      'The SS-1 clear colour. Proves the harness end to end: build, serve, WebGPU on SwiftShader, ready signal, capture, compare.',
    scene: 'empty',
    background: 'scaffold',
  },
  {
    ...SPACE,
    id: 'depth-reversed',
    description:
      'Two face-on quads 10 m apart seen from 10,000 km, reversed-Z (depth32float). The nearer quad must win, drawn first so a tie would lose.',
    scene: 'depth-test-10m',
    camera: DEPTH_TEST_CAMERA,
    background: 'scaffold',
    checks: [frontWins],
  },
  {
    ...SPACE,
    id: 'depth-standard',
    description:
      'Negative control: the same 10 m scene with standard depth (depth24plus). The nearer quad must fail to win, proving depth-reversed can tell the difference.',
    scene: 'depth-test-10m',
    camera: DEPTH_TEST_CAMERA,
    reversedDepthBuffer: false,
    background: 'scaffold',
    checks: [frontWins],
    negativeControl: true,
  },
  {
    ...SPACE,
    id: 'depth-tie',
    description:
      'Tie control: the quads coplanar with reversed-Z. The later-drawn back quad must win, proving the front quad in depth-reversed wins by resolved depth, not by draw order.',
    scene: 'depth-test-coplanar',
    camera: DEPTH_TEST_CAMERA,
    background: 'scaffold',
    checks: [backWinsTies],
  },
  {
    ...SPACE,
    id: 'orion',
    description:
      'Orion from the Bright Star Catalogue, celestial north up. Seven bright stars must land where SIMBAD puts them: Betelgeuse upper left, Rigel lower right, the belt running Alnitak to Mintaka from east (left) to west.',
    scene: 'stars',
    camera: ORION_CAMERA,
    sky: ORION_SKY,
    starChecks: ORION_STARS,
  },
  {
    ...SPACE,
    id: 'orion-mirrored',
    description:
      'Negative control: the same view with the sky mirrored, as a determinant −1 axis mapping would do. The star checks must fail, proving orion can see a mirrored sky.',
    scene: 'stars-mirrored',
    camera: ORION_CAMERA,
    sky: ORION_SKY,
    starChecks: ORION_STARS,
    negativeControl: true,
  },
  {
    ...SPACE,
    id: 'moon-full',
    description:
      'The full Moon of 2026-01-03 seen from Earth, lunar north up. Tycho, Copernicus and Aristarchus must be bright, Mare Crisium and the Apollo 11 site dark, each where the IAU Gazetteer puts it.',
    scene: 'moon',
    moon: MOON_SETUP,
    moonChecks: GAZETTEER_CHECKS,
  },
  {
    ...SPACE,
    id: 'moon-full-mirrored',
    description:
      'Negative control: the same view with the map mirrored east–west. The Gazetteer checks must fail, proving moon-full can see a mirrored Moon.',
    scene: 'moon',
    moon: { ...MOON_SETUP, mirrored: true },
    moonChecks: GAZETTEER_CHECKS,
    negativeControl: true,
  },
  {
    ...SPACE,
    id: 'moon-quarter',
    description:
      'The first-quarter Moon of 2026-01-26 seen from Earth. The terminator runs north–south near the centre, the lit half to the right, and the night side is black: no ambient light.',
    scene: 'moon',
    moon: { ...MOON_SETUP, epoch: 'first-quarter-2026-01' },
    moonChecks: [
      { kind: 'night', name: 'night side is black', minDepthDeg: 0.5, minFraction: 0.999 },
    ],
  },
  {
    ...SPACE,
    id: 'uniform-ls-full',
    description:
      'A uniform Moon (ϖ = 0.96, geometric albedo 0.12) at the full-Moon geometry. Every pixel must match Lommel–Seeliger from core/photometry.ts: a flat disc to the limb.',
    scene: 'moon',
    moon: { ...MOON_SETUP, albedo: { uniform: UNIFORM_ALBEDO } },
    moonChecks: [photometry('Lommel–Seeliger per pixel')],
  },
  {
    ...SPACE,
    id: 'uniform-lambert-full',
    description:
      'Negative control: the uniform Moon shaded by Lambert, equal to Lommel–Seeliger at the disc centre. The photometry check must fail, proving it can tell the two apart.',
    scene: 'moon',
    moon: { ...MOON_SETUP, albedo: { uniform: UNIFORM_ALBEDO }, shading: 'lambert' },
    moonChecks: [photometry('Lommel–Seeliger per pixel')],
    negativeControl: true,
  },
  {
    ...SPACE,
    id: 'uniform-ls-quarter',
    description:
      'The uniform Moon at first quarter. Every pixel must match Lommel–Seeliger, which puts the terminator exactly 90° from the sub-solar point.',
    scene: 'moon',
    moon: { ...MOON_SETUP, epoch: 'first-quarter-2026-01', albedo: { uniform: UNIFORM_ALBEDO } },
    moonChecks: [photometry('Lommel–Seeliger per pixel')],
  },
  {
    ...SPACE,
    id: 'moon-seam',
    description:
      'The ±180° meridian from over 165°E 25°N, unlit albedo, so the wrap crosses 2x2 pixel quads the way it does for anyone orbiting. The texture wrap must leave no line.',
    scene: 'moon',
    moon: { ...MOON_SETUP, vantage: { kind: 'over', lonDeg: 165, latDeg: 25 }, shading: 'albedo' },
    moonChecks: [SEAM_CHECK],
  },
  {
    ...SPACE,
    id: 'moon-seam-naive',
    description:
      'Negative control: the same view with plain texture sampling at the wrap. The seam check must fail, proving moon-seam can see a seam.',
    scene: 'moon',
    moon: {
      ...MOON_SETUP,
      vantage: { kind: 'over', lonDeg: 165, latDeg: 25 },
      shading: 'albedo',
      seamFix: false,
    },
    moonChecks: [SEAM_CHECK],
    negativeControl: true,
  },
  {
    ...SPACE,
    id: 'moon-limb',
    description:
      'From 1.5 radii with a 90° field, unlit albedo, over Mare Imbrium: the closest the app allows. Towards the limb the surface is seen edge-on, where anisotropic filtering keeps detail that isotropic filtering blurs. For eyes: no automated check.',
    scene: 'moon',
    moon: {
      ...MOON_SETUP,
      vantage: { kind: 'over', lonDeg: -16, latDeg: 33 },
      distanceKm: 1.5 * MOON_RADIUS_KM,
      fovDeg: 90,
      shading: 'albedo',
    },
  },
  {
    ...SPACE,
    id: 'app',
    description:
      'What the interactive app shows on load: the first-quarter Moon from Earth, lunar north up, stars at physical exposure (so none show).',
    scene: 'moon',
    moon: { ...MOON_SETUP, epoch: 'first-quarter-2026-01' },
  },
];

export function findViewpoint(id: string): Viewpoint | undefined {
  return viewpoints.find((v) => v.id === id);
}
