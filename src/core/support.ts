// Decides whether this browser may run the app. Pure: the browser facts are gathered
// elsewhere and passed in, so every refusal path is unit-testable in Node.

export type Refusal =
  'no-webgpu-api' | 'no-adapter' | 'compatibility-only' | 'software-adapter' | 'webgl2-fallback';

export interface AdapterFacts {
  /** A core-feature-level adapter was granted (not WebGPU compatibility mode). */
  readonly core: boolean;
  /** The adapter is a software rasteriser such as SwiftShader. */
  readonly isFallbackAdapter: boolean;
}

export interface SupportFacts {
  readonly hasWebGPUApi: boolean;
  /** null when no adapter of any feature level was granted. */
  readonly adapter: AdapterFacts | null;
  /** Software adapters are allowed only when explicitly requested (headless captures). */
  readonly allowSoftwareAdapter: boolean;
}

export type SupportDecision =
  { readonly ok: true } | { readonly ok: false; readonly refusal: Refusal };

export function decideSupport(facts: SupportFacts): SupportDecision {
  if (!facts.hasWebGPUApi) return { ok: false, refusal: 'no-webgpu-api' };
  if (facts.adapter === null) return { ok: false, refusal: 'no-adapter' };
  if (!facts.adapter.core) return { ok: false, refusal: 'compatibility-only' };
  if (facts.adapter.isFallbackAdapter && !facts.allowSoftwareAdapter) {
    return { ok: false, refusal: 'software-adapter' };
  }
  return { ok: true };
}

/** What the person sees for each refusal. Names the actual reason, never a generic error. */
export const refusalMessages: Readonly<Record<Refusal, { title: string; detail: string }>> = {
  'no-webgpu-api': {
    title: 'This browser does not support WebGPU',
    detail:
      'The page needs WebGPU, and this browser does not provide it. Current versions of Chrome, Edge and Safari support it, and so does Firefox on some platforms.',
  },
  'no-adapter': {
    title: 'WebGPU is available, but no GPU was granted',
    detail:
      'The browser supports WebGPU but did not provide a graphics adapter. It may be disabled in settings, blocked for this GPU or driver, or turned off by hardware acceleration being disabled.',
  },
  'compatibility-only': {
    title: 'This GPU only supports WebGPU compatibility mode',
    detail:
      'The browser offered only the reduced WebGPU feature set used for older graphics hardware. This app needs full WebGPU.',
  },
  'software-adapter': {
    title: 'Only a software renderer is available',
    detail:
      'The browser offered WebGPU running on the CPU instead of a GPU. It would work, but far too slowly to use. Check that hardware acceleration is enabled.',
  },
  'webgl2-fallback': {
    title: 'The renderer fell back to WebGL 2',
    detail:
      'WebGPU started, but the renderer could not use it and switched to WebGL 2. This app runs on WebGPU only, so it has stopped rather than run on an untested path.',
  },
};
