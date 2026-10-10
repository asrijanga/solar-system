// What a world's page hands the shared app (src/main.ts): its scene, camera and the inputs orbit
// mode, the labels and the controls need. One module per world builds it (worlds/moon.ts,
// worlds/mars.ts), loaded only on that world's page (docs/stories/SS-13.md).
import { PerspectiveCamera, type Scene, type UniformNode } from 'three/webgpu';
import type { TilesRenderer } from '3d-tiles-renderer';
import type { CameraPose, Viewpoint } from '../capture/viewpoints';
import type { TileRange } from '../core/terrain';
import type { Labels, Landmark } from '../scenes/labels';
import { siteUrl } from '../site';

/** A world's own part of the controls panel. */
export interface WorldUi {
  /** The first line: what is shown, and when. */
  readonly caption: string;
  /** Adds the world's own links and switches before the shared ones (stars, orbit, labels). */
  readonly leading: (row: HTMLElement, notes: HTMLElement) => void;
  /** Adds the world's own links after the shared ones. */
  readonly trailing: (row: HTMLElement, notes: HTMLElement) => void;
  /** "About this view", a paragraph each. */
  readonly about: readonly string[];
  /** Shown before "About this view" in its summary (the Moon's gap key). */
  readonly summaryPrefix: readonly (string | Node)[];
}

export interface Stage {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** For world scenes: the radius orbit limits and fitting use, km. */
  readonly radiusKm: number | null;
  /** The highest ground above `radiusKm`, km: the floor where no terrain is under the camera. */
  readonly highestPointKm: number;
  /** Physical star exposure follows the pixel's solid angle, so it changes on resize. */
  readonly starExposure: UniformNode<'float', number> | null;
  /** The page's exposure over core/photometry.ts's EXPOSURE (Mercury's, W7); 1 if absent. */
  readonly exposureScale?: number;
  readonly albedoDecodedMean: number | null;
  /** Streamed terrain, when the view has relief, and which levels exist where. */
  readonly terrain: TilesRenderer | null;
  readonly terrainAvailable: readonly (readonly TileRange[])[] | null;
  /**
   * What orbit mode needs: the world's GM, the Sun's direction (scene), the albedo's texel size,
   * and Earth's centre (scene, km) for the earthrise tilt (docs/stories/SS-11e.md), where Earth
   * is the world's neighbour.
   */
  readonly orbitInputs: {
    readonly gmKm3PerS2: number;
    readonly sun: readonly [number, number, number];
    readonly albedoTexelKm: number | null;
    readonly earth: readonly [number, number, number] | null;
  } | null;
  /** Landmark labels (docs/stories/SS-15.md), and the landmarks with the body-to-scene rotation. */
  readonly labels: Labels | null;
  readonly landmarks: readonly Landmark[];
  readonly bodyToScene: readonly number[] | null;
  /** The world's controls; null for the harness's plain scenes. */
  readonly ui: WorldUi | null;
}

/** What building a stage needs from the app. */
export interface StageContext {
  readonly viewpoint: Viewpoint;
  readonly reversedDepth: boolean;
  readonly maxAnisotropy: number;
  /** `?capture=<id>`, or null in interactive use. */
  readonly captureId: string | null;
  readonly params: URLSearchParams;
}

export async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(siteUrl(path));
  if (!response.ok) throw new Error(`${path} failed to load: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export function createCamera(pose: CameraPose | null): PerspectiveCamera {
  if (pose === null) return new PerspectiveCamera(50, 1, 0.1, 10);
  const camera = new PerspectiveCamera(pose.fovDeg, 1, pose.near, pose.far);
  camera.position.set(...pose.position);
  camera.up.set(...pose.up);
  camera.lookAt(...pose.target);
  return camera;
}

/**
 * `?at=lon,lat,height,tilt`: start over any place instead of the page's view. Longitude and
 * latitude in degrees (east-positive, planetocentric), height in km above `radiusKm`, tilt in
 * degrees from straight down towards the world's north. Works with `?capture=<id>` too.
 */
export function placedAt(
  viewpoint: Viewpoint,
  params: URLSearchParams,
  radiusKm: number,
): Viewpoint {
  const at = params.get('at');
  if (at === null || viewpoint.body === null) return viewpoint;
  const [lonDeg, latDeg, heightKm, tiltDeg] = at.split(',').map(Number);
  if ([lonDeg, latDeg, heightKm].some((v) => v === undefined || !Number.isFinite(v))) {
    throw new Error(`?at= needs lon,lat,height[,tilt], got "${at}"`);
  }
  return {
    ...viewpoint,
    body: {
      ...viewpoint.body,
      vantage: { kind: 'over', lonDeg: lonDeg ?? 0, latDeg: latDeg ?? 0 },
      distanceKm: radiusKm + (heightKm ?? 0),
      fovDeg: 60,
      tiltDeg: Number.isFinite(tiltDeg) ? (tiltDeg ?? 0) : 0,
    },
  };
}
