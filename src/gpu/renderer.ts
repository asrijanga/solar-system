import { WebGPURenderer } from 'three/webgpu';

/**
 * The only renderer options this app sets. three.js silently ignores unknown options
 * (`reverseDepthBuffer` instead of `reversedDepthBuffer` does nothing), so every option
 * goes through this closed type and a misspelling is a compile error.
 */
export interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  /** Created by us, from the adapter we checked, so three cannot pick a different one. */
  readonly device: GPUDevice;
  readonly antialias: boolean;
  readonly reversedDepthBuffer: boolean;
}

export class WebGL2FallbackError extends Error {
  constructor() {
    super('WebGPURenderer fell back to its WebGL 2 backend');
    this.name = 'WebGL2FallbackError';
  }
}

export function isWebGPUBackend(renderer: WebGPURenderer): boolean {
  const backend = renderer.backend as { isWebGPUBackend?: boolean };
  return backend.isWebGPUBackend === true;
}

/**
 * Creates and initialises the renderer, and refuses to return one that is not running
 * on WebGPU. WebGPURenderer otherwise falls back to WebGL 2 with only a console warning.
 */
export async function createRenderer(options: RendererOptions): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({
    canvas: options.canvas,
    device: options.device,
    antialias: options.antialias,
    reversedDepthBuffer: options.reversedDepthBuffer,
  });
  await renderer.init();
  if (!isWebGPUBackend(renderer)) {
    renderer.dispose();
    throw new WebGL2FallbackError();
  }
  return renderer;
}
