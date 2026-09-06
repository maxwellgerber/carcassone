// Pure, deterministic Carcassonne game engine. No I/O, no Date.now(), no crypto —
// randomness is injected via an rng() callback so server and client stay in sync
// and this file can be imported verbatim in both places.

import { TILE_TYPES, SIDES, OPPOSITE, DIRS, NEIGHBOR_SLOT_PAIRS, SLOT_SIDE, buildDeck, rotateEdges, rotateSlot } from './tiles.js';

const key = (x, y) => `${x},${y}`;
const parseKey = (k) => k.split(',').map(Number);

export const PLAYER_COLORS = ['#c0392b', '#2456a6', '#e0a600', '#2f8f4e', '#5b3a8e', '#374151'];
export const MEEPLES_PER_PLAYER = 7;

export function createGame(playerInfos, rng) {
  const deck = buildDeck(rng);
  const players = playerInfos.map((p, i) => ({
    id: p.id,
    name: p.name,
    color: p.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
    meeples: MEEPLES_PER_PLAYER,
    score: 0,
  }));
  const state = {
    players,
    currentPlayer: 0,
    deck,
    currentTile: null,
    currentRot: 0,
    board: {}, // key -> { tileKey, rot, placedBy, placedTurn }
    meeples: [], // { playerIdx, x, y, kind, idx }
    phase: 'placeTile',
    log: [],
    turnNumber: 0,
    winnerIds: null,
  };
  drawNextTile(state);
  return state;
}

function drawNextTile(state) {
  if (state.deck.length === 0) {
    state.currentTile = null;
    finishGame(state);
    return;
  }
  state.currentTile = state.deck.shift();
  state.currentRot = 0;
  state.phase = 'placeTile';
}

function neighborsOf(x, y) {
  return SIDES.map((s) => {
    const d = DIRS[s];
    return { side: s, x: x + d.dx, y: y + d.dy };
  });
}

export function getOccupied(state, x, y) {
  return state.board[key(x, y)] || null;
}

/** Is placing `tileKey` rotated `rot` at (x,y) legal given current board? */
export function isLegalPlacement(state, tileKey, rot, x, y) {
  if (getOccupied(state, x, y)) return false;
  if (Object.keys(state.board).length === 0) return true; // first tile of the game
  const edges = rotateEdges(TILE_TYPES[tileKey].edges, rot);
  let touchesAny = false;
  for (let sIdx = 0; sIdx < 4; sIdx++) {
    const side = SIDES[sIdx];
    const d = DIRS[side];
    const nb = getOccupied(state, x + d.dx, y + d.dy);
    if (!nb) continue;
    touchesAny = true;
    const nbEdges = rotateEdges(TILE_TYPES[nb.tileKey].edges, nb.rot);
    const mine = edges[sIdx];
    const theirs = nbEdges[OPPOSITE[sIdx]];
    if (mine !== theirs) return false;
  }
  return touchesAny;
}

/** Enumerate every legal {x,y,rot} for the current tile. Board is small; brute force is fine. */
export function getLegalPlacements(state) {
  if (!state.currentTile) return [];
  const candidates = new Set();
  for (const k of Object.keys(state.board)) {
    const [x, y] = parseKey(k);
    for (const { x: nx, y: ny } of neighborsOf(x, y)) {
      if (!getOccupied(state, nx, ny)) candidates.add(key(nx, ny));
    }
  }
  if (candidates.size === 0) candidates.add(key(0, 0)); // very first tile
  const out = [];
  for (const c of candidates) {
    const [x, y] = parseKey(c);
    for (let rot = 0; rot < 4; rot++) {
      if (isLegalPlacement(state, state.currentTile, rot, x, y)) out.push({ x, y, rot });
    }
  }
  return out;
}

export function placeTile(state, x, y, rot) {
  if (state.phase !== 'placeTile') throw new Error('Not in tile-placement phase');
  if (!isLegalPlacement(state, state.currentTile, rot, x, y)) throw new Error('Illegal placement');
  state.board[key(x, y)] = { tileKey: state.currentTile, rot, placedBy: state.currentPlayer, placedTurn: state.turnNumber };
  state.phase = 'placeMeeple';
  state.lastPlaced = { x, y, rot };
  return { x, y, rot };
}

// ---------------------------------------------------------------------------
// Feature graph: recomputed fresh from the board every time it's needed.
// Small union-find over string node ids.
// ---------------------------------------------------------------------------
class DSU {
  constructor() { this.parent = new Map(); }
  find(a) {
    if (!this.parent.has(a)) this.parent.set(a, a);
    let r = a;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    let c = a;
    while (this.parent.get(c) !== c) { const n = this.parent.get(c); this.parent.set(c, r); c = n; }
    return r;
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb); }
}

export function deriveFeatures(state) {
  const board = state.board;
  const cityDSU = new DSU();
  const roadDSU = new DSU();
  const fieldDSU = new DSU();
  const cityMembers = new Map(); // root -> Set of "x,y" tile coords contributing
  const cityGroupNode = (x, y, g) => `${x},${y}|c${g}`;
  const roadGroupNode = (x, y, g) => `${x},${y}|r${g}`;
  const fieldRegionNode = (x, y, r) => `${x},${y}|f${r}`;

  // Ensure every group/region has a DSU node even if isolated (no matching neighbor yet).
  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const { tileKey } = board[k];
    const t = TILE_TYPES[tileKey];
    t.cityGroups.forEach((_, g) => cityDSU.find(cityGroupNode(x, y, g)));
    t.roadGroups.forEach((_, g) => roadDSU.find(roadGroupNode(x, y, g)));
    t.fieldRegions.forEach((_, r) => fieldDSU.find(fieldRegionNode(x, y, r)));
  }

  // Union across shared borders.
  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const { tileKey, rot } = board[k];
    const t = TILE_TYPES[tileKey];
    const edges = rotateEdges(t.edges, rot);
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      const side = SIDES[sIdx];
      const d = DIRS[side];
      const nk = key(x + d.dx, y + d.dy);
      const nb = board[nk];
      if (!nb) continue;
      const nt = TILE_TYPES[nb.tileKey];
      const nEdges = rotateEdges(nt.edges, nb.rot);
      if (edges[sIdx] === 'C' && nEdges[OPPOSITE[sIdx]] === 'C') {
        const g = t.cityGroups.findIndex((grp) => grp.map((s) => (s + rot) % 4).includes(sIdx));
        const ng = nt.cityGroups.findIndex((grp) => grp.map((s) => (s + nb.rot) % 4).includes(OPPOSITE[sIdx]));
        cityDSU.union(cityGroupNode(x, y, g), cityGroupNode(x + d.dx, y + d.dy, ng));
      }
      if (edges[sIdx] === 'R' && nEdges[OPPOSITE[sIdx]] === 'R') {
        const g = t.roadGroups.findIndex((grp) => grp.map((s) => (s + rot) % 4).includes(sIdx));
        const ng = nt.roadGroups.findIndex((grp) => grp.map((s) => (s + nb.rot) % 4).includes(OPPOSITE[sIdx]));
        roadDSU.union(roadGroupNode(x, y, g), roadGroupNode(x + d.dx, y + d.dy, ng));
      }
    }
    // Field slot unions via the two neighbor-specific directions (N & E only, to visit each border once).
    for (const side of ['N', 'E']) {
      const d = DIRS[side];
      const nk = key(x + d.dx, y + d.dy);
      const nb = board[nk];
      if (!nb) continue;
      const nt = TILE_TYPES[nb.tileKey];
      for (const [mySlotAbs, theirSlotAbs] of NEIGHBOR_SLOT_PAIRS[side]) {
        const myCanon = rotateSlot(mySlotAbs, -rot);
        const theirCanon = rotateSlot(theirSlotAbs, -nb.rot);
        const myRegion = t.slotToRegion[myCanon];
        const theirRegion = nt.slotToRegion[theirCanon];
        if (myRegion === -1 || theirRegion === -1) continue;
        fieldDSU.union(fieldRegionNode(x, y, myRegion), fieldRegionNode(x + d.dx, y + d.dy, theirRegion));
      }
    }
  }

  // --- Cities: completeness + tile/shield counts -----------------------------------------
  const cityRoots = new Map(); // root -> { tiles:Set, shieldTiles:Set, open:boolean }
  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const { tileKey, rot } = board[k];
    const t = TILE_TYPES[tileKey];
    t.cityGroups.forEach((grp, g) => {
      const root = cityDSU.find(cityGroupNode(x, y, g));
      if (!cityRoots.has(root)) cityRoots.set(root, { tiles: new Set(), shieldTiles: new Set(), open: false });
      const rec = cityRoots.get(root);
      rec.tiles.add(k);
      if (t.shield) rec.shieldTiles.add(k);
      const absSides = grp.map((s) => (s + rot) % 4);
      for (const sIdx of absSides) {
        const d = DIRS[SIDES[sIdx]];
        if (!board[key(x + d.dx, y + d.dy)]) rec.open = true;
      }
    });
  }
  const cityFeatures = [...cityRoots.entries()].map(([root, rec]) => ({
    id: root,
    tileCount: rec.tiles.size,
    shieldCount: rec.shieldTiles.size,
    complete: !rec.open,
    tiles: [...rec.tiles],
  }));

  // --- Roads -------------------------------------------------------------------------------
  const roadRoots = new Map();
  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const { tileKey, rot } = board[k];
    const t = TILE_TYPES[tileKey];
    t.roadGroups.forEach((grp, g) => {
      const root = roadDSU.find(roadGroupNode(x, y, g));
      if (!roadRoots.has(root)) roadRoots.set(root, { tiles: new Set(), open: false });
      const rec = roadRoots.get(root);
      rec.tiles.add(k);
      const absSides = grp.map((s) => (s + rot) % 4);
      for (const sIdx of absSides) {
        const d = DIRS[SIDES[sIdx]];
        if (!board[key(x + d.dx, y + d.dy)]) rec.open = true;
      }
    });
  }
  const roadFeatures = [...roadRoots.entries()].map(([root, rec]) => ({
    id: root,
    tileCount: rec.tiles.size,
    complete: !rec.open,
    tiles: [...rec.tiles],
  }));

  // --- Monasteries -------------------------------------------------------------------------
  const monasteryFeatures = [];
  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const t = TILE_TYPES[board[k].tileKey];
    if (!t.monastery) continue;
    let filled = 1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (board[key(x + dx, y + dy)]) filled++;
    }
    monasteryFeatures.push({ id: k, x, y, filled, complete: filled === 9 });
  }

  // --- Fields: touching city feature ids -----------------------------------------------------
  const fieldRoots = new Map();
  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const { tileKey, rot } = board[k];
    const t = TILE_TYPES[tileKey];
    t.fieldRegions.forEach((region, ri) => {
      const root = fieldDSU.find(fieldRegionNode(x, y, ri));
      if (!fieldRoots.has(root)) fieldRoots.set(root, { cells: new Set(), cityIds: new Set() });
      const rec = fieldRoots.get(root);
      rec.cells.add(`${k}|${ri}`);
      for (const cg of region.cityGroups) {
        const cityRoot = cityDSU.find(cityGroupNode(x, y, cg));
        rec.cityIds.add(cityRoot);
      }
    });
  }
  const fieldFeatures = [...fieldRoots.entries()].map(([root, rec]) => ({
    id: root,
    cityIds: [...rec.cityIds],
  }));

  const lookups = {
    cityGroupRoot: (x, y, g) => cityDSU.find(cityGroupNode(x, y, g)),
    roadGroupRoot: (x, y, g) => roadDSU.find(roadGroupNode(x, y, g)),
    fieldRegionRoot: (x, y, r) => fieldDSU.find(fieldRegionNode(x, y, r)),
  };

  return { cityFeatures, roadFeatures, monasteryFeatures, fieldFeatures, lookups };
}

// ---------------------------------------------------------------------------
// Meeple placement options for the tile that was just placed.
// ---------------------------------------------------------------------------
export function getMeepleOptions(state) {
  if (state.phase !== 'placeMeeple' || !state.lastPlaced) return [];
  const { x, y, rot } = state.lastPlaced;
  const player = state.players[state.currentPlayer];
  if (player.meeples <= 0) return [];
  const { tileKey } = getOccupied(state, x, y);
  const t = TILE_TYPES[tileKey];
  const features = deriveFeatures(state);
  const options = [];

  const isClaimed = (predicate) => state.meeples.some(predicate);

  t.cityGroups.forEach((grp, g) => {
    const root = features.lookups.cityGroupRoot(x, y, g);
    const claimed = isClaimed((m) => m.kind === 'city' && features.lookups.cityGroupRoot(m.x, m.y, m.idx) === root);
    if (!claimed) options.push({ kind: 'city', idx: g, label: 'Knight' });
  });
  t.roadGroups.forEach((grp, g) => {
    const root = features.lookups.roadGroupRoot(x, y, g);
    const claimed = isClaimed((m) => m.kind === 'road' && features.lookups.roadGroupRoot(m.x, m.y, m.idx) === root);
    if (!claimed) options.push({ kind: 'road', idx: g, label: 'Highwayman' });
  });
  if (t.monastery) {
    const claimed = isClaimed((m) => m.kind === 'monastery' && m.x === x && m.y === y);
    if (!claimed) options.push({ kind: 'monastery', idx: 0, label: 'Monk' });
  }
  t.fieldRegions.forEach((region, r) => {
    const root = features.lookups.fieldRegionRoot(x, y, r);
    const claimed = isClaimed((m) => m.kind === 'farm' && features.lookups.fieldRegionRoot(m.x, m.y, m.idx) === root);
    if (!claimed) options.push({ kind: 'farm', idx: r, label: 'Farmer' });
  });
  return options;
}

export function placeMeeple(state, kind, idx) {
  if (state.phase !== 'placeMeeple' || !state.lastPlaced) throw new Error('Not expecting a meeple');
  const player = state.players[state.currentPlayer];
  if (player.meeples <= 0) throw new Error('No meeples left');
  const opts = getMeepleOptions(state);
  if (!opts.some((o) => o.kind === kind && o.idx === idx)) throw new Error('Illegal meeple placement');
  const { x, y } = state.lastPlaced;
  state.meeples.push({ playerIdx: state.currentPlayer, x, y, kind, idx });
  player.meeples--;
  resolveCompletedFeatures(state);
  advanceTurn(state);
}

export function skipMeeple(state) {
  if (state.phase !== 'placeMeeple') throw new Error('Not expecting a meeple decision');
  resolveCompletedFeatures(state);
  advanceTurn(state);
}

function scoreForPlayers(state, playerIdxs, points, reason) {
  if (playerIdxs.length === 0) return;
  for (const pi of playerIdxs) state.players[pi].score += points;
  const names = playerIdxs.map((pi) => state.players[pi].name).join(' & ');
  state.log.unshift(`${names} scored ${points} pt${points === 1 ? '' : 's'} — ${reason}`);
}

function majorityOwners(state, meeplesOnFeature) {
  if (meeplesOnFeature.length === 0) return [];
  const counts = new Map();
  for (const m of meeplesOnFeature) counts.set(m.playerIdx, (counts.get(m.playerIdx) || 0) + 1);
  const max = Math.max(...counts.values());
  return [...counts.entries()].filter(([, c]) => c === max).map(([pi]) => pi);
}

function resolveCompletedFeatures(state) {
  const features = deriveFeatures(state);

  for (const cf of features.cityFeatures) {
    if (!cf.complete) continue;
    const onIt = state.meeples.filter((m) => m.kind === 'city' && features.lookups.cityGroupRoot(m.x, m.y, m.idx) === cf.id);
    if (onIt.length === 0) continue;
    const points = cf.tileCount * 2 + cf.shieldCount * 2;
    scoreForPlayers(state, majorityOwners(state, onIt), points, `a city (${cf.tileCount} tiles${cf.shieldCount ? `, ${cf.shieldCount} shields` : ''})`);
    returnMeeples(state, onIt);
  }
  for (const rf of features.roadFeatures) {
    if (!rf.complete) continue;
    const onIt = state.meeples.filter((m) => m.kind === 'road' && features.lookups.roadGroupRoot(m.x, m.y, m.idx) === rf.id);
    if (onIt.length === 0) continue;
    const points = rf.tileCount;
    scoreForPlayers(state, majorityOwners(state, onIt), points, `a road (${rf.tileCount} tiles)`);
    returnMeeples(state, onIt);
  }
  for (const mf of features.monasteryFeatures) {
    if (!mf.complete) continue;
    const onIt = state.meeples.filter((m) => m.kind === 'monastery' && m.x === mf.x && m.y === mf.y);
    if (onIt.length === 0) continue;
    scoreForPlayers(state, majorityOwners(state, onIt), 9, 'a completed cloister');
    returnMeeples(state, onIt);
  }
}

function returnMeeples(state, meeples) {
  for (const m of meeples) {
    state.players[m.playerIdx].meeples++;
  }
  state.meeples = state.meeples.filter((m) => !meeples.includes(m));
}

function advanceTurn(state) {
  state.lastPlaced = null;
  state.turnNumber++;
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  drawNextTile(state);
}

function finishGame(state) {
  state.phase = 'gameover';
  const features = deriveFeatures(state);
  // Score whatever's left, at reduced (incomplete) rates.
  for (const cf of features.cityFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'city' && features.lookups.cityGroupRoot(m.x, m.y, m.idx) === cf.id);
    if (onIt.length === 0) continue;
    const points = cf.complete ? cf.tileCount * 2 + cf.shieldCount * 2 : cf.tileCount + cf.shieldCount;
    scoreForPlayers(state, majorityOwners(state, onIt), points, `final scoring: a ${cf.complete ? 'completed' : 'unfinished'} city`);
  }
  for (const rf of features.roadFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'road' && features.lookups.roadGroupRoot(m.x, m.y, m.idx) === rf.id);
    if (onIt.length === 0) continue;
    scoreForPlayers(state, majorityOwners(state, onIt), rf.tileCount, `final scoring: a ${rf.complete ? 'completed' : 'unfinished'} road`);
  }
  for (const mf of features.monasteryFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'monastery' && m.x === mf.x && m.y === mf.y);
    if (onIt.length === 0) continue;
    scoreForPlayers(state, majorityOwners(state, onIt), mf.filled, `final scoring: a ${mf.complete ? 'completed' : 'unfinished'} cloister`);
  }
  // Farms: 3 points per bordering COMPLETE city, for whichever player(s) hold majority farmers there.
  try {
    for (const ff of features.fieldFeatures) {
      const onIt = state.meeples.filter((m) => m.kind === 'farm' && features.lookups.fieldRegionRoot(m.x, m.y, m.idx) === ff.id);
      if (onIt.length === 0) continue;
      const completeCityCount = ff.cityIds.filter((cid) => features.cityFeatures.find((c) => c.id === cid)?.complete).length;
      if (completeCityCount === 0) continue;
      scoreForPlayers(state, majorityOwners(state, onIt), completeCityCount * 3, `final scoring: a farm feeding ${completeCityCount} completed cit${completeCityCount === 1 ? 'y' : 'ies'}`);
    }
  } catch (e) {
    state.log.unshift('Farm scoring hit a snag and was skipped for safety — other scores are final.');
  }
  state.meeples = [];
  const top = Math.max(...state.players.map((p) => p.score));
  state.winnerIds = state.players.filter((p) => p.score === top).map((p) => p.id);
}

export function serializeForClient(state) {
  return state; // plain-data object throughout; safe to send as-is over JSON.
}
