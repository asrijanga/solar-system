// npm run capture:diff [-- <viewpoint id> ...]
// Compares captures/ against baselines/. Writes captures/<id>.diff.png for anything that
// differs, and exits non-zero if any viewpoint is over tolerance, missing, or new.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { viewpoints } from '../../src/capture/viewpoints.ts';
import { compareImages, TOLERANCE } from './compare.ts';
import { baselinesDir, capturesDir, diffPath, pngPath, sidecarPath } from './paths.ts';

interface Sidecar {
  environment: { chromium: string; three: string; playwright: string };
}

function readSidecar(dir: string, id: string): Sidecar | null {
  const path = sidecarPath(dir, id);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Sidecar) : null;
}

function main(): number {
  const requested = process.argv.slice(2);
  const known = viewpoints.map((v) => v.id);
  const ids = requested.length > 0 ? requested : known;
  let failures = 0;

  console.log(
    `tolerance: threshold ${TOLERANCE.threshold}, at most ${(TOLERANCE.maxDiffRatio * 100).toFixed(3)}% of pixels, mean shift at most ${TOLERANCE.maxMeanChannelDelta}`,
  );

  for (const id of ids) {
    const capture = pngPath(capturesDir, id);
    const baseline = pngPath(baselinesDir, id);
    if (!existsSync(capture)) {
      console.log(`FAIL ${id}: no capture. Run \`npm run capture\` first.`);
      failures++;
      continue;
    }
    if (!existsSync(baseline)) {
      console.log(
        `FAIL ${id}: no baseline. Review captures/${id}.png, then \`npm run capture:accept -- ${id}\`.`,
      );
      failures++;
      continue;
    }

    const result = compareImages(
      PNG.sync.read(readFileSync(baseline)),
      PNG.sync.read(readFileSync(capture)),
    );
    if (result.diff !== null && result.differingPixels > 0) {
      writeFileSync(diffPath(id), PNG.sync.write(result.diff));
    }
    const summary = `${result.differingPixels} of ${result.totalPixels} pixels differ, mean shift ${result.meanChannelDelta.toFixed(2)}`;
    console.log(
      result.pass ? `ok   ${id}: ${summary}` : `FAIL ${id}: ${result.reasons.join('; ')}`,
    );
    if (!result.pass) failures++;

    // A changed environment explains many diffs. Say so, but never let it excuse one.
    const was = readSidecar(baselinesDir, id)?.environment;
    const now = readSidecar(capturesDir, id)?.environment;
    if (was && now) {
      for (const key of ['chromium', 'three', 'playwright'] as const) {
        if (was[key] !== now[key]) {
          console.log(`     note: ${key} was ${was[key]} for the baseline, now ${now[key]}`);
        }
      }
    }
  }

  // Baselines for viewpoints that no longer exist are a mistake worth surfacing.
  if (existsSync(baselinesDir)) {
    for (const file of readdirSync(baselinesDir).filter((f) => f.endsWith('.png'))) {
      const id = file.slice(0, -'.png'.length);
      if (!known.includes(id)) {
        console.log(`FAIL ${id}: baseline exists but the viewpoint does not`);
        failures++;
      }
    }
  }

  console.log(failures === 0 ? 'all captures match' : `${failures} failing`);
  return failures === 0 ? 0 : 1;
}

process.exit(main());
