// FROZEN harness step 1: turn self-play game records into a fixed, binary train/val
// split using the *current* encoder (src/server/features.ts). Re-run this after any
// encoder change; never edit the split rules themselves mid-study, or results stop
// being comparable.
//
//   npx tsx research/prepare.ts data/gen1/rec-*.json [--out data/research]
//
// Outputs <out>/{train,val}.{x,y}.f32 (raw little-endian float32) and meta.json.
// The val split is by GAME (every position of a game goes to one side), so the
// metric measures generalisation to unseen games, not unseen moments of seen ones.
import * as E from '../src/shared/engine.js';
import { encode, FEATURE_DIM } from '../src/server/features.js';
import { mkRng, DECK_SALT } from '../src/shared/rng.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

function arg(name: string, def: string): string { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : def; }
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1]!.startsWith('--')));
const outDir = arg('out', 'data/research');
const valFrac = Number(arg('val', '0.1'));
mkdirSync(outDir, { recursive: true });

interface Rec { seed: number; n: number; config: { farmScoring: boolean; quickGame: boolean; river: boolean }; actions: (number | string)[][]; scores: number[] }
const games: Rec[] = [];
for (const f of files) games.push(...(JSON.parse(readFileSync(f, 'utf8')) as { games: Rec[] }).games);
console.log(`${games.length} game records from ${files.length} files`);

const trainX: number[] = [], trainY: number[] = [], valX: number[] = [], valY: number[] = [];
let nTrain = 0, nVal = 0;
const split = mkRng(1234);
const t0 = Date.now();
games.forEach((rec, gi) => {
  const isVal = split() < valFrac;
  const g = E.createGame(Array.from({ length: rec.n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isNpc: true })), mkRng((rec.seed ^ DECK_SALT) >>> 0), rec.config);
  const X = isVal ? valX : trainX, Y = isVal ? valY : trainY;
  let step = 0;
  for (const a of rec.actions) {
    const seat = g.currentPlayer;
    if (a[0] === 't') E.placeTile(g, a[1] as number, a[2] as number, a[3] as number);
    else if (a[0] === 'm') E.placeMeeple(g, a[1] as 'city', a[2] as number);
    else E.skipMeeple(g);
    if (g.phase === 'gameover') break;
    step++;
    const f = E.deriveFeatures(g);
    const seats = step % 3 === 0 ? g.players.map((_, i) => i) : [seat];
    for (const s of seats) {
      const v = encode(g, s, f);
      for (let i = 0; i < v.length; i++) X.push(v[i]!);
      const mine = rec.scores[s]!, best = Math.max(...rec.scores.filter((_, i) => i !== s));
      Y.push(Math.max(-2, Math.min(2, (mine - best) / 40)));
      if (isVal) nVal++; else nTrain++;
    }
  }
  const finalScores = g.players.map((p) => p.score);
  if (finalScores.some((sc, i) => sc !== rec.scores[i])) throw new Error(`record ${gi} did not replay to its recorded scores (${finalScores} vs ${rec.scores})`);
  if ((gi + 1) % 500 === 0) console.error(`  ${gi + 1}/${games.length} games replayed (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
});
const f32 = (a: number[]) => Buffer.from(new Float32Array(a).buffer);
writeFileSync(`${outDir}/train.x.f32`, f32(trainX)); writeFileSync(`${outDir}/train.y.f32`, f32(trainY));
writeFileSync(`${outDir}/val.x.f32`, f32(valX)); writeFileSync(`${outDir}/val.y.f32`, f32(valY));
writeFileSync(`${outDir}/meta.json`, JSON.stringify({ dim: FEATURE_DIM, train: nTrain, val: nVal, games: games.length, files, preparedAt: new Date().toISOString() }));
console.log(`train ${nTrain} / val ${nVal} samples, dim ${FEATURE_DIM} → ${outDir} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
