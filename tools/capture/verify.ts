import type { CaptureReport } from '../../src/capture/protocol.ts';
import type { Viewpoint } from '../../src/capture/viewpoints.ts';

export type Ready = Extract<CaptureReport, { status: 'ready' }>;

/**
 * Everything that must be true before a capture may be written. A capture that did not
 * provably come from WebGPU on SwiftShader, at the viewpoint's exact size, is worthless
 * as a baseline and misleading as evidence. Returns the problems; empty means valid.
 */
/** The browser's decode of the albedo map may differ from the pipeline's by this much. */
export const ALBEDO_DECODE_TOLERANCE = 0.05;

/**
 * `albedoDecodedMean` is the pipeline's mean of the decoded map (albedo.json,
 * calibration.decodedMean); required for viewpoints that load the map.
 */
export function verifyReport(
  report: Ready,
  viewpoint: Viewpoint,
  albedoDecodedMean: number | null = null,
  heightDecodedSum: number | null = null,
): string[] {
  const problems: string[] = [];
  if (report.viewpoint !== viewpoint.id) problems.push(`app rendered ${report.viewpoint}`);
  if (report.backend !== 'webgpu') problems.push(`backend is ${report.backend}, not webgpu`);
  if (report.adapter.architecture !== 'swiftshader' || !report.adapter.isFallbackAdapter) {
    problems.push(`adapter is ${JSON.stringify(report.adapter)}, not SwiftShader`);
  }
  if (viewpoint.reversedDepthBuffer && report.sceneDepth !== 'float32') {
    // Reversed-Z on anything but float depth loses its precision (docs/stories/SS-3.md).
    problems.push(`reversed-Z viewpoint rendered with ${report.sceneDepth} depth, not float32`);
  }
  if (report.devicePixelRatio !== 1)
    problems.push(`devicePixelRatio is ${report.devicePixelRatio}`);
  if (report.canvas.width !== viewpoint.width || report.canvas.height !== viewpoint.height) {
    problems.push(
      `canvas is ${report.canvas.width}x${report.canvas.height}, expected ${viewpoint.width}x${viewpoint.height}`,
    );
  }
  if (viewpoint.moon?.albedo === 'map') {
    if (report.albedoDecodedMean === null || albedoDecodedMean === null) {
      problems.push('Moon map viewpoint without a decoded albedo mean to compare');
    } else if (Math.abs(report.albedoDecodedMean - albedoDecodedMean) > ALBEDO_DECODE_TOLERANCE) {
      // A colour-managed, premultiplied or resampled decode shifts the mean.
      problems.push(
        `albedo decoded to mean ${report.albedoDecodedMean.toFixed(4)}, pipeline says ${albedoDecodedMean}`,
      );
    }
  }
  if (viewpoint.moon?.relief === true && report.heightDecodedSum !== heightDecodedSum) {
    // Lossless 16-bit heights: any difference at all means the browser decoded them wrongly.
    problems.push(
      `heights decoded to sum ${String(report.heightDecodedSum)}, pipeline says ${String(heightDecodedSum)}`,
    );
  }
  return problems;
}
