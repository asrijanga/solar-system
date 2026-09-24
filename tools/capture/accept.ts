// npm run capture:accept -- <viewpoint id> ... | --all
// The only way baselines change. Copies captures/<id>.png and its sidecar into baselines/.
// Commit the result on its own, with before and after images in the PR (CLAUDE.md).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { findViewpoint, viewpoints } from '../../src/capture/viewpoints.ts';
import { baselinesDir, capturesDir, pngPath, sidecarPath } from './paths.ts';

function main(): number {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Name the viewpoints to accept, or pass --all. Nothing is accepted by default.');
    return 1;
  }
  const ids = args.includes('--all') ? viewpoints.map((v) => v.id) : args;

  for (const id of ids) {
    if (findViewpoint(id) === undefined) {
      console.error(`unknown viewpoint: ${id}`);
      return 1;
    }
    if (!existsSync(pngPath(capturesDir, id)) || !existsSync(sidecarPath(capturesDir, id))) {
      console.error(`no capture for ${id}. Run \`npm run capture\` first.`);
      return 1;
    }
    const sidecar = JSON.parse(readFileSync(sidecarPath(capturesDir, id), 'utf8'));
    if (sidecar.git?.dirty === true) {
      console.warn(`warning: ${id} was captured from a working tree with uncommitted changes`);
    }
  }

  mkdirSync(baselinesDir, { recursive: true });
  for (const id of ids) {
    copyFileSync(pngPath(capturesDir, id), pngPath(baselinesDir, id));
    copyFileSync(sidecarPath(capturesDir, id), sidecarPath(baselinesDir, id));
    console.log(`accepted ${id}`);
  }
  console.log('Commit baselines/ in a commit of its own, with before and after images in the PR.');
  return 0;
}

process.exit(main());
