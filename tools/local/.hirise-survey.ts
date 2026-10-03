import { readFileSync } from 'node:fs';
import { BlockStore } from './grids.ts';
import { MarsLadder, hiriseModels } from './mars.ts';
const cache = '/home/user/solar-system/.cache/local-test/mars';
const store = new BlockStore(cache, 6, () => undefined);
const ladder = new MarsLadder(store, cache, (m) => { if (m.startsWith('HiRISE')) console.log(m); });
const models = hiriseModels(readFileSync(`${cache}/files/hirise-dtmcumindex.tab`, 'utf8'));
let seed = 2026;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const picked = Array.from({ length: 12 }, () => models[Math.floor(rand() * models.length)]!);
for (const m of picked) {
  try { await (ladder as unknown as { verdict(m: unknown): Promise<unknown> }).verdict(m); }
  catch (e) { console.log(`${m.id}: error ${String(e).slice(0, 200)}`); }
}
