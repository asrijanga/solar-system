import { Color, PerspectiveCamera, Scene } from 'three/webgpu';
import { decideSupport, refusalMessages, type Refusal } from './core/support';
import { logAdapter, probeAdapter, requestDevice } from './gpu/adapter';
import { createRenderer, WebGL2FallbackError } from './gpu/renderer';

/**
 * Scaffolding colour for SS-1: deliberately not black and not three.js's default,
 * so a successful clear can never be mistaken for a blank or failed canvas.
 * Space becomes true black in SS-4.
 */
export const CLEAR_COLOUR = '#1b3a5c';

/** Sharper than 2x costs fill rate for detail nobody can see. */
const MAX_PIXEL_RATIO = 2;

function showRefusal(refusal: Refusal): void {
  const { title, detail } = refusalMessages[refusal];
  document.getElementById('app')?.remove();
  const panel = document.getElementById('unsupported');
  const heading = panel?.querySelector('h1');
  const text = panel?.querySelector('p');
  if (!panel || !heading || !text) return;
  heading.textContent = title;
  text.textContent = detail;
  panel.dataset['refusal'] = refusal;
  panel.hidden = false;
  console.warn(`[gpu] refused: ${refusal}`);
}

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  // Headless captures run on SwiftShader, a software adapter. Never allowed by default.
  const allowSoftwareAdapter = params.has('software');

  const probe = await probeAdapter(allowSoftwareAdapter);
  const decision = decideSupport(probe.facts);
  if (!decision.ok || probe.adapter === null) {
    showRefusal(decision.ok ? 'no-adapter' : decision.refusal);
    return;
  }

  logAdapter(probe.adapter);
  const device = await requestDevice(probe.adapter);
  const canvas = document.getElementById('app') as HTMLCanvasElement;

  let renderer;
  try {
    renderer = await createRenderer({
      canvas,
      device,
      antialias: true,
      // Enabled in SS-3, together with the capture that proves it works.
      reversedDepthBuffer: false,
    });
  } catch (error) {
    if (error instanceof WebGL2FallbackError) {
      showRefusal('webgl2-fallback');
      return;
    }
    throw error;
  }

  renderer.setClearColor(new Color(CLEAR_COLOUR), 1);
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 10);

  const draw = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };

  new ResizeObserver(draw).observe(canvas);
  draw();
  document.documentElement.dataset['ready'] = 'true';
}

start().catch((error: unknown) => {
  console.error('[app] failed to start', error);
});
