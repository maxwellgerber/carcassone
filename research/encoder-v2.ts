// Encoder v2 (experiment): everything v1 had, plus the geometry that the collision
// check showed was invisible — what sits around each feature's openings, whether an
// opening can actually be filled by what is left in the bag, which farm touches which
// cities, how contested each feature is, and the unclaimed features on the board
// (and whether they can merge into ours). Still a pooled vector, so it drops into the
// same MLP; the point is to give the pool something decision-relevant to sum.
//
// Copy over src/server/features.ts to run as a `--kind features` experiment.
import { deriveFeatures, isLegalPlacement, type Features } from '../shared/engine.js';
import { TILE_TYPES, DIRS, SIDES } from '../shared/tiles.js';
import type { GameState } from '../shared/types.js';

const GROUP_DIM = 26 + 16;
const GLOBAL_DIM = 8 + 8;
/** Length of the vector `encode` returns. Bump when the layout changes. */
export const FEATURE_DIM = GLOBAL_DIM + 3 * GROUP_DIM;

// ---------------------------------------------------------------------------
// Board geometry around features, computed once per state and cached.
// ---------------------------------------------------------------------------
interface Geo {
  /** feature id -> distinct empty cells adjacent to its open edges */
  cells: Map<string, Set<string>>;
  /** empty cell -> feature ids (city/road) with an open edge on it */
  cellFeatures: Map<string, Set<string>>;
  /** empty cell -> share of remaining tiles that can legally go there (any rotation) */
  fill: Map<string, number>;
  frontier: number;
  unclaimedCities: number; unclaimedCityTiles: number; unclaimedRoads: number; unclaimedRoadTiles: number;
}
// Cached per state object *and* per (tiles, meeples, bag) so a state mutated in place
// (the live room, the engine tests) never serves stale geometry.
const geoCache = new WeakMap<GameState, { key: string; geo: Geo }>();
function geometry(state: GameState, f: Features): Geo {
  const key = `${Object.keys(state.board).length},${state.meeples.length},${state.deck.length}`;
  const hit = geoCache.get(state);
  if (hit && hit.key === key) return hit.geo;
  const board = state.board;
  const cells = new Map<string, Set<string>>();
  const cellFeatures = new Map<string, Set<string>>();
  const frontier = new Set<string>();
  const add = (fid: string, cell: string) => {
    if (!cells.has(fid)) cells.set(fid, new Set());
    cells.get(fid)!.add(cell);
    if (!cellFeatures.has(cell)) cellFeatures.set(cell, new Set());
    cellFeatures.get(cell)!.add(fid);
  };
  for (const [k, t] of Object.entries(board)) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    const spec = TILE_TYPES[t.tileKey]!;
    for (let s = 0; s < 4; s++) {
      const d = DIRS[SIDES[s]!];
      const nk = `${x + d.dx},${y + d.dy}`;
      if (board[nk]) continue;
      frontier.add(nk);
    }
    spec.cityGroups.forEach((grp, g) => {
      for (const sd of grp) {
        const abs = (sd + t.rot) % 4;
        const d = DIRS[SIDES[abs]!];
        const nk = `${x + d.dx},${y + d.dy}`;
        if (!board[nk]) add(f.lookups.cityGroupRoot(x, y, g), nk);
      }
    });
    spec.roadGroups.forEach((grp, g) => {
      for (const sd of grp) {
        const abs = (sd + t.rot) % 4;
        const d = DIRS[SIDES[abs]!];
        const nk = `${x + d.dx},${y + d.dy}`;
        if (!board[nk]) add(f.lookups.roadGroupRoot(x, y, g), nk);
      }
    });
  }
  // Fillability only for cells that touch a claimed feature (cheap enough per state).
  const claimed = new Set<string>();
  for (const m of state.meeples) {
    if (m.kind === 'city') claimed.add(f.lookups.cityGroupRoot(m.x, m.y, m.idx));
    else if (m.kind === 'road') claimed.add(f.lookups.roadGroupRoot(m.x, m.y, m.idx));
  }
  const remaining = new Map<string, number>();
  for (const k of state.currentTile ? [state.currentTile, ...state.deck] : state.deck) remaining.set(k, (remaining.get(k) ?? 0) + 1);
  const total = [...remaining.values()].reduce((a, b) => a + b, 0);
  const fill = new Map<string, number>();
  for (const [cell, fids] of cellFeatures) {
    if (![...fids].some((id) => claimed.has(id))) continue;
    const [cx, cy] = cell.split(',').map(Number) as [number, number];
    let ok = 0;
    for (const [tk, n] of remaining) {
      for (let rot = 0; rot < 4; rot++) if (isLegalPlacement(state, tk, rot, cx, cy)) { ok += n; break; }
    }
    fill.set(cell, total ? ok / total : 0);
  }
  let unclaimedCities = 0, unclaimedCityTiles = 0, unclaimedRoads = 0, unclaimedRoadTiles = 0;
  for (const cf of f.cityFeatures) if (!cf.complete && !claimed.has(cf.id)) { unclaimedCities++; unclaimedCityTiles += cf.tileCount; }
  for (const rf of f.roadFeatures) if (!rf.complete && !claimed.has(rf.id)) { unclaimedRoads++; unclaimedRoadTiles += rf.tileCount; }
  const geo: Geo = { cells, cellFeatures, fill, frontier: frontier.size, unclaimedCities, unclaimedCityTiles, unclaimedRoads, unclaimedRoadTiles };
  geoCache.set(state, { key, geo });
  return geo;
}

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
function groupVector(state: GameState, f: Features, geo: Geo, seat: number, claimedBy: Map<string, Set<number>>): number[] {
  const v = new Array<number>(GROUP_DIM).fill(0);
  const p = state.players[seat]!;
  v[0] = p.score / 50;
  v[1] = p.meeples / 7;
  v[2] = p.meeples === 0 ? 1 : 0;
  // --- v1 block (indices 3..25) ---
  let bestCityFill = 0, minCityFill = 1, bestCityCells = 0, nearestCitySize = 0, nearestCityOpen = 9;
  let gapSum = 0, tieCount = 0, vulnerable = 0, mergeSame = 0, mergeOpp = 0, adjUnclaimed = 0;
  let sizeMax1 = 0, sizeMax2 = 0, shields1 = 0, cellsSum = 0;
  for (const cf of f.cityFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'city' && f.lookups.cityGroupRoot(m.x, m.y, m.idx) === cf.id);
    if (!onIt.some((m) => m.playerIdx === seat)) continue;
    const s = majorityShare(onIt.map((m) => m.playerIdx), seat);
    if (s.share === 0) { v[11]! += 1; gapSum += s.mine - s.theirs; continue; }
    v[3]! += s.share; v[4]! += cf.tileCount * s.share / 10; v[5]! += cf.shieldCount * s.share / 3; v[6]! += cf.openEdges * s.share / 6;
    const size = cf.tileCount + cf.shieldCount;
    if (cf.openEdges <= 1) { v[7]! += cf.tileCount / 10; sizeMax1 = Math.max(sizeMax1, size); shields1 += cf.shieldCount; }
    else if (cf.openEdges === 2) { v[8]! += cf.tileCount / 10; sizeMax2 = Math.max(sizeMax2, size); }
    else v[9]! += cf.tileCount / 10;
    if (s.share < 1) { v[10]! += 1; tieCount++; }
    if (s.mine - s.theirs === 1 && s.theirs > 0) vulnerable++;
    gapSum += s.mine - s.theirs;
    // geometry
    const cells = geo.cells.get(cf.id);
    if (cells && !cf.complete) {
      cellsSum += cells.size;
      let best = 0, worst = 1;
      for (const c of cells) { const fl = geo.fill.get(c) ?? 0; best = Math.max(best, fl); worst = Math.min(worst, fl); }
      bestCityFill = Math.max(bestCityFill, best); minCityFill = Math.min(minCityFill, worst);
      if (cf.openEdges < nearestCityOpen || (cf.openEdges === nearestCityOpen && size > nearestCitySize)) { nearestCityOpen = cf.openEdges; nearestCitySize = size; bestCityCells = cells.size; }
      for (const c of cells) for (const other of geo.cellFeatures.get(c) ?? []) {
        if (other === cf.id) continue;
        const owners = claimedBy.get(other);
        if (!owners) adjUnclaimed++;
        else if (owners.has(seat) && owners.size === 1) mergeSame++;
        else mergeOpp++;
      }
    }
  }
  for (const rf of f.roadFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'road' && f.lookups.roadGroupRoot(m.x, m.y, m.idx) === rf.id);
    if (!onIt.some((m) => m.playerIdx === seat)) continue;
    const s = majorityShare(onIt.map((m) => m.playerIdx), seat);
    if (s.share === 0) { v[17]! += 1; gapSum += s.mine - s.theirs; continue; }
    v[12]! += s.share; v[13]! += rf.tileCount * s.share / 8; v[14]! += rf.openEdges * s.share / 4;
    if (rf.openEdges <= 1) v[15]! += rf.tileCount / 8; else v[16]! += rf.tileCount / 8;
    if (s.share < 1) { v[17]! += 0.5; tieCount++; }
    gapSum += s.mine - s.theirs;
    const cells = geo.cells.get(rf.id);
    if (cells && !rf.complete) {
      cellsSum += cells.size;
      for (const c of cells) for (const other of geo.cellFeatures.get(c) ?? []) {
        if (other === rf.id) continue;
        const owners = claimedBy.get(other);
        if (!owners) adjUnclaimed++; else if (owners.has(seat) && owners.size === 1) mergeSame++; else mergeOpp++;
      }
    }
  }
  for (const mf of f.monasteryFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'monastery' && m.x === mf.x && m.y === mf.y && m.playerIdx === seat);
    if (!onIt.length) continue;
    v[18]! += 1; v[19]! += mf.filled / 9; if (mf.filled >= 7) v[20]! += 1;
  }
  let farmDoneMax = 0, farmOpen1 = 0, farmOpenMany = 0;
  if (state.config.farmScoring) {
    const byId = new Map(f.cityFeatures.map((c) => [c.id, c]));
    for (const ff of f.fieldFeatures) {
      const onIt = state.meeples.filter((m) => m.kind === 'farm' && f.lookups.fieldRegionRoot(m.x, m.y, m.idx) === ff.id);
      if (!onIt.some((m) => m.playerIdx === seat)) continue;
      const s = majorityShare(onIt.map((m) => m.playerIdx), seat);
      if (s.share === 0) { v[25]! += 1; continue; }
      let done = 0, open = 0;
      for (const cid of ff.cityIds) {
        const c = byId.get(cid); if (!c) continue;
        if (c.complete) done++; else { open++; if (c.openEdges <= 1) farmOpen1++; else farmOpenMany++; }
      }
      v[21]! += s.share; v[22]! += done * s.share / 4; v[23]! += open * s.share / 4;
      if (s.share < 1) v[24]! += 1;
      farmDoneMax = Math.max(farmDoneMax, done);
    }
  }
  // --- v2 block (indices 26..41) ---
  v[26] = sizeMax1 / 10;            // biggest city one edge from done
  v[27] = sizeMax2 / 10;            // biggest city two edges from done
  v[28] = shields1 / 3;             // shields in nearly-done cities
  v[29] = bestCityFill;             // best fillability among my cities' openings
  v[30] = minCityFill === 1 && bestCityFill === 0 ? 0 : minCityFill; // worst opening
  v[31] = bestCityCells / 4;        // distinct empty cells around the nearest-to-done city
  v[32] = nearestCitySize / 10;
  v[33] = nearestCityOpen === 9 ? 0 : nearestCityOpen / 4;
  v[34] = cellsSum / 10;            // distinct empty cells around all my open features
  v[35] = gapSum / 4;               // meeple majority gap summed over my features
  v[36] = tieCount / 3;
  v[37] = vulnerable / 3;           // features I lead by exactly one against someone
  v[38] = mergeSame / 4;            // my features that could merge with each other
  v[39] = mergeOpp / 4;             // my features that could merge with an opponent's
  v[40] = adjUnclaimed / 4;         // unclaimed features next to my openings (joinable)
  v[41] = farmDoneMax / 4 + farmOpen1 / 8 + farmOpenMany / 16;
  return v;
}

/** Encode `state` from seat `me`'s point of view. */
export function encode(state: GameState, me: number, features = deriveFeatures(state)): Float32Array {
  const n = state.players.length;
  const tilesLeft = state.deck.length + (state.currentTile ? 1 : 0);
  const geo = geometry(state, features);
  const claimedBy = new Map<string, Set<number>>();
  for (const m of state.meeples) {
    const id = m.kind === 'city' ? features.lookups.cityGroupRoot(m.x, m.y, m.idx) : m.kind === 'road' ? features.lookups.roadGroupRoot(m.x, m.y, m.idx) : null;
    if (!id) continue;
    if (!claimedBy.has(id)) claimedBy.set(id, new Set());
    claimedBy.get(id)!.add(m.playerIdx);
  }
  const out = new Float32Array(FEATURE_DIM);
  out[0] = n / 6;
  out[1] = tilesLeft / 72;
  out[2] = Math.min(1, state.turnNumber / 150);
  out[3] = state.config.farmScoring ? 1 : 0;
  out[4] = state.config.river ? 1 : 0;
  out[5] = state.config.quickGame ? 1 : 0;
  out[6] = tilesLeft <= 10 ? 1 : 0;
  out[7] = 1;
  // v2 globals: who moves next relative to me, frontier size, unclaimed features on the board
  out[8] = ((state.currentPlayer - me + n) % n) / n;
  out[9] = state.currentPlayer === me ? 1 : 0;
  out[10] = geo.frontier / 40;
  out[11] = geo.unclaimedCities / 6;
  out[12] = geo.unclaimedCityTiles / 12;
  out[13] = geo.unclaimedRoads / 6;
  out[14] = geo.unclaimedRoadTiles / 12;
  out[15] = Object.keys(state.board).length / 72;
  const mine = groupVector(state, features, geo, me, claimedBy);
  const others = state.players.map((_, i) => i).filter((i) => i !== me).map((i) => groupVector(state, features, geo, i, claimedBy));
  let best = others[0] ?? new Array<number>(GROUP_DIM).fill(0);
  for (const o of others) if (o[0]! + o[3]! * 0.1 > best[0]! + best[3]! * 0.1) best = o;
  const avg = new Array<number>(GROUP_DIM).fill(0);
  for (const o of others) for (let i = 0; i < avg.length; i++) avg[i]! += o[i]! / Math.max(1, others.length);
  out.set(mine, GLOBAL_DIM);
  out.set(best, GLOBAL_DIM + GROUP_DIM);
  out.set(avg, GLOBAL_DIM + 2 * GROUP_DIM);
  return out;
}
