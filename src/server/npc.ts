// NPC opponent logic. Runs entirely against the same pure engine every human move
// does — an NPC "move" is indistinguishable from a real action once chosen, so it
// shares the exact same apply path (see actions.ts) as WS players and MCP agents.
//
// Three brains:
//   easy   — random placement, coin-flip meeples. A warm body.
//   normal — one-ply search over a positional evaluation that knows what a meeple
//            in reserve is worth, so it stops dumping all seven by turn ten.
//   hard   — the same evaluation, plus short Monte Carlo rollouts (random tile
//            order, quick opponents) over the best few candidates, under a time cap.
import {
  cloneState, deriveFeatures, getLegalPlacements, getMeepleOptions, isLegalPlacement,
  placeMeeple, placeTile, skipMeeple, type Features,
} from '../shared/engine.js';
import { TILE_TYPES } from '../shared/tiles.js';
import type { GameState, MeepleKind, NpcDifficulty, Placement } from '../shared/types.js';

export type NpcMove =
  | { type: 'place_tile'; x: number; y: number; rot: number }
  | { type: 'place_meeple'; kind: MeepleKind; idx: number }
  | { type: 'skip_meeple' };

/** Tunables for the hard bot's search. `thinkMs` caps wall-clock per decision so a
 *  Durable Object alarm never runs long; the tourney script raises it. */
export const NPC_SEARCH = { candidates: 5, rollouts: 8, depth: 6, thinkMs: 150, staticWeight: 0.35 };
/** Evaluation knobs, exposed so scripts/tourney.ts can sweep them. */
export const NPC_TUNING = { reserveValue: 4.5, reserveDecay: 0.6 };

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// ---------------------------------------------------------------------------
// Positional evaluation
// ---------------------------------------------------------------------------

/** How likely a feature with `openEdges` unfilled sides is to get finished before the
 *  bag runs out. Rough, but it captures the two things that matter: every extra
 *  open edge is another tile that has to arrive and fit, and late in the game
 *  nothing big is closing any more. */
function completionChance(openEdges: number, tilesLeft: number): number {
  if (openEdges <= 0) return 1;
  const shape = Math.max(0.08, 0.92 - 0.16 * (openEdges - 1));
  const time = Math.min(1, tilesLeft / (openEdges * 5));
  return shape * time;
}

/** What each seat's position is worth: banked points plus the expected value of every
 *  meeple on the board, plus the option value of meeples still in hand. */
export function evaluatePositions(state: GameState, features: Features): number[] {
  const n = state.players.length;
  const pot = state.players.map((p) => p.score);
  const tilesLeft = state.deck.length + (state.currentTile ? 1 : 0);
  const shield = state.config.shieldBonus ? 2 : 0;

  // Majority owners share the feature's value; ties split it evenly.
  const share = (owners: number[]): Map<number, number> => {
    const counts = new Map<number, number>();
    for (const o of owners) counts.set(o, (counts.get(o) ?? 0) + 1);
    const max = Math.max(...counts.values());
    const top = [...counts.entries()].filter(([, c]) => c === max).map(([p]) => p);
    return new Map(top.map((p) => [p, 1 / top.length]));
  };

  for (const cf of features.cityFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'city' && features.lookups.cityGroupRoot(m.x, m.y, m.idx) === cf.id);
    if (onIt.length === 0) continue;
    const full = (cf.tileCount + Math.min(cf.openEdges, 2) * 0.6) * 2 + cf.shieldCount * shield;
    const partial = cf.tileCount + cf.shieldCount * (shield / 2);
    const p = cf.complete ? 1 : completionChance(cf.openEdges, tilesLeft);
    const ev = cf.complete ? full : p * full + (1 - p) * partial;
    for (const [pi, w] of share(onIt.map((m) => m.playerIdx))) pot[pi]! += ev * w;
  }
  for (const rf of features.roadFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'road' && features.lookups.roadGroupRoot(m.x, m.y, m.idx) === rf.id);
    if (onIt.length === 0) continue;
    const full = rf.tileCount + Math.min(rf.openEdges, 2) * 0.5;
    const p = rf.complete ? 1 : completionChance(rf.openEdges, tilesLeft);
    const ev = p * full + (1 - p) * rf.tileCount;
    for (const [pi, w] of share(onIt.map((m) => m.playerIdx))) pot[pi]! += ev * w;
  }
  if (state.config.monasteryScoring) {
    for (const mf of features.monasteryFeatures) {
      const onIt = state.meeples.filter((m) => m.kind === 'monastery' && m.x === mf.x && m.y === mf.y);
      if (onIt.length === 0) continue;
      const missing = 9 - mf.filled;
      const p = missing === 0 ? 1 : Math.max(0.15, 1 - missing * 0.09) * Math.min(1, tilesLeft / (missing * 3));
      const ev = p * 9 + (1 - p) * mf.filled;
      for (const [pi, w] of share(onIt.map((m) => m.playerIdx))) pot[pi]! += ev * w;
    }
  }
  if (state.config.farmScoring) {
    const cityById = new Map(features.cityFeatures.map((c) => [c.id, c]));
    for (const ff of features.fieldFeatures) {
      const onIt = state.meeples.filter((m) => m.kind === 'farm' && features.lookups.fieldRegionRoot(m.x, m.y, m.idx) === ff.id);
      if (onIt.length === 0) continue;
      let ev = 0;
      for (const cid of ff.cityIds) {
        const c = cityById.get(cid); if (!c) continue;
        ev += 3 * (c.complete ? 1 : completionChance(c.openEdges, tilesLeft) * 0.8);
      }
      for (const [pi, w] of share(onIt.map((m) => m.playerIdx))) pot[pi]! += ev * w;
    }
  }
  // Meeples in hand are options on future features. The first one back in reserve
  // is worth a lot (it's the difference between playing and watching), the seventh
  // barely anything, and none of them matter once the bag is nearly empty.
  for (let pi = 0; pi < n; pi++) {
    const reserve = state.players[pi]!.meeples;
    const horizon = Math.min(1, tilesLeft / 18);
    let bonus = 0;
    for (let i = 0; i < reserve; i++) bonus += NPC_TUNING.reserveValue * Math.pow(NPC_TUNING.reserveDecay, i);
    pot[pi]! += bonus * horizon;
  }
  return pot;
}

/** One number for how good the position is for `me`: my prospects against the
 *  strongest opponent, with a nod to the field average in bigger games. */
export function evaluateFor(state: GameState, me: number, features = deriveFeatures(state)): number {
  const pot = evaluatePositions(state, features);
  const others = pot.filter((_, i) => i !== me);
  if (others.length === 0) return pot[me]!;
  const best = Math.max(...others);
  const avg = others.reduce((a, b) => a + b, 0) / others.length;
  return pot[me]! - (0.7 * best + 0.3 * avg);
}

// ---------------------------------------------------------------------------
// One-ply search (normal)
// ---------------------------------------------------------------------------

/** Best follow-up meeple decision after a placement, by static evaluation. */
function bestMeepleValue(after: GameState, me: number): { value: number; move: NpcMove } {
  if (after.phase !== 'placeMeeple') return { value: evaluateFor(after, me), move: { type: 'skip_meeple' } };
  const skipped = cloneState(after); skipMeeple(skipped);
  let best: { value: number; move: NpcMove } = { value: evaluateFor(skipped, me), move: { type: 'skip_meeple' } };
  for (const o of getMeepleOptions(after)) {
    const t = cloneState(after); placeMeeple(t, o.kind, o.idx);
    const v = evaluateFor(t, me);
    if (v > best.value) best = { value: v, move: { type: 'place_meeple', kind: o.kind, idx: o.idx } };
  }
  return best;
}

interface Candidate { p: Placement; value: number; after: GameState }

/** Every legal placement scored by the position it leaves, then the best few
 *  re-scored one ply deeper with the best meeple reply. */
function rankPlacements(state: GameState, me: number, rng: () => number, deepen = 8): Candidate[] {
  const legal = getLegalPlacements(state);
  const out: Candidate[] = [];
  for (const p of legal) {
    const after = cloneState(state);
    placeTile(after, p.x, p.y, p.rot);
    out.push({ p, value: evaluateFor(after, me) + rng() * 0.05, after });
  }
  out.sort((a, b) => b.value - a.value);
  const top = out.slice(0, deepen);
  for (const c of top) c.value = bestMeepleValue(c.after, me).value + rng() * 0.05;
  top.sort((a, b) => b.value - a.value);
  return [...top, ...out.slice(deepen)];
}

// ---------------------------------------------------------------------------
// Rollouts (hard)
// ---------------------------------------------------------------------------

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j]!, arr[i]!]; }
}

/** A quick random-but-legal placement: sample frontier cells and rotations instead of
 *  enumerating every legal move (that enumeration is most of a rollout's cost). */
function quickPlacement(state: GameState, rng: () => number): Placement | null {
  const tile = state.currentTile; if (!tile) return null;
  const frontier: [number, number][] = [];
  const seen = new Set<string>();
  for (const k of Object.keys(state.board)) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nk = `${x + dx},${y + dy}`;
      if (state.board[nk] || seen.has(nk)) continue;
      seen.add(nk); frontier.push([x + dx, y + dy]);
    }
  }
  if (frontier.length === 0) return { x: 0, y: 0, rot: 0 };
  for (let tries = 0; tries < 16; tries++) {
    const [x, y] = pick(frontier, rng);
    const rot = Math.floor(rng() * 4);
    if (isLegalPlacement(state, tile, rot, x, y)) return { x, y, rot };
  }
  const legal = getLegalPlacements(state);
  return legal.length ? pick(legal, rng) : null;
}

/** Play `depth` more tiles with cheap, plausible moves, then evaluate for `me`. The
 *  bag is reshuffled first: the remaining tiles are public, their order is not. */
function rollout(start: GameState, me: number, depth: number, rng: () => number): number {
  const st = cloneState(start);
  shuffleInPlace(st.deck, rng);
  for (let ply = 0; ply < depth && st.phase !== 'gameover'; ply++) {
    if (st.phase === 'placeTile') {
      const p = quickPlacement(st, rng);
      if (!p) break;
      placeTile(st, p.x, p.y, p.rot);
    }
    if (st.phase === 'placeMeeple') {
      const opts = getMeepleOptions(st);
      const reserve = st.players[st.currentPlayer]!.meeples;
      // Opponents in the rollout keep a couple of meeples back and otherwise grab
      // cities first — good enough to make the average outcome honest.
      if (opts.length && reserve > 2 && rng() < 0.55) {
        const city = opts.filter((o) => o.kind === 'city');
        const o = city.length && rng() < 0.7 ? pick(city, rng) : pick(opts, rng);
        placeMeeple(st, o.kind, o.idx);
      } else skipMeeple(st);
    }
  }
  return evaluateFor(st, me);
}

function searchValue(after: GameState, me: number, rng: () => number, rollouts: number, depth: number): number {
  // Commit the best static meeple reply first, then roll the dice from there.
  const reply = bestMeepleValue(after, me);
  const from = cloneState(after);
  if (from.phase === 'placeMeeple') {
    if (reply.move.type === 'place_meeple') placeMeeple(from, reply.move.kind, reply.move.idx); else skipMeeple(from);
  }
  let sum = 0;
  for (let i = 0; i < rollouts; i++) sum += rollout(from, me, depth, rng);
  return sum / rollouts;
}

// ---------------------------------------------------------------------------
// Public decisions
// ---------------------------------------------------------------------------

export function chooseNpcTilePlacement(state: GameState, difficulty: NpcDifficulty, rng: () => number): Placement {
  const legal = getLegalPlacements(state);
  if (legal.length === 0) throw new Error('no legal placements available');
  if (difficulty === 'easy') return pick(legal, rng);

  const me = state.currentPlayer;
  const ranked = rankPlacements(state, me, rng);
  if (difficulty === 'normal' || ranked.length === 1) return ranked[0]!.p;

  // hard: rollouts over the best few, blended with the static view, under a time cap.
  const started = Date.now();
  const top = ranked.slice(0, NPC_SEARCH.candidates);
  let best = top[0]!.p, bestV = -Infinity;
  const depth = Math.min(NPC_SEARCH.depth, state.deck.length + 1);
  for (const c of top) {
    const remaining = NPC_SEARCH.thinkMs - (Date.now() - started);
    if (remaining <= 0 && bestV > -Infinity) break;
    const w = NPC_SEARCH.staticWeight;
    const v = w * c.value + (1 - w) * searchValue(c.after, me, rng, NPC_SEARCH.rollouts, depth);
    if (v > bestV) { bestV = v; best = c.p; }
  }
  return best;
}

export function chooseNpcMeepleMove(state: GameState, difficulty: NpcDifficulty, rng: () => number): NpcMove {
  const options = getMeepleOptions(state);
  if (options.length === 0) return { type: 'skip_meeple' };
  if (difficulty === 'easy') {
    return rng() < 0.5 ? { type: 'skip_meeple' } : { type: 'place_meeple', ...pick(options, rng) };
  }
  const me = state.currentPlayer;
  if (difficulty === 'normal') return bestMeepleValue(state, me).move;

  // hard: rollouts for each option and for skipping.
  const started = Date.now();
  const depth = Math.min(NPC_SEARCH.depth, state.deck.length + 1);
  const moves: NpcMove[] = [{ type: 'skip_meeple' }, ...options.map((o): NpcMove => ({ type: 'place_meeple', kind: o.kind, idx: o.idx }))];
  let best = moves[0]!, bestV = -Infinity;
  for (const mv of moves) {
    const from = cloneState(state);
    if (mv.type === 'place_meeple') placeMeeple(from, mv.kind, mv.idx); else skipMeeple(from);
    const stat = evaluateFor(from, me);
    const remaining = NPC_SEARCH.thinkMs - (Date.now() - started);
    let v = stat;
    if (remaining > 0 || bestV === -Infinity) {
      let sum = 0;
      for (let i = 0; i < NPC_SEARCH.rollouts; i++) sum += rollout(from, me, depth, rng);
      const w = NPC_SEARCH.staticWeight;
      v = w * stat + (1 - w) * (sum / NPC_SEARCH.rollouts);
    }
    if (v > bestV) { bestV = v; best = mv; }
  }
  return best;
}

// Keep the tile table import live for future shape-aware heuristics (and so the
// bundle doesn't tree-shake the type map the evaluation may grow into).
void TILE_TYPES;
