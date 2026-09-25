// npm run alloc
// Measures JavaScript allocation in the interactive render loop: 600 frames under Chrome's
// sampling heap profiler, every sample attributed to the code that allocated it. Fails if
// any allocation on the per-frame path comes from this repo's code. Allocation inside
// three.js is reported, not failed: it is measured here so it can be tracked, not fixed.
//
// Runs against the Vite dev server rather than the bundle, so that src/ and three.js arrive
// as separate script URLs and each allocation can be attributed to one or the other.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { attribute, type SamplingProfile } from './attribute.ts';

const SWIFTSHADER_FLAGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--use-angle=swiftshader',
];

/** Frames to run before measuring, so pipelines compile and caches settle. */
// V8 tiers the frame function up (Maglev, then TurboFan) only after hundreds of calls,
// and at SwiftShader's few frames a second that used to land inside the measured window:
// CI sampled 96 to 180 B "in frame" twice, from compilation and deoptimisation, not from
// the per-frame code. Warm up as long as we measure so the JIT has settled first. Owner
// approved 2026-09-25 (docs/stories/SS-6.md). The pass rule, 0 B from src/, is unchanged.
const WARMUP_FRAMES = 600;
const MEASURED_FRAMES = 600;
/**
 * Mean bytes between samples. Sampling is Poisson: an allocation of s bytes is sampled with
 * probability about s / 64. 600 frames of even one 32-byte allocation per frame would yield
 * around 300 samples, so zero samples is strong evidence of zero allocation.
 */
const SAMPLING_INTERVAL = 64;

const root = join(import.meta.dirname, '..', '..');

async function framesRendered(page: import('playwright').Page): Promise<number> {
  return page.evaluate(() => window.__stats?.frames ?? 0);
}

async function main(): Promise<number> {
  const server = await createServer({
    root,
    logLevel: 'silent',
    server: { port: 0, strictPort: false },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (base === undefined) throw new Error('vite dev server did not report a URL');

  const browser = await chromium.launch({ args: SWIFTSHADER_FLAGS });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}?software`);
    await page.waitForFunction(() => document.documentElement.dataset['ready'] === 'true', null, {
      timeout: 180_000,
    });
    await page.waitForFunction((n) => (window.__stats?.frames ?? 0) >= n, WARMUP_FRAMES, {
      timeout: 900_000,
      polling: 250,
    });

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.startSampling', {
      samplingInterval: SAMPLING_INTERVAL,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    const startFrame = await framesRendered(page);
    const startTime = Date.now();
    await page.waitForFunction(
      (n) => (window.__stats?.frames ?? 0) >= n,
      startFrame + MEASURED_FRAMES,
      // SwiftShader draws the textured Moon at under 3 frames a second: 600 frames took
      // 225 s locally (docs/stories/SS-6.md). A wait limit, not a pass criterion.
      { timeout: 900_000, polling: 250 },
    );
    const { profile } = (await cdp.send('HeapProfiler.stopSampling')) as {
      profile: SamplingProfile;
    };
    const frames = (await framesRendered(page)) - startFrame;
    const seconds = (Date.now() - startTime) / 1000;
    if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);

    const result = attribute(profile);
    const perFrame = (bytes: number): string => (bytes / frames).toFixed(1);
    const report = {
      frames,
      seconds,
      samplingInterval: SAMPLING_INTERVAL,
      perFrameBytes: {
        frameLoopTotal: result.frameLoop.bytes / frames,
        ours: result.frameLoop.ours.bytes / frames,
        three: result.frameLoop.three.bytes / frames,
        other: result.frameLoop.other.bytes / frames,
      },
      ourSites: result.frameLoop.ours.sites,
      threeSites: result.frameLoop.three.sites.slice(0, 15),
      outsideFrameLoopBytes: result.outside.bytes,
    };
    mkdirSync(join(root, 'captures'), { recursive: true });
    writeFileSync(join(root, 'captures', 'alloc.json'), `${JSON.stringify(report, null, 2)}\n`);

    console.log(
      `${frames} frames in ${seconds.toFixed(1)} s, sampling every ${SAMPLING_INTERVAL} bytes`,
    );
    console.log(`per-frame allocation on the frame path (sampled estimate):`);
    console.log(
      `  ours (src/)      ${perFrame(result.frameLoop.ours.bytes)} B  in ${result.frameLoop.ours.samples} samples`,
    );
    console.log(
      `  three.js         ${perFrame(result.frameLoop.three.bytes)} B  in ${result.frameLoop.three.samples} samples`,
    );
    console.log(
      `  other/native     ${perFrame(result.frameLoop.other.bytes)} B  in ${result.frameLoop.other.samples} samples`,
    );
    for (const site of result.frameLoop.three.sites.slice(0, 8)) {
      console.log(`    three: ${site.bytes} B total at ${site.site}`);
    }
    if (result.frameLoop.ours.samples > 0) {
      for (const site of result.frameLoop.ours.sites)
        console.log(`    OURS: ${site.bytes} B at ${site.site}`);
      console.log('FAIL: the frame loop allocates in src/');
      return 1;
    }
    console.log('ok: no allocation sampled in src/ on the frame path');
    return 0;
  } finally {
    await browser.close();
    await server.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
