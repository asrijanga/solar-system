import {
  Color,
  FloatType,
  PerspectiveCamera,
  REVISION,
  RenderPipeline,
  Scene,
  type UniformNode,
  type WebGPURenderer,
} from 'three/webgpu';
import { pass, uniform } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CaptureReport } from './capture/protocol';
import {
  findViewpoint,
  type CameraPose,
  type MoonEpochId,
  type Viewpoint,
} from './capture/viewpoints';
import { findEpoch, moonViewPose, type MoonEphemeris } from './core/moon';
import { physicalStarExposure, pixelSolidAngle } from './core/photometry';
import { decideSupport, refusalMessages, type Refusal } from './core/support';
import { METRE } from './core/units';
import { installErrorReporting, showFatal, watchDevice } from './debug/errors';
import { DebugOverlay } from './debug/overlay';
import { describeAdapter, logAdapter, probeAdapter, requestDevice } from './gpu/adapter';
import { createRenderer, isWebGPUBackend, WebGL2FallbackError } from './gpu/renderer';
import { createDepthTestScene } from './scenes/depthTest';
import { createMoonMesh, loadMoonTextures } from './scenes/moon';
import {
  createStarMesh,
  loadStarField,
  NOMINAL_STAR_EXPOSURE,
  STAR_BOOST,
  STAR_BOOST_MAGNITUDES,
} from './scenes/stars';

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

/** Orbit limits, in Moon radii from its centre. */
const MIN_DISTANCE_RADII = 1.5;
const MAX_DISTANCE_RADII = 60;
/** On load the disc spans this fraction of the screen's shorter side. */
const FIT_FRACTION = 0.8;

const params = new URLSearchParams(location.search);
/** Set by the headless harness: `?capture=<viewpoint id>`. */
const captureId = params.get('capture');
const debug = params.has('debug');
/** `?epoch=full` shows the full Moon; the default is the app viewpoint's first quarter. */
const epochParam: MoonEpochId | null = params.get('epoch') === 'full' ? 'full-2026-01' : null;

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
  readonly caption: string | null;
  /** 0 sunlight, 1 the labelled even lighting. */
  readonly evenLight: UniformNode<'float', number> | null;
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
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
    caption: null,
    evenLight: null,
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
      const [ephemeris, field, textures] = await Promise.all([
        loadJson<MoonEphemeris>('data/moon/ephemeris.json'),
        loadStarField(),
        setup.albedo === 'map' ? loadMoonTextures(maxAnisotropy) : null,
      ]);
      const epoch = findEpoch(ephemeris, (captureId === null ? epochParam : null) ?? setup.epoch);
      const radiusKm = ephemeris.body.radiiKm[0];
      const evenLight = uniform(setup.lighting === 'even' ? 1 : 0);
      const scene = new Scene();
      scene.add(
        createMoonMesh({
          epoch,
          radiusKm,
          albedo: textures ?? { uniform: setup.albedo === 'map' ? 0 : setup.albedo.uniform },
          shading: setup.shading,
          mirrored: setup.mirrored,
          seamFix: setup.seamFix,
          evenLight,
        }),
      );
      const starExposure = uniform(0);
      scene.add(createStarMesh(field, { reversedDepth, exposure: starExposure }));

      // Near 1 km: at the closest orbit the surface is 870 km away. Reversed-Z float depth
      // keeps full precision to any far plane (docs/stories/SS-3.md).
      const camera = new PerspectiveCamera(setup.fovDeg, 1, 1, 1e7);
      const pose = moonViewPose(epoch, setup.vantage, setup.distanceKm);
      camera.position.set(...pose.position);
      camera.up.set(...pose.up);
      camera.lookAt(0, 0, 0);
      const when = epoch.utc.replace('T', ' ').slice(0, 16);
      return {
        scene,
        camera,
        radiusKm,
        starExposure,
        evenLight,
        albedoDecodedMean: textures?.decodedMean ?? null,
        caption: `The Moon from Earth · ${when} UTC · phase angle ${epoch.phaseAngleDeg.toFixed(1)}°`,
      };
    }
  }
}

async function start(): Promise<void> {
  const viewpoint = captureId === null ? INTERACTIVE : findViewpoint(captureId);
  if (viewpoint === undefined) {
    report({ status: 'refused', reason: `unknown viewpoint: ${String(captureId)}` });
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
  const { scene, camera, starExposure } = stage;
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
    if (starExposure !== null) {
      starExposure.value =
        physicalStarExposure(pixelSolidAngle(camera.fov, height)) * (starBoost[0] ?? 1);
    }
  };

  if (captureId !== null) {
    // Capture mode: exactly one frame, no clock, no controls. Ready means the GPU has
    // finished it and the compositor has had a chance to present it.
    resize();
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
    });
    return;
  }

  const controls = new OrbitControls(camera, canvas);
  if (viewpoint.camera !== null) controls.target.set(...viewpoint.camera.target);
  if (stage.radiusKm !== null) {
    // Fit the disc to the screen's shorter side, keeping the viewpoint's direction.
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360) * Math.min(1, aspect);
    const distance = stage.radiusKm / Math.sin(Math.atan(FIT_FRACTION * tanHalf));
    camera.position.setLength(distance);
    controls.minDistance = MIN_DISTANCE_RADII * stage.radiusKm;
    controls.maxDistance = MAX_DISTANCE_RADII * stage.radiusKm;
  }
  controls.enableDamping = true;
  controls.update();

  const overlay = debug ? new DebugOverlay(renderer, device.features.has('timestamp-query')) : null;

  let resizePending = true;
  new ResizeObserver(() => {
    resizePending = true;
  }).observe(canvas);

  if (stage.caption !== null) {
    const { evenLight } = stage;
    createMoonControls(stage.caption, {
      onBoost: (boosted) => {
        starBoost[0] = boosted ? STAR_BOOST : 1;
        resizePending = true;
      },
      onEvenLight: (even) => {
        if (evenLight !== null) evenLight.value = even ? 1 : 0;
      },
    });
  }

  // The per-frame path. It allocates nothing: no `new`, no closures, no array or object
  // literals, and no fractional numbers stored in captured variables, which V8 boxes on the
  // heap on every write. Timing state lives in a Float64Array for that reason.
  // tools/perf/alloc.ts measures this on every PR.
  const clock = new Float64Array(1);
  clock[0] = -1; // previous frame's timestamp, ms
  const frame = (time: number): void => {
    if (stats.frames === 0) overlay?.firstFrame(performance.now());
    if (resizePending) {
      resizePending = false;
      resize();
    }
    controls.update();
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

interface MoonControlHandlers {
  readonly onBoost: (boosted: boolean) => void;
  readonly onEvenLight: (even: boolean) => void;
}

const ABOUT = [
  'Lighting: sun is real sunlight at this date. The night side, and the far side whenever it faces away from the Sun, are black: the Moon has no air to scatter light, and earthshine is not drawn yet.',
  'Lighting: even shows every point at full-Moon brightness, as if lit from behind you everywhere at once. Not physical, but it shows the whole surface.',
  'Stars: physical is a real exposure. Next to the sunlit Moon, stars are far too faint to show, as in every Apollo photograph. Boosted makes them 100,000 times brighter.',
  'Magenta marks places no picture exists: Clementine never imaged them. Most are crater floors near the poles that sunlight never reaches, so no camera using sunlight could photograph them. They are shown as missing, not filled in.',
];

/** The caption, the epoch switch, the lighting and star switches, and the map key. */
function createMoonControls(caption: string, handlers: MoonControlHandlers): void {
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

  const about = document.createElement('details');
  const summary = document.createElement('summary');
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  summary.append(swatch, 'Magenta: never photographed · About this view');
  about.append(summary);
  for (const line of ABOUT) {
    const p = document.createElement('p');
    p.textContent = line;
    about.append(p);
  }

  panel.append(text, row, notes, about);
  document.body.append(panel);
}

start().catch((error: unknown) => {
  showFatal(
    `failed to start: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
  );
});
