// Diagnostic: how often do different legal actions produce IDENTICAL encodings?
// When they do, no amount of training can make this evaluator prefer one over the
// other. For a few hundred roots: enumerate every complete action, encode the result,
// group identical vectors, and measure how often the net is forced to tie, whether the
// hand heuristic tells those actions apart, and whether shared-future continuations
// find real value differences inside a group.
//
//   npx tsx research/collisions.ts data/gen1/rec-1.json [--roots 150] [--futures 8] [--plies 8]
import { readFileSync } from 'node:fs';
import * as E from '../src/shared/engine.js';
import { encode } from '../src/server/features.js';
import { evaluateFor, netValue, NPC_TUNING } from '../src/server/npc.js';
import { mkRng, DECK_SALT } from '../src/shared/rng.js';
import { completeActions, playOut, rootFromRecord, type Rec } from './continue.js';

function arg(name: string, def: string): string { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : def; }
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1]!.startsWith('--')));
const nRoots = Number(arg('roots', '150'));
const futures = Number(arg('futures', '8'));
const plies = Number(arg('plies', '8'));
const rng = mkRng(777);

const games: Rec[] = [];
for (const f of files) games.push(...(JSON.parse(readFileSync(f, 'utf8')) as { games: Rec[] }).games);

let roots = 0, actions = 0, inGroups = 0, groups = 0, netTiedRoots = 0, netTopGroupSizeSum = 0;
let handSplitsGroup = 0, groupsChecked = 0, rolloutSplit = 0, rolloutChecked = 0;
const spreads: number[] = [];
const examples: string[] = [];
const started = Date.now();
while (roots < nRoots) {
  const rec = games[Math.floor(rng() * games.length)]!;
  // Root at a random tile decision, uniformly over the game's tile moves.
  const tileMoves = rec.actions.map((a, i) => (a[0] === 't' ? i : -1)).filter((i) => i >= 0);
  const stopAt = tileMoves[Math.floor(rng() * tileMoves.length)]!;
  const root = rootFromRecord(rec, stopAt, DECK_SALT);
  if (root.phase !== 'placeTile' || !root.currentTile) continue;
  const me = root.currentPlayer;
  const acts = completeActions(root);
  if (acts.length < 2) continue;
  roots++; actions += acts.length;
  // Group by encoding.
  const byKey = new Map<string, number[]>();
  const nets: number[] = [], hands: number[] = [];
  for (let i = 0; i < acts.length; i++) {
    const f = E.deriveFeatures(acts[i]!.state);
    const v = encode(acts[i]!.state, me, f);
    const key = Array.from(v).join(',');
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(i);
    nets.push(netValue(acts[i]!.state, me, f));
    NPC_TUNING.evaluator = 'hand'; hands.push(evaluateFor(acts[i]!.state, me, f)); NPC_TUNING.evaluator = 'blend';
  }
  const multi = [...byKey.values()].filter((g) => g.length > 1);
  groups += multi.length;
  inGroups += multi.reduce((s, g) => s + g.length, 0);
  // Is the net's favourite action inside a tie group?
  let best = 0; for (let i = 1; i < acts.length; i++) if (nets[i]! > nets[best]!) best = i;
  const topGroup = [...byKey.values()].find((g) => g.includes(best))!;
  if (topGroup.length > 1) { netTiedRoots++; netTopGroupSizeSum += topGroup.length; }
  // Inside tie groups: does the heuristic separate them, and do continuations?
  for (const g of multi.slice(0, 3)) {
    groupsChecked++;
    const hv = g.map((i) => hands[i]!);
    if (Math.max(...hv) - Math.min(...hv) > 0.5) handSplitsGroup++;
    if (g.length > 6 || rolloutChecked >= 60) continue;
    rolloutChecked++;
    // Shared futures: the same tile seeds for every member of the group.
    const means = g.map((i) => {
      let s = 0;
      for (let k = 0; k < futures; k++) s += playOut(acts[i]!.state, me, 1000 + k, 5000 + k, plies).value;
      return s / futures;
    });
    // Paired difference between the best and worst member, with its standard error.
    const hi = means.indexOf(Math.max(...means)), lo = means.indexOf(Math.min(...means));
    const diffs: number[] = [];
    for (let k = 0; k < futures; k++) diffs.push(playOut(acts[g[hi]!]!.state, me, 1000 + k, 5000 + k, plies).value - playOut(acts[g[lo]!]!.state, me, 1000 + k, 5000 + k, plies).value);
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, diffs.length - 1));
    const se = sd / Math.sqrt(diffs.length);
    spreads.push(mean);
    if (mean > 1.0 && mean > 2 * se) {
      rolloutSplit++;
      if (examples.length < 8) examples.push(`root ${rec.seed}@${stopAt} ${root.players.length}p: ${g.map((i) => acts[i]!.label).join(' | ')} → continuation spread ${mean.toFixed(2)} ± ${se.toFixed(2)} pts; hand spread ${(Math.max(...hv) - Math.min(...hv)).toFixed(2)}`);
    }
  }
  if (roots % 25 === 0) console.error(`  ${roots}/${nRoots} roots (${((Date.now() - started) / 1000).toFixed(0)}s)`);
}
console.log(`roots ${roots}, actions ${actions} (${(actions / roots).toFixed(1)}/root)`);
console.log(`actions sharing an encoding with another action: ${(100 * inGroups / actions).toFixed(1)}% (${groups} groups, avg size ${(inGroups / Math.max(1, groups)).toFixed(1)})`);
console.log(`roots where the net's top choice is a forced tie: ${(100 * netTiedRoots / roots).toFixed(1)}% (tie size avg ${(netTopGroupSizeSum / Math.max(1, netTiedRoots)).toFixed(1)})`);
console.log(`tie groups the heuristic separates by > 0.5 pts: ${(100 * handSplitsGroup / Math.max(1, groupsChecked)).toFixed(1)}% of ${groupsChecked}`);
console.log(`tie groups with a real continuation difference (> 1 pt, > 2 SE, ${futures} shared futures × ${plies} plies): ${rolloutSplit}/${rolloutChecked}; spread median ${spreads.sort((a, b) => a - b)[Math.floor(spreads.length / 2)]?.toFixed(2)} pts`);
for (const e of examples) console.log('  e.g. ' + e);
