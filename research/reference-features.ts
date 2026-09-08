// FROZEN: the feature encoder the reference net (research/reference-weights.ts) was
// trained with. research/eval.ts feeds the reference through this, never through the
// live encoder, so encoder experiments are measured against a fixed opponent.
// The learned evaluator's view of a position: a fixed vector built from the feature
// graph rather than a picture of the board. Every meeple-bearing feature is pooled
// into per-group aggregates (me / best opponent / average opponent), which is dense,
// invariant to where the board sits, and exactly what decides the game — who owns
// how much of what, and how close it is to finishing.
import { deriveFeatures, type Features } from '../src/shared/engine.js';
import type { GameState } from '../src/shared/types.js';

/** Length of the vector `encode` returns. Bump when the layout changes. */
export const FEATURE_DIM = 8 + 3 * GROUP_DIM();
function GROUP_DIM(): number { return 26; }

function majorityShare(owners: number[], me: number): { mine: number; theirs: number; share: number } {
  const counts = new Map<number, number>();
  for (const o of owners) counts.set(o, (counts.get(o) ?? 0) + 1);
  const mine = counts.get(me) ?? 0;
  let theirs = 0;
  for (const [p, c] of counts) if (p !== me) theirs = Math.max(theirs, c);
  const max = Math.max(mine, theirs);
  const topCount = [...counts.values()].filter((c) => c === max).length;
  return { mine, theirs, share: mine === max ? 1 / topCount : 0 };
}

/** Aggregate what a single seat holds on the board. */
function groupVector(state: GameState, f: Features, seat: number): number[] {
  const v = new Array<number>(GROUP_DIM()).fill(0);
  const p = state.players[seat]!;
  v[0] = p.score / 50;
  v[1] = p.meeples / 7;
  v[2] = p.meeples === 0 ? 1 : 0;
  // cities: [3] count owned, [4] tiles, [5] shields, [6] open edges, [7] tiles with 1 open, [8] 2 open, [9] 3+ open, [10] contested, [11] outnumbered
  for (const cf of f.cityFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'city' && f.lookups.cityGroupRoot(m.x, m.y, m.idx) === cf.id);
    if (!onIt.some((m) => m.playerIdx === seat)) continue;
    const s = majorityShare(onIt.map((m) => m.playerIdx), seat);
    if (s.share === 0) { v[11]! += 1; continue; }
    v[3]! += s.share; v[4]! += cf.tileCount * s.share / 10; v[5]! += cf.shieldCount * s.share / 3; v[6]! += cf.openEdges * s.share / 6;
    if (cf.openEdges <= 1) v[7]! += cf.tileCount / 10; else if (cf.openEdges === 2) v[8]! += cf.tileCount / 10; else v[9]! += cf.tileCount / 10;
    if (s.share < 1) v[10]! += 1;
  }
  // roads: [12] count, [13] tiles, [14] open edges, [15] tiles with 1 open, [16] 2 open, [17] contested/outnumbered
  for (const rf of f.roadFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'road' && f.lookups.roadGroupRoot(m.x, m.y, m.idx) === rf.id);
    if (!onIt.some((m) => m.playerIdx === seat)) continue;
    const s = majorityShare(onIt.map((m) => m.playerIdx), seat);
    if (s.share === 0) { v[17]! += 1; continue; }
    v[12]! += s.share; v[13]! += rf.tileCount * s.share / 8; v[14]! += rf.openEdges * s.share / 4;
    if (rf.openEdges <= 1) v[15]! += rf.tileCount / 8; else v[16]! += rf.tileCount / 8;
    if (s.share < 1) v[17]! += 0.5;
  }
  // cloisters: [18] count, [19] filled/9 summed, [20] nearly done (7-8 filled)
  for (const mf of f.monasteryFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'monastery' && m.x === mf.x && m.y === mf.y && m.playerIdx === seat);
    if (!onIt.length) continue;
    v[18]! += 1; v[19]! += mf.filled / 9; if (mf.filled >= 7) v[20]! += 1;
  }
  // farms: [21] count, [22] completed cities fed, [23] unfinished cities touching, [24] contested, [25] outnumbered
  if (state.config.farmScoring) {
    const byId = new Map(f.cityFeatures.map((c) => [c.id, c]));
    for (const ff of f.fieldFeatures) {
      const onIt = state.meeples.filter((m) => m.kind === 'farm' && f.lookups.fieldRegionRoot(m.x, m.y, m.idx) === ff.id);
      if (!onIt.some((m) => m.playerIdx === seat)) continue;
      const s = majorityShare(onIt.map((m) => m.playerIdx), seat);
      if (s.share === 0) { v[25]! += 1; continue; }
      let done = 0, open = 0;
      for (const cid of ff.cityIds) { const c = byId.get(cid); if (!c) continue; if (c.complete) done++; else open++; }
      v[21]! += s.share; v[22]! += done * s.share / 4; v[23]! += open * s.share / 4;
      if (s.share < 1) v[24]! += 1;
    }
  }
  return v;
}

/** Encode `state` from seat `me`'s point of view. */
export function encode(state: GameState, me: number, features = deriveFeatures(state)): Float32Array {
  const n = state.players.length;
  const tilesLeft = state.deck.length + (state.currentTile ? 1 : 0);
  const out = new Float32Array(FEATURE_DIM);
  out[0] = n / 6;
  out[1] = tilesLeft / 72;
  out[2] = Math.min(1, state.turnNumber / 150);
  out[3] = state.config.farmScoring ? 1 : 0;
  out[4] = state.config.river ? 1 : 0;
  out[5] = state.config.quickGame ? 1 : 0;
  out[6] = tilesLeft <= 10 ? 1 : 0;
  out[7] = 1; // bias-ish constant
  const mine = groupVector(state, features, me);
  const others = state.players.map((_, i) => i).filter((i) => i !== me).map((i) => groupVector(state, features, i));
  // best opponent = the one with the highest score (plus board holdings as a tiebreak)
  let best = others[0] ?? new Array<number>(GROUP_DIM()).fill(0);
  for (const o of others) if (o[0]! + o[3]! * 0.1 > best[0]! + best[3]! * 0.1) best = o;
  const avg = new Array<number>(GROUP_DIM()).fill(0);
  for (const o of others) for (let i = 0; i < avg.length; i++) avg[i]! += o[i]! / Math.max(1, others.length);
  out.set(mine, 8);
  out.set(best, 8 + GROUP_DIM());
  out.set(avg, 8 + 2 * GROUP_DIM());
  return out;
}
