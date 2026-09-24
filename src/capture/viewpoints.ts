// Canonical viewpoints for headless captures. Once a viewpoint has a committed baseline,
// it never changes: a new view gets a new id. The harness and the app both read this list.
import { raDecToScene } from '../core/frames.ts';

export type SceneId =
  | 'empty'
  | 'cube'
  | 'depth-test-10m'
  | 'depth-test-coplanar'
  | 'stars'
  | 'stars-mirrored'
  | 'cube-and-stars';

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

const CUBE_CAMERA: CameraPose = {
  position: [3.2, 2.4, 4],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fovDeg: 40,
  near: 0.1,
  far: 100,
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

export const viewpoints: readonly Viewpoint[] = [
  {
    id: 'clear',
    description:
      'The SS-1 clear colour. Proves the harness end to end: build, serve, WebGPU on SwiftShader, ready signal, capture, compare.',
    scene: 'empty',
    width: 1024,
    height: 1024,
    epoch: null,
    camera: null,
    reversedDepthBuffer: true,
    background: 'scaffold',
    sky: null,
    checks: [],
    starChecks: [],
    negativeControl: false,
  },
  {
    id: 'cube',
    description:
      'A 1 km test cube lit by one directional light from a known pose. The reference object: three visible faces at three distinct brightnesses.',
    scene: 'cube',
    width: 1024,
    height: 1024,
    epoch: null,
    camera: CUBE_CAMERA,
    reversedDepthBuffer: true,
    background: 'scaffold',
    sky: null,
    checks: [],
    starChecks: [],
    negativeControl: false,
  },
  {
    id: 'depth-reversed',
    description:
      'Two face-on quads 10 m apart seen from 10,000 km, reversed-Z (depth32float). The nearer quad must win, drawn first so a tie would lose.',
    scene: 'depth-test-10m',
    width: 1024,
    height: 1024,
    epoch: null,
    camera: DEPTH_TEST_CAMERA,
    reversedDepthBuffer: true,
    background: 'scaffold',
    sky: null,
    checks: [frontWins],
    starChecks: [],
    negativeControl: false,
  },
  {
    id: 'depth-standard',
    description:
      'Negative control: the same 10 m scene with standard depth (depth24plus). The nearer quad must fail to win, proving depth-reversed can tell the difference.',
    scene: 'depth-test-10m',
    width: 1024,
    height: 1024,
    epoch: null,
    camera: DEPTH_TEST_CAMERA,
    reversedDepthBuffer: false,
    background: 'scaffold',
    sky: null,
    checks: [frontWins],
    starChecks: [],
    negativeControl: true,
  },
  {
    id: 'depth-tie',
    description:
      'Tie control: the quads coplanar with reversed-Z. The later-drawn back quad must win, proving the front quad in depth-reversed wins by resolved depth, not by draw order.',
    scene: 'depth-test-coplanar',
    width: 1024,
    height: 1024,
    epoch: null,
    camera: DEPTH_TEST_CAMERA,
    reversedDepthBuffer: true,
    background: 'scaffold',
    sky: null,
    checks: [backWinsTies],
    starChecks: [],
    negativeControl: false,
  },
  {
    id: 'orion',
    description:
      'Orion from the Bright Star Catalogue, celestial north up. Seven bright stars must land where SIMBAD puts them: Betelgeuse upper left, Rigel lower right, the belt running Alnitak to Mintaka from east (left) to west.',
    scene: 'stars',
    width: 1024,
    height: 1024,
    epoch: null,
    camera: ORION_CAMERA,
    reversedDepthBuffer: true,
    background: 'space',
    sky: ORION_SKY,
    checks: [],
    starChecks: ORION_STARS,
    negativeControl: false,
  },
  {
    id: 'orion-mirrored',
    description:
      'Negative control: the same view with the sky mirrored, as a determinant −1 axis mapping would do. The star checks must fail, proving orion can see a mirrored sky.',
    scene: 'stars-mirrored',
    width: 1024,
    height: 1024,
    epoch: null,
    camera: ORION_CAMERA,
    reversedDepthBuffer: true,
    background: 'space',
    sky: ORION_SKY,
    checks: [],
    starChecks: ORION_STARS,
    negativeControl: true,
  },
  {
    id: 'app',
    description:
      'What the interactive app shows on load: the test cube against the real sky on true black.',
    scene: 'cube-and-stars',
    width: 1024,
    height: 1024,
    epoch: null,
    camera: CUBE_CAMERA,
    reversedDepthBuffer: true,
    background: 'space',
    sky: null,
    checks: [],
    starChecks: [],
    negativeControl: false,
  },
];

export function findViewpoint(id: string): Viewpoint | undefined {
  return viewpoints.find((v) => v.id === id);
}
