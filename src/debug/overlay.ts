import type { WebGPURenderer } from 'three/webgpu';
import { FrameStats, type Percentiles } from '../core/frameStats';
import { BUILD_ID } from './errors';

/** Redraw twice a second. The overlay allocates when it redraws; the frame path never does. */
const REFRESH_MS = 500;
const HISTOGRAM_WIDTH = 300;
const HISTOGRAM_HEIGHT = 64;
/** Frame times at or above this fill the histogram's full height. */
const HISTOGRAM_CEILING_MS = 50;
const BUDGET_LINES_MS = [16.7, 33.3] as const;

interface HeapInfo {
  usedJSHeapSize: number;
}

const format = (ms: number): string => (Number.isNaN(ms) ? '–' : ms.toFixed(1));
const row = (label: string, p: Percentiles): string =>
  `${label.padEnd(9)} p50 ${format(p.p50).padStart(5)}  p95 ${format(p.p95).padStart(5)}  p99 ${format(p.p99).padStart(5)}  max ${format(p.max).padStart(5)} ms`;

/**
 * `?debug`: frame-time percentiles and histogram, GPU time, draw statistics and JS heap.
 * GPU time comes from timestamp queries, which only exist when the adapter offers them;
 * the overlay says so instead of showing a number it does not have.
 */
export class DebugOverlay {
  private readonly interval = new FrameStats(HISTOGRAM_WIDTH);
  private readonly work = new FrameStats(HISTOGRAM_WIDTH);
  private readonly intervalP: Percentiles = { p50: 0, p95: 0, p99: 0, max: 0, count: 0 };
  private readonly workP: Percentiles = { p50: 0, p95: 0, p99: 0, max: 0, count: 0 };
  private readonly ordered = new Float64Array(HISTOGRAM_WIDTH);
  private readonly text: HTMLPreElement;
  private readonly context: CanvasRenderingContext2D | null;
  private gpuMs = Number.NaN;
  private lastRefresh = 0;
  private drawCalls = 0;
  /** Milliseconds from navigation start to the first rendered frame; NaN until then. */
  private readonly firstFrameMs = new Float64Array([Number.NaN]);
  private triangles = 0;

  private readonly renderer: WebGPURenderer;
  private readonly gpuTimingAvailable: boolean;

  constructor(renderer: WebGPURenderer, gpuTimingAvailable: boolean) {
    this.renderer = renderer;
    this.gpuTimingAvailable = gpuTimingAvailable;
    const panel = document.createElement('div');
    panel.id = 'debug';
    panel.style.cssText =
      'position:fixed;top:8px;left:8px;padding:8px 10px;background:rgba(0,0,0,.72);color:#e4e5e8;' +
      'font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;border-radius:4px;pointer-events:none;';
    const canvas = document.createElement('canvas');
    canvas.width = HISTOGRAM_WIDTH;
    canvas.height = HISTOGRAM_HEIGHT;
    canvas.style.cssText = `display:block;width:${HISTOGRAM_WIDTH}px;height:${HISTOGRAM_HEIGHT}px;margin-bottom:6px;`;
    this.context = canvas.getContext('2d');
    this.text = document.createElement('pre');
    this.text.style.margin = '0';
    panel.append(canvas, this.text);
    document.body.append(panel);
  }

  /** Called once, on the first frame. */
  firstFrame(msSinceNavigation: number): void {
    this.firstFrameMs[0] = msSinceNavigation;
  }

  /** Called once per frame, after rendering. Allocation-free except when it redraws. */
  frame(now: number, intervalMs: number, workMs: number): void {
    this.interval.push(intervalMs);
    this.work.push(workMs);
    this.drawCalls = this.renderer.info.render.drawCalls;
    this.triangles = this.renderer.info.render.triangles;
    if (now - this.lastRefresh >= REFRESH_MS) {
      this.lastRefresh = now;
      this.refresh();
    }
  }

  private refresh(): void {
    if (this.gpuTimingAvailable) {
      // Resolving also drains three's query pool, which overflows if never resolved.
      void this.renderer.resolveTimestampsAsync('render').then((ms) => {
        if (typeof ms === 'number') this.gpuMs = ms;
      });
    }
    this.interval.percentiles(this.intervalP);
    this.work.percentiles(this.workP);
    this.drawHistogram();

    const heap = (performance as Performance & { memory?: HeapInfo }).memory;
    // Bytes over the wire for the page and everything it fetched. Safari reports
    // transferSize for same-origin resources; 0 means served from cache.
    let transferred = 0;
    for (const entry of performance.getEntriesByType('navigation'))
      transferred += (entry as PerformanceNavigationTiming).transferSize;
    for (const entry of performance.getEntriesByType('resource'))
      transferred += (entry as PerformanceResourceTiming).transferSize;
    this.text.textContent = [
      row('interval', this.intervalP),
      row('cpu work', this.workP),
      this.gpuTimingAvailable
        ? `gpu       ${format(this.gpuMs)} ms (last resolved frame)`
        : 'gpu       unavailable: adapter lacks timestamp-query',
      `draws     ${this.drawCalls}   triangles ${this.triangles}`,
      heap
        ? `js heap   ${(heap.usedJSHeapSize / 1048576).toFixed(1)} MB`
        : 'js heap   not exposed by this browser',
      `window    last ${this.intervalP.count} frames`,
      `load      first frame ${format(this.firstFrameMs[0] ?? Number.NaN)} ms, ${(transferred / 1048576).toFixed(2)} MB transferred`,
      `build     ${BUILD_ID}`,
    ].join('\n');
  }

  private drawHistogram(): void {
    const g = this.context;
    if (g === null) return;
    const n = this.interval.copyOrdered(this.ordered);
    const scale = HISTOGRAM_HEIGHT / HISTOGRAM_CEILING_MS;
    g.clearRect(0, 0, HISTOGRAM_WIDTH, HISTOGRAM_HEIGHT);
    for (let i = 0; i < n; i++) {
      const ms = this.ordered[i] ?? 0;
      const h = Math.min(HISTOGRAM_HEIGHT, ms * scale);
      g.fillStyle = ms > 33.3 ? '#ff6b6b' : ms > 16.7 ? '#f0c060' : '#6fcf97';
      g.fillRect(HISTOGRAM_WIDTH - n + i, HISTOGRAM_HEIGHT - h, 1, h);
    }
    g.fillStyle = 'rgba(255,255,255,.35)';
    for (const ms of BUDGET_LINES_MS)
      g.fillRect(0, HISTOGRAM_HEIGHT - ms * scale, HISTOGRAM_WIDTH, 1);
  }
}
