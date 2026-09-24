// Compile-time checks, run by `npm run typecheck`. Never executed.
// If a misspelled option stops being an error, @ts-expect-error itself fails the build.
import { createRenderer, type RendererOptions } from './renderer';

declare const canvas: HTMLCanvasElement;
declare const device: GPUDevice;

export const valid: RendererOptions = {
  canvas,
  device,
  antialias: true,
  reversedDepthBuffer: false,
  trackTimestamp: false,
};

export async function misspelled(): Promise<void> {
  await createRenderer({
    canvas,
    device,
    antialias: true,
    reversedDepthBuffer: false,
    trackTimestamp: false,
    // @ts-expect-error The WebGL renderer's spelling; WebGPURenderer would silently ignore it.
    reverseDepthBuffer: true,
  });
}

export async function missingDevice(): Promise<void> {
  // @ts-expect-error The device must come from the adapter we checked.
  await createRenderer({
    canvas,
    antialias: true,
    reversedDepthBuffer: false,
    trackTimestamp: false,
  });
}
