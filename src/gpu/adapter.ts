import type { AdapterFacts, SupportFacts } from '../core/support';

export interface AdapterProbe {
  readonly facts: SupportFacts;
  /** The core adapter, when one was granted. The renderer's device comes from this one. */
  readonly adapter: GPUAdapter | null;
}

// Limits later stories depend on. Logged at startup so a bug report carries them.
const LOGGED_LIMITS = [
  'maxTextureDimension2D',
  'maxTextureArrayLayers',
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxStorageBuffersPerShaderStage',
  'maxComputeWorkgroupSizeX',
  'maxComputeInvocationsPerWorkgroup',
  'maxColorAttachmentBytesPerSample',
] as const satisfies readonly (keyof GPUSupportedLimits)[];

function isFallback(adapter: GPUAdapter): boolean {
  // Newer browsers report this on adapter.info; older ones on the adapter itself.
  const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
  const legacy = adapter as GPUAdapter & { isFallbackAdapter?: boolean };
  return info.isFallbackAdapter ?? legacy.isFallbackAdapter ?? false;
}

/**
 * Gathers the facts decideSupport() needs. Requests a core-feature-level adapter first;
 * only if that fails does it ask for compatibility mode, purely to name the reason.
 */
export async function probeAdapter(allowSoftwareAdapter: boolean): Promise<AdapterProbe> {
  if (!('gpu' in navigator) || navigator.gpu === undefined) {
    return { facts: { hasWebGPUApi: false, adapter: null, allowSoftwareAdapter }, adapter: null };
  }

  const core = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (core !== null) {
    const facts: AdapterFacts = { core: true, isFallbackAdapter: isFallback(core) };
    return { facts: { hasWebGPUApi: true, adapter: facts, allowSoftwareAdapter }, adapter: core };
  }

  const compat = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' });
  const facts: AdapterFacts | null =
    compat === null ? null : { core: false, isFallbackAdapter: isFallback(compat) };
  return { facts: { hasWebGPUApi: true, adapter: facts, allowSoftwareAdapter }, adapter: null };
}

/** Requests the device the renderer will use, with every feature the adapter offers. */
export async function requestDevice(adapter: GPUAdapter): Promise<GPUDevice> {
  return adapter.requestDevice({ requiredFeatures: [...adapter.features] as GPUFeatureName[] });
}

export function describeAdapter(adapter: GPUAdapter): {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  isFallbackAdapter: boolean;
} {
  const { vendor, architecture, device, description } = adapter.info;
  return { vendor, architecture, device, description, isFallbackAdapter: isFallback(adapter) };
}

export function logAdapter(adapter: GPUAdapter): void {
  const limits = Object.fromEntries(LOGGED_LIMITS.map((name) => [name, adapter.limits[name]]));
  console.info('[gpu] adapter', describeAdapter(adapter));
  console.info('[gpu] features', [...adapter.features].sort());
  console.info('[gpu] limits', limits);
}
