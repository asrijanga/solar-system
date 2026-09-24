// The contract between the app in capture mode and the headless harness.
// The app sets window.__capture exactly once, after the frame's GPU work has completed.

export interface CaptureAdapter {
  readonly vendor: string;
  readonly architecture: string;
  readonly isFallbackAdapter: boolean;
}

export type CaptureReport =
  | {
      readonly status: 'ready';
      readonly viewpoint: string;
      /** Read back from the live renderer, not assumed. */
      readonly backend: 'webgpu' | 'other';
      readonly threeRevision: string;
      readonly adapter: CaptureAdapter;
      /** Drawing-buffer size in device pixels. */
      readonly canvas: { readonly width: number; readonly height: number };
      readonly devicePixelRatio: number;
    }
  | { readonly status: 'refused'; readonly reason: string };

declare global {
  interface Window {
    __capture?: CaptureReport;
  }
}
