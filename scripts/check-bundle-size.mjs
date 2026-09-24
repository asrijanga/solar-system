// Fails the build when the initial JavaScript exceeds the budget in README "Budgets".
// Brotli at maximum quality approximates what a CDN serves.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const BUDGET_BYTES = 400 * 1024;
const assets = join(import.meta.dirname, '..', 'dist', 'assets');

let total = 0;
for (const file of readdirSync(assets).filter((f) => f.endsWith('.js'))) {
  const size = brotliCompressSync(readFileSync(join(assets, file)), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  total += size;
  console.log(`${file}: ${(size / 1024).toFixed(1)} KB brotli`);
}

const verdict = total <= BUDGET_BYTES ? 'within' : 'OVER';
console.log(
  `total: ${(total / 1024).toFixed(1)} KB of ${BUDGET_BYTES / 1024} KB budget (${verdict})`,
);
if (total > BUDGET_BYTES) process.exit(1);
