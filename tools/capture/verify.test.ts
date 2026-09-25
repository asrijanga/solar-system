import { describe, expect, it } from 'vitest';
import { findViewpoint, type Viewpoint } from '../../src/capture/viewpoints.ts';
import { verifyReport, type Ready } from './verify.ts';

const viewpoint = findViewpoint('clear') as Viewpoint;
const good: Ready = {
  status: 'ready',
  viewpoint: viewpoint.id,
  backend: 'webgpu',
  threeRevision: '184',
  sceneDepth: 'float32',
  adapter: { vendor: 'google', architecture: 'swiftshader', isFallbackAdapter: true },
  canvas: { width: viewpoint.width, height: viewpoint.height },
  devicePixelRatio: 1,
  albedoDecodedMean: null,
  heightDecodedSum: null,
};

describe('verifyReport', () => {
  it('accepts WebGPU on SwiftShader at the exact size', () => {
    expect(verifyReport(good, viewpoint)).toEqual([]);
  });

  it('refuses a reversed-Z viewpoint that did not render with float depth', () => {
    expect(verifyReport({ ...good, sceneDepth: 'other' }, viewpoint)).toEqual([
      'reversed-Z viewpoint rendered with other depth, not float32',
    ]);
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

  it('refuses a Moon map viewpoint whose albedo decoded differently from the pipeline', () => {
    const moon = findViewpoint('moon-full') as Viewpoint;
    const report: Ready = {
      ...good,
      viewpoint: moon.id,
      albedoDecodedMean: 43.9234,
      heightDecodedSum: 1000,
    };
    expect(verifyReport(report, moon, 43.9234, 1000)).toEqual([]);
    expect(verifyReport({ ...report, albedoDecodedMean: 44.5 }, moon, 43.9234, 1000)).toHaveLength(
      1,
    );
    expect(verifyReport({ ...report, albedoDecodedMean: null }, moon, 43.9234, 1000)).toHaveLength(
      1,
    );
  });

  it('refuses a relief viewpoint whose heights decoded differently, by even one unit', () => {
    const moon = findViewpoint('moon-full') as Viewpoint;
    const report: Ready = {
      ...good,
      viewpoint: moon.id,
      albedoDecodedMean: 1,
      heightDecodedSum: 1001,
    };
    expect(verifyReport(report, moon, 1, 1000)).toHaveLength(1);
  });
});
