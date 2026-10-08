// npm run capture [-- <viewpoint id> ...]
// Serves the production build, renders each viewpoint twice in headless Chromium on
// SwiftShader WebGPU, and writes captures/<id>.png plus a JSON sidecar.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import { preview } from 'vite';
import type { CaptureReport } from '../../src/capture/protocol.ts';
import { findViewpoint, viewpoints, type Viewpoint } from '../../src/capture/viewpoints.ts';
import { judge } from './checks.ts';
import { MARS_TERRAIN_SITE } from '../../src/scenes/marsSite.ts';
import type { EphemerisFile } from './moon.ts';
import { compareImages, identicalPixels } from './compare.ts';
import { capturesDir, distDir, pngPath, root, sidecarPath } from './paths.ts';
import { verifyReport, type Ready } from './verify.ts';

/** Chromium flags that expose SwiftShader, a CPU implementation of WebGPU, to the page. */
const SWIFTSHADER_FLAGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--use-angle=swiftshader',
];

/** The Moon's 8192 x 4096 map is decoded and mipmapped on the CPU under SwiftShader. */
const READY_TIMEOUT_MS = 180_000;

/** Each world's ephemeris and the albedo bytes' mean its pipeline recorded. */
function worldData(world: 'moon' | 'mars'): {
  ephemeris: EphemerisFile;
  albedoDecodedMean: number;
} {
  const dir = join(root, 'public', 'data', world);
  const albedo = JSON.parse(readFileSync(join(dir, 'albedo.json'), 'utf8')) as {
    calibration?: { decodedMean: number };
    texture: { decodedMean?: number };
  };
  const mean = albedo.calibration?.decodedMean ?? albedo.texture.decodedMean;
  if (mean === undefined) throw new Error(`${world}'s albedo.json records no decoded mean`);
  return {
    ephemeris: JSON.parse(readFileSync(join(dir, 'ephemeris.json'), 'utf8')) as EphemerisFile,
    albedoDecodedMean: mean,
  };
}
const WORLDS = { moon: worldData('moon'), mars: worldData('mars') };
/** The page a viewpoint is rendered on: Mars's for Mars, the Moon's for everything else. */
const worldOf = (viewpoint: Viewpoint): 'moon' | 'mars' =>
  viewpoint.scene === 'mars' ? 'mars' : 'moon';

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function packageVersion(name: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  return String(pkg.version);
}

async function render(
  browser: Browser,
  baseUrl: string,
  viewpoint: Viewpoint,
): Promise<{ png: Buffer; report: Ready }> {
  // A fresh context per render: no cache, storage or GPU state shared between runs.
  const context = await browser.newContext({
    viewport: { width: viewpoint.width, height: viewpoint.height },
    deviceScaleFactor: 1,
  });
  try {
    // Behind an HTTPS proxy (a sandbox), Chromium cannot reach Mars's data site (docs/stories/
    // SS-14.md, W4) itself; Node fetches its files for it, byte for byte. Elsewhere, as in CI,
    // the browser fetches them directly.
    if (process.env['HTTPS_PROXY'] !== undefined) {
      await context.route(`${MARS_TERRAIN_SITE}**`, async (route) => {
        const response = await fetch(route.request().url());
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
    }
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`${baseUrl}${worldOf(viewpoint)}/?capture=${encodeURIComponent(viewpoint.id)}`);
    await page.waitForFunction(() => window.__capture !== undefined, null, {
      timeout: READY_TIMEOUT_MS,
    });
    const report = (await page.evaluate(() => window.__capture)) as CaptureReport;
    if (report.status !== 'ready') {
      throw new Error(`${viewpoint.id}: app refused: ${report.reason}`);
    }
    if (errors.length > 0) throw new Error(`${viewpoint.id}: page errors: ${errors.join(' | ')}`);
    const problems = verifyReport(report, viewpoint, WORLDS[worldOf(viewpoint)].albedoDecodedMean);
    if (problems.length > 0) {
      throw new Error(`refusing to write ${viewpoint.id}: ${problems.join('; ')}`);
    }
    const png = await page.locator('#app').screenshot({ animations: 'disabled', caret: 'hide' });
    return { png, report };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  const selected = ids.length === 0 ? viewpoints : ids.map((id) => findViewpoint(id));
  const missing = ids.filter((_, i) => selected[i] === undefined);
  if (missing.length > 0) throw new Error(`unknown viewpoint(s): ${missing.join(', ')}`);
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error('no production build in dist/. Run `npm run build` first.');
  }

  mkdirSync(capturesDir, { recursive: true });
  const server = await preview({
    root,
    logLevel: 'silent',
    preview: { port: 0, strictPort: false, open: false },
  });
  const baseUrl = server.resolvedUrls?.local[0];
  if (baseUrl === undefined) throw new Error('vite preview did not report a URL');

  const browser = await chromium.launch({ args: SWIFTSHADER_FLAGS });
  try {
    const sha = git('rev-parse', 'HEAD');
    const dirty = git('status', '--porcelain').length > 0;
    const failures: string[] = [];
    for (const viewpoint of selected as Viewpoint[]) {
      const first = await render(browser, baseUrl, viewpoint);
      const second = await render(browser, baseUrl, viewpoint);
      const a = PNG.sync.read(first.png);
      const b = PNG.sync.read(second.png);
      const identical = identicalPixels(a, b);
      const repeatDiff = identical
        ? 0
        : compareImages(a, b, { threshold: 0, maxDiffRatio: 0, maxMeanChannelDelta: 0 });

      writeFileSync(pngPath(capturesDir, viewpoint.id), first.png);
      const verdict = judge(a, viewpoint, WORLDS[worldOf(viewpoint)].ephemeris);
      const sidecar = {
        viewpoint,
        environment: {
          chromium: browser.version(),
          playwright: packageVersion('playwright'),
          three: first.report.threeRevision,
          backend: first.report.backend,
          adapter: first.report.adapter,
        },
        canvas: first.report.canvas,
        devicePixelRatio: first.report.devicePixelRatio,
        determinism: {
          renders: 2,
          identical,
          differingPixels: typeof repeatDiff === 'number' ? 0 : repeatDiff.differingPixels,
        },
        checks: {
          negativeControl: viewpoint.negativeControl,
          ok: verdict.ok,
          results: verdict.results,
        },
        git: { sha, dirty },
      };
      writeFileSync(
        sidecarPath(capturesDir, viewpoint.id),
        `${JSON.stringify(sidecar, null, 2)}\n`,
      );
      const note = identical ? 'identical across 2 renders' : 'NOT identical across 2 renders';
      console.log(`captured ${viewpoint.id} (${viewpoint.width}x${viewpoint.height}), ${note}`);
      for (const result of verdict.results) {
        const expected = viewpoint.negativeControl ? 'expected to fail' : 'expected to pass';
        console.log(
          `  check "${result.name}": ${result.pass ? 'pass' : 'fail'} (${(result.fraction * 100).toFixed(2)}% matching, ${expected})`,
        );
      }
      if (!verdict.ok) failures.push(`${viewpoint.id}: ${verdict.message ?? 'checks failed'}`);
      if (!identical) {
        console.warn(
          `  warning: ${sidecar.determinism.differingPixels} pixels differ between two renders on this machine`,
        );
      }
    }
    if (failures.length > 0) {
      throw new Error(`pixel checks failed:\n  ${failures.join('\n  ')}`);
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  // In GitHub Actions, also as annotations, which can be read without the job log.
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    for (const line of message.split('\n').slice(0, 8))
      console.log(`::error::${line.slice(0, 400)}`);
  }
  process.exit(1);
});
