// Self-play data for the learned evaluator: whole games between the search bots
// (with a little randomness for variety), recording the feature vector of every
// position from the mover's seat together with how that seat's game finally ended.
//
//   npx tsx scripts/selfplay.ts --games 400 --seed 1 --out data/selfplay-1.json [--eval net]
import * as E from '../src/shared/engine.js';
import { chooseNpcMeepleMove, chooseNpcTilePlacement, evaluateFor, NPC_TUNING } from '../src/server/npc.js';
import { encode, FEATURE_DIM } from '../src/server/features.js';
import { mkRng } from '../src/shared/rng.js';
import { writeFileSync } from 'node:fs';

function arg(name: string, def: string): string { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : def; }
const games = Number(arg('games', '200'));
const seed = Number(arg('seed', '1'));
const out = arg('out', '');
const epsilon = Number(arg('epsilon', '0.12'));
NPC_TUNING.evaluator = arg('eval', 'hand') as typeof NPC_TUNING.evaluator;

const xs: number[][] = [], ys: number[] = [], hs: number[] = [];
const started = Date.now();
for (let gi = 0; gi < games; gi++) {
  const rng = mkRng(seed * 7_919 + gi * 104_729);
  const n = 2 + Math.floor(rng() * 3); // 2..4 players
  const config = { farmScoring: rng() < 0.8, quickGame: rng() < 0.25, river: rng() < 0.2 };
  const g = E.createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isNpc: true })), rng, config);
  const samples: { x: number[]; seat: number; h: number }[] = [];
  let guard = 0;
  while (g.phase !== 'gameover') {
    if (++guard > 1500) throw new Error('runaway');
    const seat = g.currentPlayer;
    const explore = rng() < epsilon;
    if (g.phase === 'placeTile') {
      const legal = E.getLegalPlacements(g);
      const p = explore ? legal[Math.floor(rng() * legal.length)]! : chooseNpcTilePlacement(g, 'normal', rng);
      E.placeTile(g, p.x, p.y, p.rot);
    } else {
      const opts = E.getMeepleOptions(g);
      if (explore) { if (opts.length && rng() < 0.5) { const o = opts[Math.floor(rng() * opts.length)]!; E.placeMeeple(g, o.kind, o.idx); } else E.skipMeeple(g); }
      else { const mv = chooseNpcMeepleMove(g, 'normal', rng); if (mv.type === 'place_meeple') E.placeMeeple(g, mv.kind, mv.idx); else E.skipMeeple(g); }
    }
    if (g.phase === 'gameover') break;
    // The position after the move, from the mover's seat; every third move also from
    // everyone else's, so the net sees "waiting" positions too.
    const f = E.deriveFeatures(g);
    const seats = guard % 3 === 0 ? g.players.map((_, i) => i) : [seat];
    for (const s of seats) samples.push({ x: [...encode(g, s, f)].map((v) => Math.round(v * 1000) / 1000), seat: s, h: evaluateFor(g, s, f) });
  }
  const scores = g.players.map((p) => p.score);
  for (const smp of samples) {
    const mine = scores[smp.seat]!;
    const best = Math.max(...scores.filter((_, i) => i !== smp.seat));
    xs.push(smp.x); ys.push(Math.max(-2, Math.min(2, (mine - best) / 40))); hs.push(smp.h / 40);
  }
  if ((gi + 1) % 25 === 0) console.error(`  ${gi + 1}/${games} games, ${xs.length} samples (${((Date.now() - started) / 1000).toFixed(0)}s)`);
}
const doc = { dim: FEATURE_DIM, x: xs, y: ys, h: hs };
if (out) writeFileSync(out, JSON.stringify(doc));
console.log(`${games} games → ${xs.length} samples, dim ${FEATURE_DIM}${out ? ` → ${out}` : ''}`);
