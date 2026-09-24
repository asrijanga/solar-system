// Canonical viewpoints for headless captures. Once a viewpoint has a committed baseline,
// it never changes: a new view gets a new id. The harness and the app both read this list.

export interface Viewpoint {
  readonly id: string;
  /** What the capture proves, in one sentence. */
  readonly description: string;
  /** Canvas size in CSS pixels. Captures always run at devicePixelRatio 1. */
  readonly width: number;
  readonly height: number;
  /** Simulation time, as an ISO 8601 TDB epoch. null until the scene has a clock. */
  readonly epoch: string | null;
  /** Camera pose. null until the scene has a camera worth pinning (SS-3). */
  readonly camera: null;
}

export const viewpoints: readonly Viewpoint[] = [
  {
    id: 'clear',
    description:
      'The SS-1 clear colour. Proves the harness end to end: build, serve, WebGPU on SwiftShader, ready signal, capture, compare.',
    width: 1024,
    height: 1024,
    epoch: null,
    camera: null,
  },
];

export function findViewpoint(id: string): Viewpoint | undefined {
  return viewpoints.find((v) => v.id === id);
}
