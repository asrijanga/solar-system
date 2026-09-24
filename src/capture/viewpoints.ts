// Canonical viewpoints for headless captures. Once a viewpoint has a committed baseline,
// it never changes: a new view gets a new id. The harness and the app both read this list.

export type SceneId = 'empty' | 'cube' | 'depth-test-10m' | 'depth-test-coplanar';

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
  readonly checks: readonly PixelCheck[];
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
    checks: [],
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
    camera: {
      position: [3.2, 2.4, 4],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fovDeg: 40,
      near: 0.1,
      far: 100,
    },
    reversedDepthBuffer: true,
    checks: [],
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
    checks: [frontWins],
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
    checks: [frontWins],
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
    checks: [backWinsTies],
    negativeControl: false,
  },
];

export function findViewpoint(id: string): Viewpoint | undefined {
  return viewpoints.find((v) => v.id === id);
}
