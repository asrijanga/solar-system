import { setConsoleFunction } from 'three/webgpu';

/** Short git SHA of this build, injected by vite.config.ts. */
export const BUILD_ID: string = __BUILD_ID__;

type Level = 'log' | 'warn' | 'error';

let shown = false;
let onFatalHook: ((message: string) => void) | null = null;

/**
 * Puts the first fatal error on screen. Phones have no console, and three.js reports
 * shader and pipeline failures only by logging them and then silently skipping the draw:
 * without this, a broken material on one browser is just an empty scene.
 */
export function showFatal(message: string): void {
  console.error(`[app] ${message}`);
  onFatalHook?.(message);
  if (shown) return;
  shown = true;
  const panel = document.createElement('section');
  panel.id = 'fatal';
  panel.style.cssText =
    'position:fixed;left:8px;right:8px;bottom:8px;max-height:45vh;overflow:auto;padding:12px 14px;' +
    'background:rgba(40,8,8,.92);color:#ffd9d9;border:1px solid #a33;border-radius:6px;' +
    'font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;';
  panel.textContent = [
    'The renderer hit an error',
    '',
    message,
    '',
    `build ${BUILD_ID}`,
    navigator.userAgent,
  ].join('\n');
  document.body.append(panel);
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return String(value);
}

/**
 * Routes every error source to showFatal: three.js's own log calls, uncaught exceptions,
 * unhandled promise rejections, WebGPU validation errors nothing captured, and device loss.
 */
export function installErrorReporting(onFatal: (message: string) => void): void {
  onFatalHook = onFatal;
  setConsoleFunction((type: Level, message: string, ...params: unknown[]) => {
    console[type](message, ...params);
    if (type === 'error') showFatal([message, ...params.map(describe)].join(' '));
  });
  window.addEventListener('error', (event) => showFatal(describe(event.error ?? event.message)));
  window.addEventListener('unhandledrejection', (event) => showFatal(describe(event.reason)));
}

export function watchDevice(device: GPUDevice): void {
  device.addEventListener('uncapturederror', (event) => {
    showFatal(`WebGPU error: ${(event as GPUUncapturedErrorEvent).error.message}`);
  });
  void device.lost.then((info) => {
    if (info.reason !== 'destroyed') showFatal(`WebGPU device lost: ${info.message}`);
  });
}
