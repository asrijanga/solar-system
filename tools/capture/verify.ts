import type { CaptureReport } from '../../src/capture/protocol.ts';
import type { Viewpoint } from '../../src/capture/viewpoints.ts';

export type Ready = Extract<CaptureReport, { status: 'ready' }>;

/**
 * Everything that must be true before a capture may be written. A capture that did not
 * provably come from WebGPU on SwiftShader, at the viewpoint's exact size, is worthless
 * as a baseline and misleading as evidence. Returns the problems; empty means valid.
 */
export function verifyReport(report: Ready, viewpoint: Viewpoint): string[] {
  const problems: string[] = [];
  if (report.viewpoint !== viewpoint.id) problems.push(`app rendered ${report.viewpoint}`);
  if (report.backend !== 'webgpu') problems.push(`backend is ${report.backend}, not webgpu`);
  if (report.adapter.architecture !== 'swiftshader' || !report.adapter.isFallbackAdapter) {
    problems.push(`adapter is ${JSON.stringify(report.adapter)}, not SwiftShader`);
  }
  if (report.devicePixelRatio !== 1)
    problems.push(`devicePixelRatio is ${report.devicePixelRatio}`);
  if (report.canvas.width !== viewpoint.width || report.canvas.height !== viewpoint.height) {
    problems.push(
      `canvas is ${report.canvas.width}x${report.canvas.height}, expected ${viewpoint.width}x${viewpoint.height}`,
    );
  }
  return problems;
}
