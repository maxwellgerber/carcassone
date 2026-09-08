// Build the alternative-move benchmark: roots with several candidate actions each,
// every candidate continued under the frozen deployment policy with the SAME sampled
// tile orders (common random numbers), labelled with the mean continuation value.
// This is the supervision the game trajectories cannot give: which of the moves
// available at a position is better, not merely how the taken move turned out.
//
//   npx tsx research/bench-gen.ts data/gen1/rec-*.json --roots 100 --futures 12 --plies 24 --seed 1 --out data/bench/b-1.json
//
// Candidates per root: the heuristic's top 2, the net's top 2, the blend's top 1,
// and 2 random legal actions (deduplicated), so the set straddles the disagreements.
// Roots are sampled uniformly over games, then uniformly over that game's tile moves,
// and each root records phase (tiles left) and player count for stratified analysis.
import { readFileSync, writeFileSync } from 'node:fs';
import * as E from '../src/shared/engine.js';
import { encode } from '../src/server/features.js';
import { evaluateFor, netValue, NPC_TUNING } from '../src/server/npc.js';
import { mkRng, DECK_SALT } from '../src/shared/rng.js';
import { completeActions, playOut, rootFromRecord, type Rec } from './continue.js';

function arg(name: string, def: string): string { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : def; }
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1]!.startsWith('--')));
const nRoots = Number(arg('roots', '100'));
const futures = Number(arg('futures', '12'));
const plies = Number(arg('plies', '24'));
const seed = Number(arg('seed', '1'));
const out = arg('out', '');
const rng = mkRng(seed * 7919 + 13);

const games: Rec[] = [];
for (const f of files) games.push(...(JSON.parse(readFileSync(f, 'utf8')) as { games: Rec[] }).games);

export interface BenchRoot {
  game: number; stopAt: number; players: number; tilesLeft: number; me: number;
  candidates: { label: string; x: number[]; hand: number; net: number; q: number; se: number; per: number[] }[];
}
const roots: BenchRoot[] = [];
const started = Date.now();
while (roots.length < nRoots) {
  const rec = games[Math.floor(rng() * games.length)]!;
  const tileMoves = rec.actions.map((a, i) => (a[0] === 't' ? i : -1)).filter((i) => i >= 0);
  const stopAt = tileMoves[Math.floor(rng() * tileMoves.length)]!;
  const root = rootFromRecord(rec, stopAt, DECK_SALT);
  if (root.phase !== 'placeTile' || !root.currentTile || root.deck.length < 2) continue;
  const me = root.currentPlayer;
  const acts = completeActions(root);
  if (acts.length < 3) continue;
  const scored = acts.map((a, i) => {
    const f = E.deriveFeatures(a.state);
    NPC_TUNING.evaluator = 'hand'; const hand = evaluateFor(a.state, me, f);
    NPC_TUNING.evaluator = 'blend'; const blend = evaluateFor(a.state, me, f);
    return { i, hand, net: netValue(a.state, me, f), blend, x: Array.from(encode(a.state, me, f)) };
  });
  const top = (key: 'hand' | 'net' | 'blend', k: number) => [...scored].sort((p, q) => q[key] - p[key]).slice(0, k).map((s) => s.i);
  const chosen = new Set<number>([...top('hand', 2), ...top('net', 2), ...top('blend', 1)]);
  while (chosen.size < Math.min(acts.length, 7)) chosen.add(Math.floor(rng() * acts.length));
  const tileSeeds = Array.from({ length: futures }, () => Math.floor(rng() * 0xffffffff));
  const polSeeds = Array.from({ length: futures }, () => Math.floor(rng() * 0xffffffff));
  const candidates = [...chosen].map((i) => {
    const per = tileSeeds.map((ts, k) => playOut(acts[i]!.state, me, ts, polSeeds[k]!, plies).value);
    const q = per.reduce((a, b) => a + b, 0) / per.length;
    const sd = Math.sqrt(per.reduce((a, b) => a + (b - q) ** 2, 0) / Math.max(1, per.length - 1));
    const s = scored[i]!;
    return { label: acts[i]!.label, x: s.x.map((v) => Math.round(v * 1000) / 1000), hand: s.hand, net: s.net, q, se: sd / Math.sqrt(per.length), per: per.map((v) => Math.round(v * 100) / 100) };
  });
  roots.push({ game: rec.seed, stopAt, players: root.players.length, tilesLeft: root.deck.length + 1, me, candidates });
  if (roots.length % 10 === 0) console.error(`  ${roots.length}/${nRoots} roots (${((Date.now() - started) / 1000).toFixed(0)}s)`);
}
if (out) writeFileSync(out, JSON.stringify({ futures, plies, seed, roots }));
console.log(`${roots.length} roots, ${roots.reduce((s, r) => s + r.candidates.length, 0)} candidates, ${futures} shared futures × ${plies} plies${out ? ` → ${out}` : ''}`);
