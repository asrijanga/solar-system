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
  type WebGPURenderer,
} from 'three/webgpu';
import { pass } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TilesRenderer } from '3d-tiles-renderer';
import type { CaptureReport } from './capture/protocol';
import { findViewpoint, type Viewpoint } from './capture/viewpoints';
import { maxTiltDeg } from './core/moon';
import {
  orbitAlongView,
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
import { describe, installErrorReporting, showFatal, watchDevice } from './debug/errors';
import { DebugOverlay } from './debug/overlay';
import { describeAdapter, logAdapter, probeAdapter, requestDevice } from './gpu/adapter';
import { createRenderer, isWebGPUBackend, WebGL2FallbackError } from './gpu/renderer';
import { createDepthTestScene } from './scenes/depthTest';
import {
  createStarMesh,
  loadStarField,
  NOMINAL_STAR_EXPOSURE,
  STAR_BOOST,
  STAR_BOOST_MAGNITUDES,
} from './scenes/stars';
import { createToggle } from './ui/toggle';
import { createCamera, type Stage, type StageContext, type WorldUi } from './worlds/stage';

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

/** Orbit limits, in the world's radii from its centre. The smooth sphere stops at 1.5 radii. */
const MIN_DISTANCE_RADII = 1.5;
const MAX_DISTANCE_RADII = 60;
/**
 * Over terrain the camera never comes lower than this above the ground beneath it, km, and
 * where the data is coarser it stops higher (core/terrain.ts, minAltitudeKm). The real
 * camera, with collision against the terrain, is SS-11.
 */
const MIN_ALTITUDE_KM = 0.05;
/** How long a capture waits for the terrain it needs to finish loading. */
const TERRAIN_LOAD_TIMEOUT_MS = 150_000;
/** On load the disc spans this fraction of the screen's shorter side. */
const FIT_FRACTION = 0.8;

const params = new URLSearchParams(location.search);
/** Set by the headless harness: `?capture=<viewpoint id>`. */
const captureId = params.get('capture');
const debug = params.has('debug');
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
/**
 * Which world this page shows: `<html data-world="mars">` on /mars/, the Moon otherwise
 * (docs/stories/SS-13.md). Each world's own code is loaded only on its page.
 */
const world = document.documentElement.dataset['world'] === 'mars' ? 'mars' : 'moon';

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
  if (!reliefOff || viewpoint?.body == null) return viewpoint;
  return { ...viewpoint, body: { ...viewpoint.body, relief: false } };
}

/** The interactive app shows its world's app viewpoint's scene and pose. */
const INTERACTIVE = findViewpoint(world === 'mars' ? 'mars-app' : 'app');

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

async function createStage(context: StageContext): Promise<Stage> {
  const { viewpoint, reversedDepth } = context;
  const plain = (scene: Scene): Stage => ({
    scene,
    camera: createCamera(viewpoint.camera),
    radiusKm: null,
    highestPointKm: 0,
    starExposure: null,
    albedoDecodedMean: null,
    terrain: null,
    terrainAvailable: null,
    orbitInputs: null,
    labels: null,
    landmarks: [],
    bodyToScene: null,
    ui: null,
    frame: null,
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
    // Each world's code is its own chunk, fetched only by its page.
    case 'moon':
      return (await import('./worlds/moon')).createMoonStage(context);
    case 'mars':
      return (await import('./worlds/mars')).createMarsStage(context);
  }
}

async function start(): Promise<void> {
  const listed = captureId === null ? withoutReliefIfAsked(INTERACTIVE) : findViewpoint(captureId);
  const viewpoint = listed;
  if (viewpoint === undefined) {
    report({ status: 'refused', reason: `unknown viewpoint: ${String(captureId)}` });
    return;
  }
  if (captureId === null) addBackLink();
  // The approximation is never checked against anything (docs/stories/SS-10b.md).
  if (
    captureId !== null &&
    params.get('detail') === 'approx' &&
    (viewpoint.bodyChecks.length > 0 ||
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
  const stage = await createStage({
    viewpoint,
    reversedDepth: viewpoint.reversedDepthBuffer,
    maxAnisotropy: renderer.getMaxAnisotropy(),
    captureId,
    params,
  });
  const { scene, camera, starExposure, terrain } = stage;
  const stageFrame = stage.frame;
  /** The canvas's height in CSS pixels, for the stage's per-frame hook. */
  const viewHeight = new Float64Array([1]);
  terrain?.setCamera(camera);
  /** 1 at physical exposure, STAR_BOOST with the labelled boost on. */
  const starBoost = new Float64Array([viewpoint.body?.stars === 'boosted' ? STAR_BOOST : 1]);

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
    viewHeight[0] = height;
    if (starExposure !== null) {
      starExposure.value =
        physicalStarExposure(pixelSolidAngle(camera.fov, height)) * (starBoost[0] ?? 1);
    }
  };

  if (captureId !== null) {
    // Capture mode: exactly one frame, no clock, no controls. Ready means the GPU has
    // finished it and the compositor has had a chance to present it.
    resize();
    const orbitSeed = viewpoint.body?.orbitSeed ?? null;
    if (orbitSeed !== null) seededOrbitFlight(stage, camera, canvas.height, orbitSeed);
    const orbitFrom = viewpoint.body?.orbitFrom ?? null;
    if (orbitFrom !== null) {
      const minHeight = sharpOrbitHeightKm(stage, camera, canvas.height);
      const orbit =
        minHeight === null ? null : orbitOverLandmark(stage, orbitFrom.landmark, minHeight);
      if (orbit !== null && stage.radiusKm !== null) {
        new OrbitFlight(
          camera,
          { ...orbit, theta0: (orbitFrom.angleDeg * Math.PI) / 180 },
          stage.radiusKm,
          false,
          stage.orbitInputs?.earth ?? null,
        );
      }
    }
    if (terrain !== null && !(await terrainLoaded(terrain, camera))) {
      report({ status: 'refused', reason: 'terrain did not finish loading' });
      return;
    }
    camera.updateMatrixWorld();
    if (stageFrame !== null) stageFrame(camera, viewHeight[0] ?? 1);
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
    // Orbiting stays centred on the world: panning would move the target off its centre.
    controls.enablePan = false;
    const groundKm = new Float64Array([stage.radiusKm]);
    if (terrain !== null && stage.terrainAvailable !== null) {
      followGround(
        controls,
        terrain,
        stage.terrainAvailable,
        stage.radiusKm,
        stage.highestPointKm,
        groundKm,
      );
    }
    tilt = createTilt(controls, canvas, viewpoint.body?.tiltDeg ?? 0, groundKm);
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
  // The Orbit button starts from your view (owner, 2026-09-29, docs/stories/SS-11f.md): over the
  // point below the camera, flying towards the top of the screen, at the height the gestures left
  // the camera (never below the lowest sharp one), and glides there.
  const startFromView = (): OrbitFlight | null => {
    const minHeight = sharpOrbitHeightKm(stage, camera, canvas.height);
    if (minHeight === null || stage.radiusKm === null || stage.orbitInputs === null) return null;
    const height = Math.max(camera.position.length() - stage.radiusKm, minHeight);
    camera.updateMatrixWorld();
    const forward = camera.getWorldDirection(new Vector3());
    const screenUp = new Vector3(0, 1, 0).transformDirection(camera.matrixWorld);
    const orbit = orbitAlongView(
      [camera.position.x, camera.position.y, camera.position.z],
      [forward.x, forward.y, forward.z],
      [screenUp.x, screenUp.y, screenUp.z],
      stage.radiusKm,
      stage.orbitInputs.gmKm3PerS2,
      height,
    );
    // It glides there from the current view rather than jumping.
    return orbit === null
      ? null
      : begin(
          new OrbitFlight(camera, orbit, stage.radiusKm, true, stage.orbitInputs?.earth ?? null),
        );
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

  if (stage.ui !== null) {
    const describeOrbit = (f: OrbitFlight): string => {
      const { heightKm, speedKmS } = f.describe();
      const minHeight = sharpOrbitHeightKm(stage, camera, canvas.height) ?? 0;
      const floor =
        heightKm <= minHeight + 0.5
          ? 'the lowest height the website\u2019s terrain stays sharp from on this screen'
          : `pinch or scroll to change it; ${minHeight.toFixed(0)} km is the lowest the terrain stays sharp from`;
      return `Orbiting ${heightKm.toFixed(0)} km up at ${speedKmS.toFixed(2)} km/s: ${floor}.`;
    };
    const ui = createControls(stage.ui, {
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
    });
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
    if (stageFrame !== null) stageFrame(camera, viewHeight[0] ?? 1);
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
  highestPointKm: number,
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
    const ground = hit === undefined ? radiusKm + highestPointKm : distance - hit.distance;
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
  const { gmKm3PerS2, sun, earth } = stage.orbitInputs;
  const orbit = randomOrbit(seededRandom(seed), stage.radiusKm, gmKm3PerS2, minHeight, sun);
  return new OrbitFlight(camera, orbit, stage.radiusKm, false, earth);
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

interface ControlHandlers {
  /** Orbit mode on or off; returns the line describing the orbit, or null. */
  readonly onOrbit: (on: boolean) => string | null;
  readonly onTimeFactor: (factor: number) => void;
  /** Set when the page asked for `?orbit`: starts it, returning the description. */
  readonly startInOrbit: (() => string | null) | null;
  readonly onBoost: (boosted: boolean) => void;
  /** Landmark labels on or off (docs/stories/SS-15.md). */
  readonly onLabels: (on: boolean) => void;
}

/** The caption, the world's own switches, the shared star, orbit and label switches, and About. */
function createControls(
  world: WorldUi,
  handlers: ControlHandlers,
): { setOrbitLine: (line: string) => void } {
  const panel = document.createElement('div');
  panel.id = 'moon-controls';
  const text = document.createElement('p');
  text.textContent = world.caption;

  const notes = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'row';
  world.leading(row, notes);
  const stars = createToggle(
    { off: 'Stars: physical', on: 'Stars: boosted' },
    `Stars ×${STAR_BOOST.toLocaleString('en')} (+${STAR_BOOST_MAGNITUDES} mag) brighter than a real exposure shows them.`,
    notes,
    handlers.onBoost,
  );
  row.append(stars);

  // Orbit mode: a real orbit, flown automatically; time can be sped up, labelled.
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
  world.trailing(row, notes);

  const about = document.createElement('details');
  const summary = document.createElement('summary');
  summary.append(...world.summaryPrefix, 'About this view');
  about.append(summary);
  for (const line of world.about) {
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
  showFatal(`failed to start: ${describe(error)}`);
});
