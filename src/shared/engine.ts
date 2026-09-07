// Pure, deterministic Carcassonne game engine. No I/O, no Date.now(), no crypto —
// randomness is injected via an rng() callback so server, client, and NPC logic all
// stay in sync, and this module can be imported verbatim everywhere.

import { TILE_TYPES, SIDES, OPPOSITE, DIRS, NEIGHBOR_SLOT_PAIRS, buildDeck, rotateEdges, rotateSlot } from './tiles.js';
import type { EdgeType } from './types.js';
import type {
  GameConfig, GameState, Meeple, MeepleKind, MeepleOption, Placement, PlayerInfo, PlayerState, ScoreEvent,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';

const key = (x: number, y: number) => `${x},${y}`;
const parseKey = (k: string): [number, number] => {
  const [x, y] = k.split(',').map(Number) as [number, number];
  return [x, y];
};

export const PLAYER_COLORS = ['#3E6FD4', '#8452C9', '#C94590', '#D98A2E', '#8FA82E', '#3EAF6E'];
export const QUICK_GAME_TILE_COUNT = 36; // roughly half the full 72-tile deck

export function createGame(playerInfos: PlayerInfo[], rng: () => number, config: Partial<GameConfig> = {}): GameState {
  const cfg: GameConfig = { ...DEFAULT_CONFIG, ...config };
  const deck = buildDeck(rng, cfg.quickGame ? QUICK_GAME_TILE_COUNT : undefined, cfg.river);
  const players: PlayerState[] = playerInfos.map((p, i) => ({
    id: p.id,
    name: p.name,
    color: p.color || PLAYER_COLORS[i % PLAYER_COLORS.length]!,
    meeples: cfg.meeplesPerPlayer,
    score: 0,
    isNpc: p.isNpc,
    npcDifficulty: p.npcDifficulty,
  }));
  const state: GameState = {
    schemaVersion: 2,
    config: cfg,
    players,
    currentPlayer: 0,
    deck,
    currentTile: null,
    currentRot: 0,
    board: {},
    meeples: [],
    phase: 'placeTile',
    log: [],
    scoreEvents: [],
    turnNumber: 0,
    lastPlaced: null,
    winnerIds: null,
  };
  // The start tile is on the table before anyone draws — nobody places it and nobody
  // gets a meeple on it. `placedBy: -1` marks it as the table's, not a player's.
  const startTile = deck.shift()!;
  state.board[key(0, 0)] = { tileKey: startTile, rot: 0, placedBy: -1, placedTurn: -1 };
  if (cfg.river) state.riverLastTurn = 0;
  drawNextTile(state);
  return state;
}

function drawNextTile(state: GameState): void {
  // A drawn tile that has nowhere legal to go is discarded and the next is drawn,
  // per the official rules — this loop always terminates since the deck is finite.
  for (;;) {
    if (state.deck.length === 0) {
      state.currentTile = null;
      finishGame(state);
      return;
    }
    state.currentTile = state.deck.shift()!;
    state.currentRot = 0;
    state.phase = 'placeTile';
    if (getLegalPlacements(state).length > 0) return;
    state.log.unshift(`A tile had nowhere to go and was set aside.`);
  }
}

function neighborsOf(x: number, y: number) {
  return SIDES.map((s, sIdx) => {
    const d = DIRS[s];
    return { side: s, sIdx, x: x + d.dx, y: y + d.dy };
  });
}

export function getOccupied(state: GameState, x: number, y: number) {
  return state.board[key(x, y)] ?? null;
}

/** Is placing `tileKey` rotated `rot` at (x,y) legal given current board? */
export function isLegalPlacement(state: GameState, tileKey: string, rot: number, x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(rot) || rot < 0 || rot > 3) return false;
  if (!TILE_TYPES[tileKey]) return false;
  if (getOccupied(state, x, y)) return false;
  if (Object.keys(state.board).length === 0) return true; // first tile of the game
  const edges = rotateEdges(TILE_TYPES[tileKey]!.edges, rot);
  let touchesAny = false;
  for (let sIdx = 0; sIdx < 4; sIdx++) {
    const side = SIDES[sIdx]!;
    const d = DIRS[side];
    const nb = getOccupied(state, x + d.dx, y + d.dy);
    if (!nb) continue;
    touchesAny = true;
    const nbEdges = rotateEdges(TILE_TYPES[nb.tileKey]!.edges, nb.rot);
    const mine = edges[sIdx];
    const theirs = nbEdges[OPPOSITE[sIdx]!];
    if (mine !== theirs) return false;
  }
  if (!touchesAny) return false;
  if (TILE_TYPES[tileKey]!.river) return riverPlacementOk(state, edges, x, y);
  return true;
}

/** River tiles have two extra rules: each must continue the river (a water edge has to
 *  meet the river's open end), and a bend may not turn the same way as the previous
 *  bend, so the river never loops back into itself. */
function riverPlacementOk(state: GameState, edges: EdgeType[], x: number, y: number): boolean {
  const waterSides = [0, 1, 2, 3].filter((sIdx) => edges[sIdx] === 'V');
  const joined = waterSides.filter((sIdx) => {
    const d = DIRS[SIDES[sIdx]!];
    const nb = getOccupied(state, x + d.dx, y + d.dy);
    return !!nb && rotateEdges(TILE_TYPES[nb.tileKey]!.edges, nb.rot)[OPPOSITE[sIdx]!] === 'V';
  });
  if (joined.length === 0) return false;
  const turn = riverTurn(waterSides, joined[0]!);
  if ((turn === 1 || turn === 3) && state.riverLastTurn === turn) return false;
  return true;
}

/** 0 = straight or river end, 1 = turns right, 3 = turns left (entering from `inSide`). */
function riverTurn(waterSides: number[], inSide: number): number {
  const out = waterSides.find((s) => s !== inSide);
  if (out === undefined) return 0;
  const t = (out - inSide + 4) % 4;
  return t === 2 ? 0 : t;
}

/** Enumerate every legal {x,y,rot} for the current tile. Board is small; brute force is fine. */
export function getLegalPlacements(state: GameState): Placement[] {
  if (!state.currentTile) return [];
  const candidates = new Set<string>();
  for (const k of Object.keys(state.board)) {
    const [x, y] = parseKey(k);
    for (const { x: nx, y: ny } of neighborsOf(x, y)) {
      if (!getOccupied(state, nx, ny)) candidates.add(key(nx, ny));
    }
  }
  if (candidates.size === 0) candidates.add(key(0, 0)); // very first tile
  const out: Placement[] = [];
  for (const c of candidates) {
    const [x, y] = parseKey(c);
    for (let rot = 0; rot < 4; rot++) {
      if (isLegalPlacement(state, state.currentTile, rot, x, y)) out.push({ x, y, rot });
    }
  }
  return out;
}

export function placeTile(state: GameState, x: number, y: number, rot: number): Placement {
  if (state.phase !== 'placeTile') throw new Error('Not in tile-placement phase');
  if (!state.currentTile) throw new Error('No tile to place');
  if (!isLegalPlacement(state, state.currentTile, rot, x, y)) throw new Error('Illegal placement');
  state.board[key(x, y)] = { tileKey: state.currentTile, rot, placedBy: state.currentPlayer, placedTurn: state.turnNumber };
  const t = TILE_TYPES[state.currentTile]!;
  if (t.river) {
    const edges = rotateEdges(t.edges, rot);
    const waterSides = [0, 1, 2, 3].filter((sIdx) => edges[sIdx] === 'V');
    const inSide = waterSides.find((sIdx) => { const d = DIRS[SIDES[sIdx]!]; return !!getOccupied(state, x + d.dx, y + d.dy); });
    const turn = inSide === undefined ? 0 : riverTurn(waterSides, inSide);
    // Rules: "tiles showing a bend cannot be placed in the same direction as a
    // previously placed bending tile" — so straights in between don't reset it.
    if (turn === 1 || turn === 3) state.riverLastTurn = turn;
  }
  state.phase = 'placeMeeple';
  state.lastPlaced = { x, y, rot };
  // Nothing on this tile can take a meeple (every feature already claimed, or the
  // player is out of meeples) — there is no decision to make, so don't stop for one.
  if (getMeepleOptions(state).length === 0) {
    const player = state.players[state.currentPlayer]!;
    state.log.unshift(player.meeples <= 0
      ? `${player.name} has no meeples left — turn passes.`
      : `No room for a meeple on ${player.name}'s tile — turn passes.`);
    resolveCompletedFeatures(state);
    advanceTurn(state);
  }
  return { x, y, rot };
}

// ---------------------------------------------------------------------------
// Feature graph: recomputed fresh from the board every time it's needed.
// Small union-find over string node ids.
// ---------------------------------------------------------------------------
class DSU {
  private parent = new Map<string, string>();
  find(a: string): string {
    if (!this.parent.has(a)) this.parent.set(a, a);
    let r = a;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = a;
    while (this.parent.get(c) !== c) { const n = this.parent.get(c)!; this.parent.set(c, r); c = n; }
    return r;
  }
  union(a: string, b: string): void { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb); }
}

export interface CityFeature { id: string; tileCount: number; shieldCount: number; complete: boolean; tiles: string[]; /** Edges still facing an empty cell. */ openEdges: number; }
export interface RoadFeature { id: string; tileCount: number; complete: boolean; tiles: string[]; openEdges: number; }
export interface MonasteryFeature { id: string; x: number; y: number; filled: number; complete: boolean; }
export interface FieldFeature { id: string; cityIds: string[]; tiles: string[]; }
export interface Features {
  cityFeatures: CityFeature[];
  roadFeatures: RoadFeature[];
  monasteryFeatures: MonasteryFeature[];
  fieldFeatures: FieldFeature[];
  lookups: {
    cityGroupRoot(x: number, y: number, g: number): string;
    roadGroupRoot(x: number, y: number, g: number): string;
    fieldRegionRoot(x: number, y: number, r: number): string;
  };
}

/** Features depend only on the board, and boards only grow, so a state's features can
 *  be reused until another tile lands. Clones are new objects and miss the cache. */
const featureCache = new WeakMap<GameState, { tiles: number; features: Features }>();
export function deriveFeatures(state: GameState): Features {
  const hit = featureCache.get(state);
  const tiles = Object.keys(state.board).length;
  if (hit && hit.tiles === tiles) return hit.features;
  const features = deriveFeaturesUncached(state);
  featureCache.set(state, { tiles, features });
  return features;
}
function deriveFeaturesUncached(state: GameState): Features {
  const board = state.board;
  const cityDSU = new DSU();
  const roadDSU = new DSU();
  const fieldDSU = new DSU();
  const cityGroupNode = (x: number, y: number, g: number) => `${x},${y}|c${g}`;
  const roadGroupNode = (x: number, y: number, g: number) => `${x},${y}|r${g}`;
  const fieldRegionNode = (x: number, y: number, r: number) => `${x},${y}|f${r}`;

  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const { tileKey } = board[k]!;
    const t = TILE_TYPES[tileKey]!;
    t.cityGroups.forEach((_, g) => cityDSU.find(cityGroupNode(x, y, g)));
    t.roadGroups.forEach((_, g) => roadDSU.find(roadGroupNode(x, y, g)));
    t.fieldRegions.forEach((_, r) => fieldDSU.find(fieldRegionNode(x, y, r)));
  }

  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const { tileKey, rot } = board[k]!;
    const t = TILE_TYPES[tileKey]!;
    const edges = rotateEdges(t.edges, rot);
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      const side = SIDES[sIdx]!;
      const d = DIRS[side];
      const nk = key(x + d.dx, y + d.dy);
      const nb = board[nk];
      if (!nb) continue;
      const nt = TILE_TYPES[nb.tileKey]!;
      const nEdges = rotateEdges(nt.edges, nb.rot);
      if (edges[sIdx] === 'C' && nEdges[OPPOSITE[sIdx]!] === 'C') {
        const g = t.cityGroups.findIndex((grp) => grp.map((s) => (s + rot) % 4).includes(sIdx));
        const ng = nt.cityGroups.findIndex((grp) => grp.map((s) => (s + nb.rot) % 4).includes(OPPOSITE[sIdx]!));
        cityDSU.union(cityGroupNode(x, y, g), cityGroupNode(x + d.dx, y + d.dy, ng));
      }
      if (edges[sIdx] === 'R' && nEdges[OPPOSITE[sIdx]!] === 'R') {
        const g = t.roadGroups.findIndex((grp) => grp.map((s) => (s + rot) % 4).includes(sIdx));
        const ng = nt.roadGroups.findIndex((grp) => grp.map((s) => (s + nb.rot) % 4).includes(OPPOSITE[sIdx]!));
        roadDSU.union(roadGroupNode(x, y, g), roadGroupNode(x + d.dx, y + d.dy, ng));
      }
    }
    for (const side of ['N', 'E'] as const) {
      const d = DIRS[side];
      const nk = key(x + d.dx, y + d.dy);
      const nb = board[nk];
      if (!nb) continue;
      const nt = TILE_TYPES[nb.tileKey]!;
      for (const [mySlotAbs, theirSlotAbs] of NEIGHBOR_SLOT_PAIRS[side]) {
        const myCanon = rotateSlot(mySlotAbs, -rot);
        const theirCanon = rotateSlot(theirSlotAbs, -nb.rot);
        const myRegion = t.slotToRegion[myCanon]!;
        const theirRegion = nt.slotToRegion[theirCanon]!;
        if (myRegion === -1 || theirRegion === -1) continue;
        fieldDSU.union(fieldRegionNode(x, y, myRegion), fieldRegionNode(x + d.dx, y + d.dy, theirRegion));
      }
    }
  }

  const cityRoots = new Map<string, { tiles: Set<string>; shieldTiles: Set<string>; open: boolean; openEdges: number }>();
  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const { tileKey, rot } = board[k]!;
    const t = TILE_TYPES[tileKey]!;
    t.cityGroups.forEach((grp, g) => {
      const root = cityDSU.find(cityGroupNode(x, y, g));
      if (!cityRoots.has(root)) cityRoots.set(root, { tiles: new Set(), shieldTiles: new Set(), open: false, openEdges: 0 });
      const rec = cityRoots.get(root)!;
      rec.tiles.add(k);
      if (t.shield) rec.shieldTiles.add(k);
      const absSides = grp.map((s) => (s + rot) % 4);
      for (const sIdx of absSides) {
        const d = DIRS[SIDES[sIdx]!];
        if (!board[key(x + d.dx, y + d.dy)]) { rec.open = true; rec.openEdges++; }
      }
    });
  }
  const cityFeatures: CityFeature[] = [...cityRoots.entries()].map(([root, rec]) => ({
    id: root, tileCount: rec.tiles.size, shieldCount: rec.shieldTiles.size, complete: !rec.open, tiles: [...rec.tiles], openEdges: rec.openEdges,
  }));

  const roadRoots = new Map<string, { tiles: Set<string>; open: boolean; openEdges: number }>();
  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const { tileKey, rot } = board[k]!;
    const t = TILE_TYPES[tileKey]!;
    t.roadGroups.forEach((grp, g) => {
      const root = roadDSU.find(roadGroupNode(x, y, g));
      if (!roadRoots.has(root)) roadRoots.set(root, { tiles: new Set(), open: false, openEdges: 0 });
      const rec = roadRoots.get(root)!;
      rec.tiles.add(k);
      const absSides = grp.map((s) => (s + rot) % 4);
      for (const sIdx of absSides) {
        const d = DIRS[SIDES[sIdx]!];
        if (!board[key(x + d.dx, y + d.dy)]) { rec.open = true; rec.openEdges++; }
      }
    });
  }
  const roadFeatures: RoadFeature[] = [...roadRoots.entries()].map(([root, rec]) => ({
    id: root, tileCount: rec.tiles.size, complete: !rec.open, tiles: [...rec.tiles], openEdges: rec.openEdges,
  }));

  const monasteryFeatures: MonasteryFeature[] = [];
  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const t = TILE_TYPES[board[k]!.tileKey]!;
    if (!t.monastery) continue;
    let filled = 1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (board[key(x + dx, y + dy)]) filled++;
    }
    monasteryFeatures.push({ id: k, x, y, filled, complete: filled === 9 });
  }

  const fieldRoots = new Map<string, { cells: Set<string>; cityIds: Set<string> }>();
  for (const k of Object.keys(board)) {
    const [x, y] = parseKey(k);
    const { tileKey } = board[k]!;
    const t = TILE_TYPES[tileKey]!;
    t.fieldRegions.forEach((region, ri) => {
      const root = fieldDSU.find(fieldRegionNode(x, y, ri));
      if (!fieldRoots.has(root)) fieldRoots.set(root, { cells: new Set(), cityIds: new Set() });
      const rec = fieldRoots.get(root)!;
      rec.cells.add(`${k}|${ri}`);
      for (const cg of region.cityGroups) {
        const cityRoot = cityDSU.find(cityGroupNode(x, y, cg));
        rec.cityIds.add(cityRoot);
      }
    });
  }
  const fieldFeatures: FieldFeature[] = [...fieldRoots.entries()].map(([root, rec]) => ({
    id: root, cityIds: [...rec.cityIds], tiles: [...new Set([...rec.cells].map((c) => c.split('|')[0]!))],
  }));

  return {
    cityFeatures, roadFeatures, monasteryFeatures, fieldFeatures,
    lookups: {
      cityGroupRoot: (x, y, g) => cityDSU.find(cityGroupNode(x, y, g)),
      roadGroupRoot: (x, y, g) => roadDSU.find(roadGroupNode(x, y, g)),
      fieldRegionRoot: (x, y, r) => fieldDSU.find(fieldRegionNode(x, y, r)),
    },
  };
}

// ---------------------------------------------------------------------------
// Meeple placement options for the tile that was just placed.
// ---------------------------------------------------------------------------
export function getMeepleOptions(state: GameState): MeepleOption[] {
  if (state.phase !== 'placeMeeple' || !state.lastPlaced) return [];
  const { x, y } = state.lastPlaced;
  const player = state.players[state.currentPlayer]!;
  if (player.meeples <= 0) return [];
  const placed = getOccupied(state, x, y);
  if (!placed) return [];
  const t = TILE_TYPES[placed.tileKey]!;
  const features = deriveFeatures(state);
  const options: MeepleOption[] = [];
  const isClaimed = (predicate: (m: Meeple) => boolean) => state.meeples.some(predicate);

  t.cityGroups.forEach((_grp, g) => {
    const root = features.lookups.cityGroupRoot(x, y, g);
    const claimed = isClaimed((m) => m.kind === 'city' && features.lookups.cityGroupRoot(m.x, m.y, m.idx) === root);
    if (!claimed) options.push({ kind: 'city', idx: g, label: 'Knight' });
  });
  t.roadGroups.forEach((_grp, g) => {
    const root = features.lookups.roadGroupRoot(x, y, g);
    const claimed = isClaimed((m) => m.kind === 'road' && features.lookups.roadGroupRoot(m.x, m.y, m.idx) === root);
    if (!claimed) options.push({ kind: 'road', idx: g, label: 'Highwayman' });
  });
  if (t.monastery && state.config.monasteryScoring) {
    const claimed = isClaimed((m) => m.kind === 'monastery' && m.x === x && m.y === y);
    if (!claimed) options.push({ kind: 'monastery', idx: 0, label: 'Monk' });
  }
  if (state.config.farmScoring) {
    t.fieldRegions.forEach((_region, r) => {
      const root = features.lookups.fieldRegionRoot(x, y, r);
      const claimed = isClaimed((m) => m.kind === 'farm' && features.lookups.fieldRegionRoot(m.x, m.y, m.idx) === root);
      if (!claimed) options.push({ kind: 'farm', idx: r, label: 'Farmer' });
    });
  }
  return options;
}

export function placeMeeple(state: GameState, kind: MeepleKind, idx: number): void {
  if (state.phase !== 'placeMeeple' || !state.lastPlaced) throw new Error('Not expecting a meeple');
  const player = state.players[state.currentPlayer]!;
  if (player.meeples <= 0) throw new Error('No meeples left');
  const opts = getMeepleOptions(state);
  if (!opts.some((o) => o.kind === kind && o.idx === idx)) throw new Error('Illegal meeple placement');
  const { x, y } = state.lastPlaced;
  state.meeples.push({ playerIdx: state.currentPlayer, x, y, kind, idx });
  player.meeples--;
  resolveCompletedFeatures(state);
  advanceTurn(state);
}

export function skipMeeple(state: GameState): void {
  if (state.phase !== 'placeMeeple') throw new Error('Not expecting a meeple decision');
  resolveCompletedFeatures(state);
  advanceTurn(state);
}

function scoreForPlayers(
  state: GameState, playerIdxs: number[], points: number, reason: string,
  where: { kind: ScoreEvent['kind']; tiles: string[]; fedTiles?: string[]; final?: boolean },
): void {
  if (playerIdxs.length === 0) return;
  for (const pi of playerIdxs) state.players[pi]!.score += points;
  const names = playerIdxs.map((pi) => state.players[pi]!.name).join(' & ');
  (state.scoreEvents ??= []).unshift({ seq: state.log.length, players: playerIdxs, points, ...where });
  state.log.unshift(`${names} scored ${points} pt${points === 1 ? '' : 's'} — ${reason}`);
}

function monasteryTiles(state: GameState, x: number, y: number): string[] {
  const out: string[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (state.board[key(x + dx, y + dy)]) out.push(key(x + dx, y + dy));
  return out;
}

function majorityOwners(_state: GameState, meeplesOnFeature: Meeple[]): number[] {
  if (meeplesOnFeature.length === 0) return [];
  const counts = new Map<number, number>();
  for (const m of meeplesOnFeature) counts.set(m.playerIdx, (counts.get(m.playerIdx) ?? 0) + 1);
  const max = Math.max(...counts.values());
  return [...counts.entries()].filter(([, c]) => c === max).map(([pi]) => pi);
}

function resolveCompletedFeatures(state: GameState): void {
  const features = deriveFeatures(state);

  for (const cf of features.cityFeatures) {
    if (!cf.complete) continue;
    const onIt = state.meeples.filter((m) => m.kind === 'city' && features.lookups.cityGroupRoot(m.x, m.y, m.idx) === cf.id);
    if (onIt.length === 0) continue;
    const shieldPts = state.config.shieldBonus ? cf.shieldCount * 2 : 0;
    const points = cf.tileCount * 2 + shieldPts;
    scoreForPlayers(state, majorityOwners(state, onIt), points, `a city (${cf.tileCount} tiles${cf.shieldCount && state.config.shieldBonus ? `, ${cf.shieldCount} shields` : ''})`, { kind: 'city', tiles: cf.tiles });
    returnMeeples(state, onIt);
  }
  for (const rf of features.roadFeatures) {
    if (!rf.complete) continue;
    const onIt = state.meeples.filter((m) => m.kind === 'road' && features.lookups.roadGroupRoot(m.x, m.y, m.idx) === rf.id);
    if (onIt.length === 0) continue;
    scoreForPlayers(state, majorityOwners(state, onIt), rf.tileCount, `a road (${rf.tileCount} tiles)`, { kind: 'road', tiles: rf.tiles });
    returnMeeples(state, onIt);
  }
  if (state.config.monasteryScoring) {
    for (const mf of features.monasteryFeatures) {
      if (!mf.complete) continue;
      const onIt = state.meeples.filter((m) => m.kind === 'monastery' && m.x === mf.x && m.y === mf.y);
      if (onIt.length === 0) continue;
      scoreForPlayers(state, majorityOwners(state, onIt), 9, 'a completed cloister', { kind: 'monastery', tiles: monasteryTiles(state, mf.x, mf.y) });
      returnMeeples(state, onIt);
    }
  }
}

function returnMeeples(state: GameState, meeples: Meeple[]): void {
  for (const m of meeples) state.players[m.playerIdx]!.meeples++;
  state.meeples = state.meeples.filter((m) => !meeples.includes(m));
}

function advanceTurn(state: GameState): void {
  state.lastPlaced = null;
  state.turnNumber++;
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  drawNextTile(state);
}

function finishGame(state: GameState): void {
  state.phase = 'gameover';
  const features = deriveFeatures(state);
  for (const cf of features.cityFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'city' && features.lookups.cityGroupRoot(m.x, m.y, m.idx) === cf.id);
    if (onIt.length === 0) continue;
    const shields = state.config.shieldBonus ? cf.shieldCount : 0;
    const points = cf.complete ? cf.tileCount * 2 + shields * 2 : cf.tileCount + shields;
    scoreForPlayers(state, majorityOwners(state, onIt), points, `final scoring: ${cf.complete ? 'a completed' : 'an unfinished'} city`, { kind: 'city', tiles: cf.tiles , final: true });
  }
  for (const rf of features.roadFeatures) {
    const onIt = state.meeples.filter((m) => m.kind === 'road' && features.lookups.roadGroupRoot(m.x, m.y, m.idx) === rf.id);
    if (onIt.length === 0) continue;
    scoreForPlayers(state, majorityOwners(state, onIt), rf.tileCount, `final scoring: ${rf.complete ? 'a completed' : 'an unfinished'} road`, { kind: 'road', tiles: rf.tiles , final: true });
  }
  if (state.config.monasteryScoring) {
    for (const mf of features.monasteryFeatures) {
      const onIt = state.meeples.filter((m) => m.kind === 'monastery' && m.x === mf.x && m.y === mf.y);
      if (onIt.length === 0) continue;
      scoreForPlayers(state, majorityOwners(state, onIt), mf.filled, `final scoring: ${mf.complete ? 'a completed' : 'an unfinished'} cloister`, { kind: 'monastery', tiles: monasteryTiles(state, mf.x, mf.y) , final: true });
    }
  }
  if (state.config.farmScoring) {
    try {
      for (const ff of features.fieldFeatures) {
        const onIt = state.meeples.filter((m) => m.kind === 'farm' && features.lookups.fieldRegionRoot(m.x, m.y, m.idx) === ff.id);
        if (onIt.length === 0) continue;
        const fed = ff.cityIds.map((cid) => features.cityFeatures.find((c) => c.id === cid)).filter((c): c is CityFeature => !!c?.complete);
        const completeCityCount = fed.length;
        if (completeCityCount === 0) continue;
        scoreForPlayers(state, majorityOwners(state, onIt), completeCityCount * 3, `final scoring: a farm feeding ${completeCityCount} completed cit${completeCityCount === 1 ? 'y' : 'ies'}`,
          { kind: 'farm', tiles: ff.tiles, fedTiles: fed.flatMap((c) => c.tiles), final: true });
      }
    } catch {
      state.log.unshift('Farm scoring hit a snag and was skipped for safety — other scores are final.');
    }
  }
  // Meeples stay where they stand for the final tableau — the board at game end
  // should look like the table does, so everyone can see what scored what.
  const top = Math.max(...state.players.map((p) => p.score));
  state.winnerIds = state.players.filter((p) => p.score === top).map((p) => p.id);
}

/** Deep-clone the mutable parts of state cheaply for the "snapshot, try, rollback on
 *  throw" pattern the Durable Object uses so a mid-mutation exception can never leave
 *  in-memory state ahead of what was last persisted. */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}
