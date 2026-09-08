// Re-encode a benchmark file's candidates with the LIVE encoder (src/server/features.ts)
// by replaying each root from its self-play record. Needed whenever the encoder changes,
// so the pairwise loss trains on vectors that match the net's inputs.
//
//   npx tsx research/reencode-bench.ts --records 'data/gen1-actions/rec-*.json' --out data/bench-train-v2 data/bench-train/*.json
import { readFileSync, writeFileSync, mkdirSync, globSync } from 'node:fs';
import { basename } from 'node:path';
import * as E from '../src/shared/engine.js';
import { encode } from '../src/server/features.js';
import { DECK_SALT } from '../src/shared/rng.js';
import { completeActions, rootFromRecord, type Rec } from './continue.js';

function arg(name: string, def: string): string { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : def; }
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1]!.startsWith('--')));
const recordsGlob = arg('records', 'data/gen1-actions/rec-*.json');
const outDir = arg('out', 'data/bench-reencoded');
mkdirSync(outDir, { recursive: true });

interface Cand { label: string; x: number[]; q: number; se: number }
interface Root { game: number; stopAt: number; me: number; candidates: Cand[] }
const bySeed = new Map<number, Rec>();
for (const f of globSync(recordsGlob)) for (const r of (JSON.parse(readFileSync(f, 'utf8')) as { games: Rec[] }).games) bySeed.set(r.seed, r);
const t0 = Date.now();
let total = 0, missing = 0;
for (const f of files) {
  const doc = JSON.parse(readFileSync(f, 'utf8')) as { roots: Root[] } & Record<string, unknown>;
  for (const r of doc.roots) {
    const rec = bySeed.get(r.game);
    if (!rec) { missing++; continue; }
    const root = rootFromRecord(rec, r.stopAt, DECK_SALT);
    const acts = new Map(completeActions(root).map((a) => [a.label, a.state]));
    for (const c of r.candidates) {
      const st = acts.get(c.label);
      if (!st) { missing++; continue; }
      c.x = Array.from(encode(st, r.me, E.deriveFeatures(st))).map((v) => Math.round(v * 1000) / 1000);
      total++;
    }
  }
  writeFileSync(`${outDir}/${basename(f)}`, JSON.stringify(doc));
  console.error(`  ${basename(f)}: ${doc.roots.length} roots (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
console.log(`re-encoded ${total} candidates from ${files.length} files → ${outDir} (${missing} missing)`);
