import { describe, expect, it } from 'vitest';
import { findViewpoint, type Viewpoint } from '../../src/capture/viewpoints.ts';
import { verifyReport, type Ready } from './verify.ts';

const viewpoint = findViewpoint('clear') as Viewpoint;
const good: Ready = {
  status: 'ready',
  viewpoint: viewpoint.id,
  backend: 'webgpu',
  threeRevision: '184',
  adapter: { vendor: 'google', architecture: 'swiftshader', isFallbackAdapter: true },
  canvas: { width: viewpoint.width, height: viewpoint.height },
  devicePixelRatio: 1,
};

describe('verifyReport', () => {
  it('accepts WebGPU on SwiftShader at the exact size', () => {
    expect(verifyReport(good, viewpoint)).toEqual([]);
  });

  it('refuses the WebGL 2 backend', () => {
    expect(verifyReport({ ...good, backend: 'other' }, viewpoint)).toEqual([
      'backend is other, not webgpu',
    ]);
  });

  it('refuses a hardware adapter, whose output differs from the baselines', () => {
    const adapter = { vendor: 'nvidia', architecture: 'ampere', isFallbackAdapter: false };
    expect(verifyReport({ ...good, adapter }, viewpoint)).toHaveLength(1);
  });

  it('refuses a different viewpoint, pixel ratio, or canvas size', () => {
    expect(verifyReport({ ...good, viewpoint: 'other' }, viewpoint)).toHaveLength(1);
    expect(verifyReport({ ...good, devicePixelRatio: 2 }, viewpoint)).toHaveLength(1);
    expect(
      verifyReport({ ...good, canvas: { width: 1024, height: 1023 } }, viewpoint),
    ).toHaveLength(1);
  });
});
