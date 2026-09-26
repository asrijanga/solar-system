import {
  Color,
  FloatType,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  REVISION,
  RenderPipeline,
  Scene,
  Vector3,
  type UniformNode,
  type WebGPURenderer,
} from 'three/webgpu';
import { pass, uniform } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TilesRenderer } from '3d-tiles-renderer';
import type { CaptureReport } from './capture/protocol';
import {
  findViewpoint,
  type CameraPose,
  type MoonEpochId,
  type Viewpoint,
} from './capture/viewpoints';
import {
  bodyFixedToSceneMatrix,
  findEpoch,
  j2000ToScene,
  maxTiltDeg,
  moonViewPose,
  type MoonEphemeris,
} from './core/moon';
import {
  orbitHeading,
  randomOrbit,
  seededRandom,
  sharpHeightKm,
  upAndNorth,
  type Orbit,
} from './core/orbit';
import { OrbitFlight } from './scenes/orbitFlight';
import { physicalStarExposure, pixelSolidAngle } from './core/photometry';
import { decideSupport, refusalMessages, type Refusal } from './core/support';
import { minAltitudeKm, vertexSpacingKm, type TileRange } from './core/terrain';
import { METRE } from './core/units';
import { installErrorReporting, showFatal, watchDevice } from './debug/errors';
import { DebugOverlay } from './debug/overlay';
import { describeAdapter, logAdapter, probeAdapter, requestDevice } from './gpu/adapter';
import { createRenderer, isWebGPUBackend, WebGL2FallbackError } from './gpu/renderer';
import { createDepthTestScene } from './scenes/depthTest';
import { createEarth } from './scenes/earth';
import { createLabels, type Labels, type Landmark } from './scenes/labels';
import { createMoonMesh, createMoonTerrain, loadMoonTextures } from './scenes/moon';
import {
  createStarMesh,
  loadStarField,
  NOMINAL_STAR_EXPOSURE,
  STAR_BOOST,
  STAR_BOOST_MAGNITUDES,
} from './scenes/stars';
import { siteUrl } from './site';

/**
 * Scaffolding colour: deliberately not black and not three.js's default, so a successful
 * clear can never be mistaken for a blank or failed canvas. Kept for the harness and depth
 * viewpoints; everything that shows space uses true black.
 */
export const SCAFFOLD_COLOUR = '#1b3a5c';
/** Space is true black, and nothing here adds light it did not come by honestly. */
export const SPACE_COLOUR = '#000000';

/** Sharper than 2x costs fill rate for detail nobody can see. */
const MAX_PIXEL_RATIO = 2;

/** Orbit limits, in Moon radii from its centre. The smooth sphere stops at 1.5 radii. */
const MIN_DISTANCE_RADII = 1.5;
const MAX_DISTANCE_RADII = 60;
/**
 * Over terrain the camera never comes lower than this above the ground beneath it, km, and
 * where the data is coarser it stops higher (core/terrain.ts, minAltitudeKm). The real
 * camera, with collision against the terrain, is SS-11.
 */
const MIN_ALTITUDE_KM = 0.05;
/**
 * The highest point on the Moon above the 1737.4 km sphere, km: LOLA +10.757 km at 5.441°N,
 * 158.656°W (docs/stories/SS-8.md). Where no terrain is under the camera yet, it is kept
 * above this.
 */
const HIGHEST_POINT_KM = 10.757;
/** How long a capture waits for the terrain it needs to finish loading. */
const TERRAIN_LOAD_TIMEOUT_MS = 150_000;
/** On load the disc spans this fraction of the screen's shorter side. */
const FIT_FRACTION = 0.8;

const params = new URLSearchParams(location.search);
/** Set by the headless harness: `?capture=<viewpoint id>`. */
const captureId = params.get('capture');
const debug = params.has('debug');
/** `?epoch=full` shows the full Moon; the default is the app viewpoint's first quarter. */
const epochParam: MoonEpochId | null = params.get('epoch') === 'full' ? 'full-2026-01' : null;
/**
 * `?detail=approx`: below the finest measurement, the labelled approximation
 * (docs/stories/SS-10b.md), served only by `npm run local`. Off unless asked for; never in a check.
 */
const detailApprox = params.get('detail') === 'approx';
/**
 * `?orbit` starts in orbit mode (docs/stories/SS-11b.md); `?orbit=<seed>` repeats a given orbit.
 */
const orbitParam = params.get('orbit');
/**
 * `?relief=off` draws the smooth sphere without streamed terrain. The allocation gate uses it to
 * measure orbit mode's own frame code, which SwiftShader cannot draw over terrain to the
 * horizon fast enough (tools/perf/alloc.ts, docs/stories/SS-11b.md). Never used by a capture.
 */
const reliefOff = params.get('relief') === 'off';
/** Largest size a measured sample may take on screen in orbit mode, in device pixels. */
const ORBIT_MAX_PX_PER_SAMPLE = 3;
/** Time factors the orbit's speed button cycles through; 1 is real speed. */
const ORBIT_TIME_FACTORS = [1, 10, 100] as const;
/** Orbit height change per pixel of wheel scroll, as a power of e: 500 px doubles it. */
const ORBIT_WHEEL_PER_PIXEL = Math.LN2 / 500;
const APPROXIMATION_NOTE =
  'Approximation: below what was measured (about 10 m), small craters and roughness are generated from the Moon\u2019s statistics (NASA DSNE crater counts, NASA LRO stereo models). They are not the real craters here.';

/**
 * `?at=lon,lat,height,tilt`: start over any place instead of the Earth view. Longitude and
 * latitude in degrees (east-positive, planetocentric), height in km above the 1737.4 km sphere,
 * tilt in degrees from straight down towards lunar north. Works with `?capture=<id>` too, to
 * render that viewpoint's scene from there.
 */
/**
 * The way back to the world picker (docs/stories/SS-13.md). Interactive only: captures show the
 * world and nothing else.
 */
function addBackLink(): void {
  const back = document.createElement('a');
  back.id = 'back';
  back.href = '../';
  back.textContent = '\u2190 Solar System';
  document.body.append(back);
}

function withoutReliefIfAsked(viewpoint: Viewpoint | undefined): Viewpoint | undefined {
  if (!reliefOff || viewpoint?.moon == null) return viewpoint;
  return { ...viewpoint, moon: { ...viewpoint.moon, relief: false } };
}

function placedAt(viewpoint: Viewpoint): Viewpoint {
  const at = params.get('at');
  if (at === null || viewpoint.moon === null) return viewpoint;
  const [lonDeg, latDeg, heightKm, tiltDeg] = at.split(',').map(Number);
  if ([lonDeg, latDeg, heightKm].some((v) => v === undefined || !Number.isFinite(v))) {
    throw new Error(`?at= needs lon,lat,height[,tilt], got "${at}"`);
  }
  return {
    ...viewpoint,
    moon: {
      ...viewpoint.moon,
      vantage: { kind: 'over', lonDeg: lonDeg ?? 0, latDeg: latDeg ?? 0 },
      distanceKm: 1737.4 + (heightKm ?? 0),
      fovDeg: 60,
      tiltDeg: Number.isFinite(tiltDeg) ? (tiltDeg ?? 0) : 0,
    },
  };
}

/** The interactive app shows the app viewpoint's scene and pose. */
const INTERACTIVE = findViewpoint('app');

/** A frame counter the allocation test reads. A number property: incrementing never allocates. */
const stats = { frames: 0 };
window.__stats = stats;

function report(result: CaptureReport): void {
  // The first report wins: a later error must not overwrite a refusal, or vice versa.
  if (captureId !== null && window.__capture === undefined) window.__capture = result;
}

installErrorReporting((message) => report({ status: 'refused', reason: message }));

function showRefusal(refusal: Refusal): void {
  const { title, detail } = refusalMessages[refusal];
  document.getElementById('app')?.remove();
  const panel = document.getElementById('unsupported');
  const heading = panel?.querySelector('h1');
  const text = panel?.querySelector('p');
  if (panel && heading && text) {
    heading.textContent = title;
    text.textContent = detail;
    panel.dataset['refusal'] = refusal;
    panel.hidden = false;
  }
  console.warn(`[gpu] refused: ${refusal}`);
  report({ status: 'refused', reason: refusal });
}

interface Stage {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** For Moon scenes: the radius, for orbit limits and fitting. */
  readonly radiusKm: number | null;
  /** Physical star exposure follows the pixel's solid angle, so it changes on resize. */
  readonly starExposure: UniformNode<'float', number> | null;
  readonly albedoDecodedMean: number | null;
  /** Some albedo texel was never measured, so the gap key is shown. */
  readonly albedoGaps: boolean;
  /** Streamed LOLA terrain (SS-10), when the view has relief, and which levels exist where. */
  readonly terrain: TilesRenderer | null;
  readonly terrainAvailable: readonly (readonly TileRange[])[] | null;
  /** What orbit mode needs: the Moon's GM, the Sun's direction (scene), the albedo's texel size. */
  readonly orbitInputs: {
    readonly gmKm3PerS2: number;
    readonly sun: readonly [number, number, number];
    readonly albedoTexelKm: number | null;
  } | null;
  readonly caption: string | null;
  /** The terrain layer's name ('moon-local…' when `npm run local` serves it). */
  readonly terrainLayer: string | null;
  /** The labelled approximation is shown. */
  readonly approximated: boolean;
  /** 0 sunlight, 1 the labelled even lighting. */
  readonly evenLight: UniformNode<'float', number> | null;
  /** Landmark labels (docs/stories/SS-15.md), and the landmarks with the body-to-scene rotation. */
  readonly labels: Labels | null;
  readonly landmarks: readonly Landmark[];
  readonly bodyToScene: readonly number[] | null;
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(siteUrl(path));
  if (!response.ok) throw new Error(`${path} failed to load: HTTP ${response.status}`);
  return (await response.json()) as T;
}

function createCamera(pose: CameraPose | null): PerspectiveCamera {
  if (pose === null) return new PerspectiveCamera(50, 1, 0.1, 10);
  const camera = new PerspectiveCamera(pose.fovDeg, 1, pose.near, pose.far);
  camera.position.set(...pose.position);
  camera.up.set(...pose.up);
  camera.lookAt(...pose.target);
  return camera;
}

interface TerrainLayer {
  readonly path: string;
  readonly name: string;
  readonly available: TileRange[][];
  readonly approximated: boolean;
}

/** The measured terrain, or with `?detail=approx` the approximation layer where it is served. */
async function loadTerrainLayer(): Promise<TerrainLayer> {
  type Layer = { name: string; available: TileRange[][] };
  if (detailApprox) {
    try {
      const layer = await loadJson<Layer>('terrain-approx/layer.json');
      return { ...layer, path: 'terrain-approx/', approximated: true };
    } catch {
      console.warn('[terrain] no approximation layer here (only `npm run local` serves it)');
    }
  }
  const layer = await loadJson<Layer>('terrain/layer.json');
  return { ...layer, path: 'terrain/', approximated: false };
}

async function createStage(
  viewpoint: Viewpoint,
  reversedDepth: boolean,
  maxAnisotropy: number,
): Promise<Stage> {
  const plain = (scene: Scene): Stage => ({
    scene,
    camera: createCamera(viewpoint.camera),
    radiusKm: null,
    starExposure: null,
    albedoDecodedMean: null,
    albedoGaps: false,
    terrain: null,
    terrainAvailable: null,
    orbitInputs: null,
    caption: null,
    terrainLayer: null,
    approximated: false,
    evenLight: null,
    labels: null,
    landmarks: [],
    bodyToScene: null,
  });
  switch (viewpoint.scene) {
    case 'empty':
      return plain(new Scene());
    case 'depth-test-10m':
      return plain(createDepthTestScene(10 * METRE));
    case 'depth-test-coplanar':
      return plain(createDepthTestScene(0));
    case 'stars':
    case 'stars-mirrored': {
      const scene = new Scene();
      const mirrored = viewpoint.scene === 'stars-mirrored';
      const field = await loadStarField();
      scene.add(
        createStarMesh(field, { reversedDepth, mirrored, exposure: NOMINAL_STAR_EXPOSURE }),
      );
      return plain(scene);
    }
    case 'moon': {
      const setup = viewpoint.moon;
      if (setup === null) throw new Error(`${viewpoint.id} is a Moon scene without a Moon setup`);
      const [ephemeris, field, textures, layer, landmarkFile] = await Promise.all([
        loadJson<MoonEphemeris>('data/moon/ephemeris.json'),
        loadStarField(),
        setup.albedo === 'map' ? loadMoonTextures(maxAnisotropy) : null,
        setup.relief ? loadTerrainLayer() : null,
        loadJson<{ landmarks: Landmark[] }>('data/moon/landmarks.json'),
      ]);
      const epoch = findEpoch(ephemeris, (captureId === null ? epochParam : null) ?? setup.epoch);
      const radiusKm = ephemeris.body.radiiKm[0];
      const evenLight = uniform(setup.lighting === 'even' ? 1 : 0);
      const scene = new Scene();
      const moon = {
        epoch,
        radiusKm,
        albedo: textures ?? { uniform: setup.albedo === 'map' ? 0 : setup.albedo.uniform },
        shading: setup.shading,
        mirrored: setup.mirrored,
        seamFix: setup.seamFix,
        evenLight,
        reliefFlipped: setup.reliefFlipped,
      };
      // With relief the Moon is its measured shape, streamed as polygons (SS-10); without,
      // the smooth sphere the photometry checks are written for.
      const terrain = layer === null ? null : createMoonTerrain(moon, siteUrl(layer.path));
      scene.add(terrain === null ? createMoonMesh(moon) : terrain.group);
      const starExposure = uniform(0);
      scene.add(createStarMesh(field, { reversedDepth, exposure: starExposure }));
      // Earth in the sky, sunlit (docs/stories/SS-13b.md).
      scene.add(createEarth(epoch, ephemeris.earth));
      // Landmark labels, hidden until asked for (docs/stories/SS-15.md).
      const bodyToScene = bodyFixedToSceneMatrix(epoch);
      const labels = createLabels(
        landmarkFile.landmarks,
        bodyToScene,
        radiusKm,
        j2000ToScene(epoch.sunDirectionJ2000),
      );
      labels.group.visible = setup.labels;
      if (setup.labels) labels.set(true, null);
      scene.add(labels.group);

      // Near 10 m over terrain, where the camera comes down to a couple of kilometres; 1 km
      // over the sphere, whose surface is never closer than 870 km. Reversed-Z float depth
      // keeps full precision to any far plane (docs/stories/SS-3.md).
      const camera = new PerspectiveCamera(setup.fovDeg, 1, terrain === null ? 1 : 0.01, 1e7);
      const pose = moonViewPose(epoch, setup.vantage, setup.distanceKm);
      camera.position.set(...pose.position);
      camera.up.set(...pose.up);
      camera.lookAt(0, 0, 0);
      camera.rotateX((setup.tiltDeg * Math.PI) / 180);
      const when = epoch.utc.replace('T', ' ').slice(0, 16);
      return {
        scene,
        camera,
        radiusKm,
        starExposure,
        evenLight,
        labels,
        landmarks: landmarkFile.landmarks,
        bodyToScene,
        albedoDecodedMean: textures?.decodedMean ?? null,
        albedoGaps: (textures?.gaps ?? null) !== null,
        terrain,
        terrainAvailable: layer?.available ?? null,
        orbitInputs: {
          gmKm3PerS2: ephemeris.body.gmKm3PerS2,
          sun: j2000ToScene(epoch.sunDirectionJ2000),
          albedoTexelKm:
            textures === null ? null : (2 * Math.PI * radiusKm) / textures.manifest.texture.width,
        },
        terrainLayer: layer?.name ?? null,
        approximated: layer?.approximated ?? false,
        caption:
          `The Moon from Earth · ${when} UTC · phase angle ${epoch.phaseAngleDeg.toFixed(1)}°` +
          // `npm run local` serves the whole Moon at full measured detail (tools/local/server.ts).
          (layer?.name.startsWith('moon-local') === true
            ? ' · full measured detail, streamed locally'
            : '') +
          (layer?.approximated === true ? ' · APPROXIMATED below 10 m' : ''),
      };
    }
  }
}

async function start(): Promise<void> {
  const listed = captureId === null ? withoutReliefIfAsked(INTERACTIVE) : findViewpoint(captureId);
  const viewpoint = listed === undefined ? undefined : placedAt(listed);
  if (viewpoint === undefined) {
    report({ status: 'refused', reason: `unknown viewpoint: ${String(captureId)}` });
    return;
  }
  if (captureId === null) addBackLink();
  // The approximation is never checked against anything (docs/stories/SS-10b.md).
  if (
    captureId !== null &&
    detailApprox &&
    (viewpoint.moonChecks.length > 0 ||
      viewpoint.checks.length > 0 ||
      viewpoint.starChecks.length > 0)
  ) {
    report({ status: 'refused', reason: 'the approximation is never used in a checked capture' });
    return;
  }

  // Headless captures run on SwiftShader, a software adapter. Never allowed by default:
  // only in capture mode or with an explicit `?software`.
  const allowSoftwareAdapter = captureId !== null || params.has('software');

  const probe = await probeAdapter(allowSoftwareAdapter);
  const decision = decideSupport(probe.facts);
  if (!decision.ok || probe.adapter === null) {
    showRefusal(decision.ok ? 'no-adapter' : decision.refusal);
    return;
  }

  logAdapter(probe.adapter);
  const device = await requestDevice(probe.adapter);
  watchDevice(device);
  const canvas = document.getElementById('app') as HTMLCanvasElement;

  let renderer: WebGPURenderer;
  try {
    renderer = await createRenderer({
      canvas,
      device,
      antialias: true,
      reversedDepthBuffer: viewpoint.reversedDepthBuffer,
      trackTimestamp: debug,
    });
  } catch (error) {
    if (error instanceof WebGL2FallbackError) {
      showRefusal('webgl2-fallback');
      return;
    }
    throw error;
  }

  const background = viewpoint.background === 'space' ? SPACE_COLOUR : SCAFFOLD_COLOUR;
  renderer.setClearColor(new Color(background), 1);
  const stage = await createStage(
    viewpoint,
    viewpoint.reversedDepthBuffer,
    renderer.getMaxAnisotropy(),
  );
  const { scene, camera, starExposure, terrain } = stage;
  terrain?.setCamera(camera);
  /** 1 at physical exposure, STAR_BOOST with the labelled boost on. */
  const starBoost = new Float64Array([viewpoint.moon?.stars === 'boosted' ? STAR_BOOST : 1]);

  // Render through a scene pass, never renderer.render(). In three r184 the default path
  // draws the scene into an intermediate target for sRGB output whose depth is always
  // depth24plus, even with reversed-Z on, which throws away reversed-Z's precision.
  // PassNode switches its depth to float under reversed-Z (docs/stories/SS-3.md).
  const scenePass = pass(scene, camera);
  const pipeline = new RenderPipeline(renderer, scenePass);

  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Terrain refines against drawing-buffer pixels, the ones the screen shows.
    terrain?.setResolution(camera, canvas.width, canvas.height);
    stage.labels?.setViewport(height, camera.fov);
    if (starExposure !== null) {
      starExposure.value =
        physicalStarExposure(pixelSolidAngle(camera.fov, height)) * (starBoost[0] ?? 1);
    }
  };

  if (captureId !== null) {
    // Capture mode: exactly one frame, no clock, no controls. Ready means the GPU has
    // finished it and the compositor has had a chance to present it.
    resize();
    const orbitSeed = viewpoint.moon?.orbitSeed ?? null;
    if (orbitSeed !== null) seededOrbitFlight(stage, camera, canvas.height, orbitSeed);
    const orbitFrom = viewpoint.moon?.orbitFrom ?? null;
    if (orbitFrom !== null) {
      const minHeight = sharpOrbitHeightKm(stage, camera, canvas.height);
      const orbit =
        minHeight === null ? null : orbitOverLandmark(stage, orbitFrom.landmark, minHeight);
      if (orbit !== null && stage.radiusKm !== null) {
        new OrbitFlight(
          camera,
          { ...orbit, theta0: (orbitFrom.angleDeg * Math.PI) / 180 },
          stage.radiusKm,
        );
      }
    }
    if (terrain !== null && !(await terrainLoaded(terrain, camera))) {
      report({ status: 'refused', reason: 'terrain did not finish loading' });
      return;
    }
    pipeline.render();
    await device.queue.onSubmittedWorkDone();
    await new Promise(requestAnimationFrame);
    const { vendor, architecture, isFallbackAdapter } = describeAdapter(probe.adapter);
    report({
      status: 'ready',
      viewpoint: viewpoint.id,
      backend: isWebGPUBackend(renderer) ? 'webgpu' : 'other',
      threeRevision: REVISION,
      sceneDepth: scenePass.renderTarget.depthTexture?.type === FloatType ? 'float32' : 'other',
      adapter: { vendor, architecture, isFallbackAdapter },
      canvas: { width: canvas.width, height: canvas.height },
      devicePixelRatio: window.devicePixelRatio,
      albedoDecodedMean: stage.albedoDecodedMean,
      terrainTiles: terrain === null ? null : terrain.visibleTiles.size,
    });
    return;
  }

  const controls = new OrbitControls(camera, canvas);
  if (viewpoint.camera !== null) controls.target.set(...viewpoint.camera.target);
  /** Pitch applied after the controls aim at the target: identity unless a Moon view tilts. */
  let tilt = new Quaternion();
  if (stage.radiusKm !== null) {
    // Fit the disc to the screen's shorter side, keeping the viewpoint's direction; `?at=`
    // keeps the height it asked for.
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360) * Math.min(1, aspect);
    const distance = stage.radiusKm / Math.sin(Math.atan(FIT_FRACTION * tanHalf));
    if (!params.has('at')) camera.position.setLength(distance);
    controls.minDistance = MIN_DISTANCE_RADII * stage.radiusKm;
    controls.maxDistance = MAX_DISTANCE_RADII * stage.radiusKm;
    // Orbiting stays centred on the Moon: panning would move the target off its centre.
    controls.enablePan = false;
    const groundKm = new Float64Array([stage.radiusKm]);
    if (terrain !== null && stage.terrainAvailable !== null) {
      followGround(controls, terrain, stage.terrainAvailable, stage.radiusKm, groundKm);
    }
    tilt = createTilt(controls, canvas, viewpoint.moon?.tiltDeg ?? 0, groundKm);
  }
  controls.enableDamping = true;
  controls.update();

  // Orbit mode (docs/stories/SS-11b.md): the controls step aside while the camera flies.
  let flight: OrbitFlight | null = null;
  const northUp = camera.up.clone();
  const begin = (created: OrbitFlight | null): OrbitFlight | null => {
    if (created === null) return null;
    controls.enabled = false;
    flight = created;
    return created;
  };
  // The Orbit button starts over a known landmark heading north (ORBIT_START_LANDMARK), at the
  // height the gestures left the camera (never below the lowest sharp one).
  const startFromView = (): OrbitFlight | null => {
    const minHeight = sharpOrbitHeightKm(stage, camera, canvas.height);
    if (minHeight === null || stage.radiusKm === null) return null;
    const height = Math.max(camera.position.length() - stage.radiusKm, minHeight);
    const orbit = orbitOverLandmark(stage, ORBIT_START_LANDMARK, height);
    return orbit === null ? null : begin(new OrbitFlight(camera, orbit, stage.radiusKm));
  };
  const stopOrbit = (): void => {
    flight?.release();
    flight = null;
    camera.up.copy(northUp);
    controls.enabled = true;
    controls.update();
  };
  // While orbiting, pinch or scroll raises and lowers the orbit, between the lowest sharp height
  // and the controls' farthest distance. Gestures only: never in the frame loop.
  let onOrbitHeight: (() => void) | null = null;
  const zoomOrbit = (factor: number): void => {
    const minHeight = sharpOrbitHeightKm(stage, camera, canvas.height);
    if (flight === null || minHeight === null || stage.radiusKm === null) return;
    const maxHeight = (MAX_DISTANCE_RADII - 1) * stage.radiusKm;
    const height = flight.describe().heightKm * factor;
    flight.setHeight(Math.min(Math.max(height, minHeight), maxHeight));
    onOrbitHeight?.();
  };
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (flight === null) return;
      event.preventDefault();
      zoomOrbit(Math.exp(event.deltaY * ORBIT_WHEEL_PER_PIXEL));
    },
    { passive: false },
  );
  const pinch = new Map<number, { x: number; y: number }>();
  const spread = (): number => {
    const [a, b] = [...pinch.values()];
    return a === undefined || b === undefined ? 0 : Math.hypot(a.x - b.x, a.y - b.y);
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch')
      pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pinch.has(event.pointerId)) return;
    const before = spread();
    pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = spread();
    // Fingers apart: the orbit comes down; together: it goes up.
    if (flight !== null && pinch.size === 2 && before > 0 && after > 0) zoomOrbit(before / after);
  });
  const lift = (event: PointerEvent): void => {
    pinch.delete(event.pointerId);
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  const overlay = debug ? new DebugOverlay(renderer, device.features.has('timestamp-query')) : null;

  // Resizing happens here, never in the frame loop: it stores fractional numbers (aspect,
  // star exposure) in object fields, which allocates. ResizeObserver callbacks run after
  // layout and before paint, so the next frame already renders at the new size. The
  // observer also fires once on observe(), which sizes the first frame.
  resize();
  new ResizeObserver(resize).observe(canvas);

  if (stage.caption !== null) {
    const { evenLight } = stage;
    const describeOrbit = (f: OrbitFlight): string => {
      const { heightKm, speedKmS } = f.describe();
      const minHeight = sharpOrbitHeightKm(stage, camera, canvas.height) ?? 0;
      const floor =
        heightKm <= minHeight + 0.5
          ? 'the lowest height the website\u2019s terrain stays sharp from on this screen'
          : `pinch or scroll to change it; ${minHeight.toFixed(0)} km is the lowest the terrain stays sharp from`;
      return `Orbiting ${heightKm.toFixed(0)} km up at ${speedKmS.toFixed(2)} km/s: ${floor}.`;
    };
    const ui = createMoonControls(
      stage.caption,
      stage.terrainLayer,
      stage.approximated,
      stage.albedoGaps,
      {
        onOrbit: (on) => {
          if (!on) {
            stopOrbit();
            return null;
          }
          const f = startFromView();
          return f === null ? null : describeOrbit(f);
        },
        onTimeFactor: (factor) => {
          if (flight !== null) flight.setTimeFactor(factor);
        },
        startInOrbit:
          orbitParam === null
            ? null
            : () => {
                const seed =
                  orbitParam === '' ? Math.floor(Math.random() * 2 ** 31) : Number(orbitParam);
                const f = begin(
                  seededOrbitFlight(stage, camera, canvas.height, Number.isFinite(seed) ? seed : 0),
                );
                return f === null ? null : describeOrbit(f);
              },
        onLabels: (on) => {
          const labels = stage.labels;
          if (labels === null) return;
          // The fade runs on three's own node clock, which the shader reads as `time`.
          labels.group.visible = true;
          labels.set(on, nodeClockSeconds(renderer));
        },
        onBoost: (boosted) => {
          starBoost[0] = boosted ? STAR_BOOST : 1;
          resize();
        },
        onEvenLight: (even) => {
          if (evenLight !== null) evenLight.value = even ? 1 : 0;
        },
      },
    );
    onOrbitHeight = () => {
      if (flight !== null) ui.setOrbitLine(describeOrbit(flight));
    };
  }

  // The per-frame path. It allocates nothing: no `new`, no closures, no array or object
  // literals, and no fractional numbers stored in captured variables, which V8 boxes on the
  // heap on every write. Timing state lives in a Float64Array for that reason.
  // tools/perf/alloc.ts measures this on every PR.
  const clock = new Float64Array(1);
  clock[0] = -1; // previous frame's timestamp, ms
  const frame = (time: number): void => {
    if (stats.frames === 0) overlay?.firstFrame(performance.now());
    if (flight === null) {
      controls.update();
      // The controls aimed the camera at the Moon's centre; pitch it up by the tilt.
      camera.quaternion.multiply(tilt);
    } else {
      flight.frame(time);
    }
    if (terrain !== null) {
      camera.updateMatrixWorld();
      terrain.update();
    }
    if (overlay === null) {
      pipeline.render();
    } else {
      const start = performance.now();
      pipeline.render();
      const previous = clock[0] ?? -1;
      if (previous >= 0) overlay.frame(time, time - previous, performance.now() - start);
      clock[0] = time;
    }
    stats.frames++;
  };
  await renderer.setAnimationLoop(frame);
  document.documentElement.dataset['ready'] = 'true';
}

/**
 * Capture mode: refine the terrain for this camera until nothing more is queued, downloading
 * or parsing for several frames in a row. False if that takes longer than the timeout.
 */
async function terrainLoaded(terrain: TilesRenderer, camera: PerspectiveCamera): Promise<boolean> {
  const deadline = performance.now() + TERRAIN_LOAD_TIMEOUT_MS;
  camera.updateMatrixWorld();
  let settled = 0;
  while (settled < 5) {
    if (performance.now() > deadline) return false;
    terrain.update();
    await new Promise(requestAnimationFrame);
    settled = terrain.loadProgress === 1 && terrain.visibleTiles.size > 0 ? settled + 1 : 0;
  }
  return true;
}

/**
 * Over terrain, orbit limits and speeds follow the ground under the camera. At the start and
 * end of each gesture, never per frame: the minimum distance becomes the ground beneath plus
 * the lowest altitude the data there supports, zooming moves a fixed fraction of the altitude
 * rather than of the distance to the centre, and a drag moves the ground about as far as the
 * finger.
 */
function followGround(
  controls: OrbitControls,
  terrain: TilesRenderer,
  available: readonly (readonly TileRange[])[],
  radiusKm: number,
  groundKm: Float64Array,
): void {
  const camera = controls.object as PerspectiveCamera;
  const raycaster = new Raycaster();
  (raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  const down = new Vector3();
  const body = new Vector3();
  // Scene to body-fixed metres: the terrain group's placement, inverted.
  const sceneToBody = terrain.group.matrixWorld.clone().invert();
  const follow = (): void => {
    const distance = camera.position.length();
    down.copy(camera.position).negate().normalize();
    raycaster.set(camera.position, down);
    const hit = raycaster.intersectObject(terrain.group, true)[0];
    const ground = hit === undefined ? radiusKm + HIGHEST_POINT_KM : distance - hit.distance;
    groundKm[0] = ground;
    body.copy(camera.position).applyMatrix4(sceneToBody);
    const lonDeg = (Math.atan2(body.y, body.x) * 180) / Math.PI;
    const latDeg = (Math.asin(body.z / body.length()) * 180) / Math.PI;
    const lowest = Math.max(
      MIN_ALTITUDE_KM,
      minAltitudeKm(available, lonDeg, latDeg, radiusKm, camera.fov),
    );
    controls.minDistance = ground + lowest;
    const altitude = Math.max(distance - ground, lowest);
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    controls.zoomSpeed = Math.min(1, altitude / distance);
    controls.rotateSpeed = Math.min(1, (tanHalf * altitude) / (Math.PI * radiusKm));
  };
  controls.addEventListener('start', follow);
  controls.addEventListener('end', follow);
  follow();
}

/** Dragging the full height of the screen tilts the view this far, degrees. */
const TILT_PER_SCREEN_DEG = 120;

/**
 * Tilting towards the horizon: two fingers dragged up together, or a mouse dragged up with
 * the right button or with shift held. The tilt is a pitch about the camera's own right axis,
 * applied every frame after the controls aim the camera at the Moon's centre, and limited by
 * maxTiltDeg so the view never leaves the Moon. Recomputed only on gestures, never per frame.
 * Returns the quaternion the frame loop applies.
 */
function createTilt(
  controls: OrbitControls,
  canvas: HTMLCanvasElement,
  initialDeg: number,
  groundKm: Float64Array,
): Quaternion {
  const camera = controls.object as PerspectiveCamera;
  const quaternion = new Quaternion();
  const axis = new Vector3(1, 0, 0);
  const tilt = new Float64Array([initialDeg]);
  const set = (deg: number): void => {
    const max = maxTiltDeg(camera.position.length(), groundKm[0] ?? 0);
    tilt[0] = Math.min(Math.max(deg, 0), max);
    quaternion.setFromAxisAngle(axis, ((tilt[0] ?? 0) * Math.PI) / 180);
  };
  const perPixel = (): number => TILT_PER_SCREEN_DEG / Math.max(1, canvas.clientHeight);

  const touches = new Map<number, { x: number; y: number }>();
  let mouseY: number | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    } else if (event.button === 2 || (event.button === 0 && event.shiftKey)) {
      mouseY = event.clientY;
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch') {
      if (mouseY === null) return;
      set((tilt[0] ?? 0) - (event.clientY - mouseY) * perPixel());
      mouseY = event.clientY;
      return;
    }
    const moved = touches.get(event.pointerId);
    if (moved === undefined) return;
    const other = [...touches].find(([id]) => id !== event.pointerId)?.[1];
    if (touches.size === 2 && other !== undefined) {
      // Both fingers moving up or down together tilt; a pinch (the gap between them
      // changing more than they move) is left to the controls' zoom.
      const dy = event.clientY - moved.y;
      const gapBefore = Math.hypot(moved.x - other.x, moved.y - other.y);
      const gapAfter = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (Math.abs(gapAfter - gapBefore) < 0.5 * Math.abs(dy)) {
        // Each finger reports its own moves, so each carries half the tilt.
        set((tilt[0] ?? 0) - 0.5 * dy * perPixel());
      }
    }
    moved.x = event.clientX;
    moved.y = event.clientY;
  });
  const release = (event: PointerEvent): void => {
    touches.delete(event.pointerId);
    if (event.pointerType !== 'touch') mouseY = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  // Zooming out lowers the limit; keep the tilt inside it.
  controls.addEventListener('end', () => set(tilt[0] ?? 0));
  set(initialDeg);
  return quaternion;
}

/**
 * A two-state switch. While it is on, `onNote` names the departure from physics, on screen,
 * for as long as it lasts.
 */
function createToggle(
  labels: { readonly off: string; readonly on: string },
  onNote: string | null,
  notes: HTMLElement,
  onChange: (on: boolean) => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  const note = document.createElement('p');
  note.className = 'note warning';
  note.textContent = onNote ?? '';
  let on = false;
  const set = (value: boolean): void => {
    on = value;
    button.textContent = on ? labels.on : labels.off;
    button.setAttribute('aria-pressed', String(on));
    if (on && onNote !== null) notes.append(note);
    else note.remove();
    onChange(on);
  };
  button.addEventListener('click', () => set(!on));
  set(false);
  return button;
}

/**
 * The lowest orbit height, km, for this stage and screen: where the nearest ground in view shows
 * each measured sample at most ORBIT_MAX_PX_PER_SAMPLE device pixels across. The sample is the
 * finest terrain the whole Moon has, or half the albedo map's texel, whichever is coarser:
 * brightness varies more gently than shape, so it is allowed twice the size on screen. null
 * without a Moon.
 */
function sharpOrbitHeightKm(
  stage: Stage,
  camera: PerspectiveCamera,
  heightPx: number,
): number | null {
  const inputs = stage.orbitInputs;
  const radiusKm = stage.radiusKm;
  if (inputs === null || radiusKm === null) return null;
  let finest = 0;
  (stage.terrainAvailable ?? []).forEach((ranges, level) => {
    const whole = ranges.some(
      (r) =>
        r.startX === 0 &&
        r.startY === 0 &&
        r.endX === 2 ** (level + 1) - 1 &&
        r.endY === 2 ** level - 1,
    );
    if (whole) finest = level;
  });
  const terrainKm = stage.terrainAvailable === null ? 0 : vertexSpacingKm(finest, radiusKm);
  const sampleKm = Math.max(terrainKm, (inputs.albedoTexelKm ?? 0) / 2, 0.001);
  const fov = (camera.fov * Math.PI) / 180;
  return sharpHeightKm(radiusKm, sampleKm, fov / heightPx, fov, ORBIT_MAX_PX_PER_SAMPLE);
}

/**
 * The random orbit `?orbit=<seed>` and the captures fly (core/orbit.ts): 1 to 1.5 times the
 * lowest sharp height, starting over ground where the Sun is 8° to 35° up. null without a Moon.
 */
function seededOrbitFlight(
  stage: Stage,
  camera: PerspectiveCamera,
  heightPx: number,
  seed: number,
): OrbitFlight | null {
  const minHeight = sharpOrbitHeightKm(stage, camera, heightPx);
  if (minHeight === null || stage.orbitInputs === null || stage.radiusKm === null) return null;
  const { gmKm3PerS2, sun } = stage.orbitInputs;
  const orbit = randomOrbit(seededRandom(seed), stage.radiusKm, gmKm3PerS2, minHeight, sun);
  return new OrbitFlight(camera, orbit, stage.radiusKm);
}

/**
 * three's node clock, seconds: the value the TSL `time` node has this frame. It is internal to
 * three r184 (NodeFrame.time, pinned); null if a future version moves it, and then labels switch
 * without a fade rather than fading from the wrong moment.
 */
function nodeClockSeconds(renderer: unknown): number | null {
  const time = (renderer as { _nodes?: { nodeFrame?: { time?: unknown } } })._nodes?.nodeFrame
    ?.time;
  return typeof time === 'number' ? time : null;
}

/** Where the Orbit button starts (docs/stories/SS-15.md). */
const ORBIT_START_LANDMARK = 'Albategnius';

/**
 * A circular orbit from over a landmark (public/data/moon/landmarks.json), heading due north
 * along its meridian, `heightKm` up. Null without a Moon or if the landmark is unknown.
 */
function orbitOverLandmark(stage: Stage, name: string, heightKm: number): Orbit | null {
  const landmark = stage.landmarks.find((l) => l.name === name);
  const m = stage.bodyToScene;
  if (
    landmark === undefined ||
    m === null ||
    stage.orbitInputs === null ||
    stage.radiusKm === null
  ) {
    return null;
  }
  const toScene = (v: readonly [number, number, number]): [number, number, number] => [
    (m[0] ?? 0) * v[0] + (m[1] ?? 0) * v[1] + (m[2] ?? 0) * v[2],
    (m[3] ?? 0) * v[0] + (m[4] ?? 0) * v[1] + (m[5] ?? 0) * v[2],
    (m[6] ?? 0) * v[0] + (m[7] ?? 0) * v[1] + (m[8] ?? 0) * v[2],
  ];
  const { up, north } = upAndNorth(landmark.lonDeg, landmark.latDeg);
  return orbitHeading(
    toScene(up),
    toScene(north),
    stage.radiusKm,
    stage.orbitInputs.gmKm3PerS2,
    heightKm,
  );
}

interface MoonControlHandlers {
  /** Orbit mode on or off; returns the line describing the orbit, or null. */
  readonly onOrbit: (on: boolean) => string | null;
  readonly onTimeFactor: (factor: number) => void;
  /** Set when the page asked for `?orbit`: starts it, returning the description. */
  readonly startInOrbit: (() => string | null) | null;
  readonly onBoost: (boosted: boolean) => void;
  /** Landmark labels on or off (docs/stories/SS-15.md). */
  readonly onLabels: (on: boolean) => void;
  readonly onEvenLight: (even: boolean) => void;
}

const ABOUT = [
  'Lighting: sun is real sunlight at this date. The night side, and the far side whenever it faces away from the Sun, are black: the Moon has no air to scatter light, and earthshine is not drawn yet.',
  'Lighting: even shows every point at full-Moon brightness, as if lit from behind you everywhere at once. Not physical, but it shows the whole surface.',
  'Stars: physical is a real exposure. Next to the sunlit Moon, stars are far too faint to show, as in every Apollo photograph. Boosted makes them 100,000 times brighter.',
  'Surface brightness comes from two NASA missions. Clementine (1994) photographed most of the Moon. Near the poles the Sun is always low, so its pictures there show shadows, and it never saw crater floors sunlight never reaches. Poleward of 70° the map is instead LOLA (Lunar Reconnaissance Orbiter), which measured brightness with its own laser, blended with Clementine between 65° and 75°. The few small places Clementine missed elsewhere (0.06% of the map) are filled from LOLA\u2019s global laser map, which is coarser (3 km), matched to Clementine around each one.',
  "Shape: the surface is polygons, every corner on a height measured by LOLA, the Lunar Reconnaissance Orbiter's laser altimeter. Zoom in and finer polygons stream in: vertices about 670 m apart everywhere, 41 m around the crater Albategnius from LOLA's finest data, and 10 m on its floor and central peak from the stereo cameras of Japan's Kaguya orbiter. Slopes catch the Sun and shade away from it; at full Moon the relief nearly vanishes, as it does in reality. Heights are true scale. Shadows cast across the ground are not drawn yet.",
  'Orbit: starts over the crater Albategnius and heads due north along its meridian, over the central highlands and the Apennines, across the north pole, down the far side and back, with Earth rising ahead over the south pole. Pinch or scroll first to choose the height; it never goes below the height the terrain stays sharp from.',
  'Labels: names and places from the IAU Gazetteer of Planetary Nomenclature. Each label rises and sets with its landmark, dims on the night side, and small features wait until you are close enough for them to matter.',
  'Earth: where it really is at this date, at its measured size, lit by the same Sun. Until Earth has its own data it is a plain sphere of its measured brightness (geometric albedo 0.434, NASA): no clouds, oceans or colour yet.',
  'Moving: drag to fly over the surface, pinch or scroll to change height, and drag two fingers up (with a mouse, right-drag or shift-drag) to tilt towards the horizon. How low you can go depends on how finely the ground beneath was measured.',
  'Detail (local mode only): measured shows only measurements. + approximation adds, below about 10 m, small craters and roughness generated from the Moon\u2019s statistics: crater numbers and shapes from NASA\u2019s lunar environment specification, roughness from NASA\u2019s 2 m stereo terrain models. The surface still passes through every measurement, but these are not the real craters there, and the screen says so while it is on.',
];
const GAP_NOTE =
  'Magenta marks the places no mission measured. They are shown as missing, not filled in.';

/** The caption, the epoch switch, the lighting and star switches, and the map key. */
function createMoonControls(
  caption: string,
  terrainLayer: string | null,
  approximated: boolean,
  albedoGaps: boolean,
  handlers: MoonControlHandlers,
): { setOrbitLine: (line: string) => void } {
  const panel = document.createElement('div');
  panel.id = 'moon-controls';
  const text = document.createElement('p');
  text.textContent = caption;

  const full = epochParam !== null;
  const link = document.createElement('a');
  const next = new URLSearchParams(location.search);
  if (full) next.delete('epoch');
  else next.set('epoch', 'full');
  const query = next.toString();
  link.href = query === '' ? location.pathname : `?${query}`;
  link.textContent = full ? 'First quarter' : 'Full Moon';

  const notes = document.createElement('div');
  const lighting = createToggle(
    { off: 'Lighting: sun', on: 'Lighting: even' },
    'Even lighting is not physical: every point at full-Moon brightness, so the night and far sides show.',
    notes,
    handlers.onEvenLight,
  );
  const stars = createToggle(
    { off: 'Stars: physical', on: 'Stars: boosted' },
    `Stars ×${STAR_BOOST.toLocaleString('en')} (+${STAR_BOOST_MAGNITUDES} mag) brighter than a real exposure shows them.`,
    notes,
    handlers.onBoost,
  );
  const row = document.createElement('div');
  row.className = 'row';
  row.append(link, lighting, stars);

  // Orbit mode: a random real orbit, flown automatically; time can be sped up, labelled.
  const orbitLine = document.createElement('p');
  orbitLine.className = 'note';
  const time = document.createElement('button');
  time.type = 'button';
  const timeNote = document.createElement('p');
  timeNote.className = 'note warning';
  let factorIndex = 0;
  const setFactor = (index: number): void => {
    factorIndex = index;
    const factor = ORBIT_TIME_FACTORS[index] ?? 1;
    time.textContent = factor === 1 ? 'Time: real' : `Time: \u00d7${factor}`;
    timeNote.textContent = `Time \u00d7${factor}: the orbit moves ${factor} times faster than it really would.`;
    if (factor === 1) timeNote.remove();
    else notes.append(timeNote);
    handlers.onTimeFactor(factor);
  };
  time.addEventListener('click', () => setFactor((factorIndex + 1) % ORBIT_TIME_FACTORS.length));
  const showOrbit = (line: string | null): void => {
    if (line === null) {
      orbitLine.remove();
      time.remove();
      timeNote.remove();
      return;
    }
    orbitLine.textContent = line;
    notes.prepend(orbitLine);
    row.append(time);
    setFactor(0);
  };
  // `?orbit=<seed>` starts that orbit; after that the button starts from the current view.
  let pendingStart = handlers.startInOrbit;
  const orbit = createToggle({ off: 'Orbit', on: 'Orbit: on' }, null, notes, (on) => {
    const start = on ? pendingStart : null;
    pendingStart = null;
    showOrbit(start === null ? handlers.onOrbit(on) : start());
  });
  row.append(orbit);
  const labelsButton = createToggle({ off: 'Labels', on: 'Labels: on' }, null, notes, (on) => {
    handlers.onLabels(on);
  });
  row.append(labelsButton);
  if (handlers.startInOrbit !== null) {
    orbit.click();
  }
  // The approximation exists only where `npm run local` serves it.
  if (terrainLayer?.startsWith('moon-local') === true) {
    const detail = document.createElement('a');
    const toggled = new URLSearchParams(location.search);
    if (approximated) toggled.delete('detail');
    else toggled.set('detail', 'approx');
    const q = toggled.toString();
    detail.href = q === '' ? location.pathname : `?${q}`;
    detail.textContent = approximated ? 'Detail: + approximation' : 'Detail: measured';
    row.append(detail);
  }
  if (approximated) {
    // Shown for as long as the approximation is (docs/stories/SS-10b.md).
    const note = document.createElement('p');
    note.className = 'note warning';
    note.textContent = APPROXIMATION_NOTE;
    notes.append(note);
  }

  const about = document.createElement('details');
  const summary = document.createElement('summary');
  if (albedoGaps) {
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    summary.append(swatch, 'Magenta: never measured · ');
  }
  summary.append('About this view');
  about.append(summary);
  for (const line of albedoGaps ? [...ABOUT, GAP_NOTE] : ABOUT) {
    const p = document.createElement('p');
    p.textContent = line;
    about.append(p);
  }

  panel.append(text, row, notes, about);
  document.body.append(panel);
  return {
    setOrbitLine: (line) => {
      orbitLine.textContent = line;
    },
  };
}

start().catch((error: unknown) => {
  showFatal(
    `failed to start: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
  );
});
