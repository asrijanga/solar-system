import { describe, expect, it } from 'vitest';
import { decideSupport, refusalMessages, type Refusal, type SupportFacts } from './support';

const gpu = { core: true, isFallbackAdapter: false };
const base: SupportFacts = { hasWebGPUApi: true, adapter: gpu, allowSoftwareAdapter: false };

describe('decideSupport', () => {
  it('accepts a hardware core adapter', () => {
    expect(decideSupport(base)).toEqual({ ok: true });
  });

  it('refuses when navigator.gpu is missing, whatever else is true', () => {
    expect(decideSupport({ ...base, hasWebGPUApi: false })).toEqual({
      ok: false,
      refusal: 'no-webgpu-api',
    });
  });

  it('refuses when no adapter is granted', () => {
    expect(decideSupport({ ...base, adapter: null })).toEqual({ ok: false, refusal: 'no-adapter' });
  });

  it('refuses a compatibility-mode-only adapter', () => {
    expect(decideSupport({ ...base, adapter: { ...gpu, core: false } })).toEqual({
      ok: false,
      refusal: 'compatibility-only',
    });
  });

  it('refuses a software adapter by default', () => {
    expect(decideSupport({ ...base, adapter: { ...gpu, isFallbackAdapter: true } })).toEqual({
      ok: false,
      refusal: 'software-adapter',
    });
  });

  it('accepts a software adapter only when explicitly allowed', () => {
    expect(
      decideSupport({
        ...base,
        adapter: { ...gpu, isFallbackAdapter: true },
        allowSoftwareAdapter: true,
      }),
    ).toEqual({ ok: true });
  });

  it('still refuses compatibility-only when software is allowed', () => {
    expect(
      decideSupport({
        ...base,
        adapter: { core: false, isFallbackAdapter: true },
        allowSoftwareAdapter: true,
      }),
    ).toEqual({ ok: false, refusal: 'compatibility-only' });
  });
});

describe('refusalMessages', () => {
  it('has a distinct, non-empty message for every refusal', () => {
    const refusals: Refusal[] = [
      'no-webgpu-api',
      'no-adapter',
      'compatibility-only',
      'software-adapter',
      'webgl2-fallback',
    ];
    const titles = refusals.map((r) => refusalMessages[r].title);
    expect(new Set(titles).size).toBe(refusals.length);
    for (const r of refusals) expect(refusalMessages[r].detail.length).toBeGreaterThan(20);
  });
});
