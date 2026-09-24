import {
  Color,
  FloatType,
  PerspectiveCamera,
  REVISION,
  RenderPipeline,
  Scene,
  type WebGPURenderer,
} from 'three/webgpu';
import { pass } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CaptureReport } from './capture/protocol';
import { findViewpoint, type CameraPose, type SceneId } from './capture/viewpoints';
import { decideSupport, refusalMessages, type Refusal } from './core/support';
import { KM, METRE } from './core/units';
import { installErrorReporting, showFatal, watchDevice } from './debug/errors';
import { DebugOverlay } from './debug/overlay';
import { describeAdapter, logAdapter, probeAdapter, requestDevice } from './gpu/adapter';
import { createRenderer, isWebGPUBackend, WebGL2FallbackError } from './gpu/renderer';
import { createCubeScene } from './scenes/cube';
import { createDepthTestScene } from './scenes/depthTest';
import { createStarMesh, loadStarField } from './scenes/stars';

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

/** Orbit limits around the test cube, in kilometres. */
const MIN_DISTANCE = 1.5 * KM;
const MAX_DISTANCE = 30 * KM;

const params = new URLSearchParams(location.search);
/** Set by the headless harness: `?capture=<viewpoint id>`. */
const captureId = params.get('capture');
const debug = params.has('debug');

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

async function createScene(id: SceneId, reversedDepth: boolean): Promise<Scene> {
  switch (id) {
    case 'empty':
      return new Scene();
    case 'cube':
      return createCubeScene();
    case 'depth-test-10m':
      return createDepthTestScene(10 * METRE);
    case 'depth-test-coplanar':
      return createDepthTestScene(0);
    case 'stars':
    case 'stars-mirrored': {
      const scene = new Scene();
      const mirrored = id === 'stars-mirrored';
      scene.add(createStarMesh(await loadStarField(), { reversedDepth, mirrored }));
      return scene;
    }
    case 'cube-and-stars': {
      const scene = createCubeScene();
      scene.add(createStarMesh(await loadStarField(), { reversedDepth }));
      return scene;
    }
  }
}

function createCamera(pose: CameraPose | null): PerspectiveCamera {
  if (pose === null) return new PerspectiveCamera(50, 1, 0.1, 10);
  const camera = new PerspectiveCamera(pose.fovDeg, 1, pose.near, pose.far);
  camera.position.set(...pose.position);
  camera.up.set(...pose.up);
  camera.lookAt(...pose.target);
  return camera;
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
  const scene = await createScene(viewpoint.scene, viewpoint.reversedDepthBuffer);
  const camera = createCamera(viewpoint.camera);

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
    });
    return;
  }

  const controls = new OrbitControls(camera, canvas);
  if (viewpoint.camera !== null) controls.target.set(...viewpoint.camera.target);
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.enableDamping = true;
  controls.update();

  const overlay = debug ? new DebugOverlay(renderer, device.features.has('timestamp-query')) : null;

  let resizePending = true;
  new ResizeObserver(() => {
    resizePending = true;
  }).observe(canvas);

  // The per-frame path. It allocates nothing: no `new`, no closures, no array or object
  // literals, and no fractional numbers stored in captured variables, which V8 boxes on the
  // heap on every write. Timing state lives in a Float64Array for that reason.
  // tools/perf/alloc.ts measures this on every PR.
  const clock = new Float64Array(1);
  clock[0] = -1; // previous frame's timestamp, ms
  const frame = (time: number): void => {
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

start().catch((error: unknown) => {
  showFatal(
    `failed to start: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
  );
});
