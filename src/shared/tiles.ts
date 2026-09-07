// Pure tile data + geometry helpers. No browser or Node-specific APIs — this module
// is imported unmodified by the Worker/Durable Object, the browser client, and the
// NPC/MCP action logic. Geometry conventions here are the frozen "edge contract"
// that all tile artwork (see docs/tile-geometry-contract.md) must render against.
import type { EdgeType, FieldRegion, Side, TileType } from './types.js';

export const SIDES = ['N', 'E', 'S', 'W'] as const;
const OPPOSITE: [Side, Side, Side, Side] = [2, 3, 0, 1];

// Slot layout (8 half-edges around the tile perimeter, clockwise from NW corner):
//   0: N-west-half   1: N-east-half
//   2: E-north-half  3: E-south-half
//   4: S-east-half   5: S-west-half
//   6: W-south-half  7: W-north-half
const SLOT_SIDE: [Side, Side, Side, Side, Side, Side, Side, Side] = [0, 0, 1, 1, 2, 2, 3, 3];
const CORNER_PAIRS: [number, number][] = [[1, 2], [3, 4], [5, 6], [7, 0]];

/** How my slots pair with a neighbor's slots when the neighbor sits in direction D
 *  (my absolute slot -> neighbor's absolute slot). Pure board geometry — independent
 *  of either tile's rotation. */
export const NEIGHBOR_SLOT_PAIRS: Record<'N' | 'E' | 'S' | 'W', [number, number][]> = {
  N: [[0, 5], [1, 4]],
  E: [[2, 7], [3, 6]],
  S: [[5, 0], [4, 1]],
  W: [[7, 2], [6, 3]],
};

export const DIRS: Record<'N' | 'E' | 'S' | 'W', { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

// A road or a river running to an edge keeps that edge's two half-slots apart;
// only an open field edge joins them.
function computeFieldRegions(edges: EdgeType[], cityGroupOfSide: number[]): FieldRegion[] {
  const isCitySlot = (i: number) => edges[SLOT_SIDE[i]!] === 'C';
  const adj: Set<number>[] = Array.from({ length: 8 }, () => new Set());
  for (let side = 0; side < 4; side++) {
    if (edges[side] === 'F') {
      const a = side * 2, b = side * 2 + 1;
      adj[a]!.add(b); adj[b]!.add(a);
    }
  }
  for (const [a, b] of CORNER_PAIRS) {
    if (!isCitySlot(a) && !isCitySlot(b)) { adj[a]!.add(b); adj[b]!.add(a); }
  }
  const seen = new Array(8).fill(false);
  const regions: number[][] = [];
  for (let i = 0; i < 8; i++) {
    if (seen[i] || isCitySlot(i)) continue;
    const stack = [i]; seen[i] = true; const comp: number[] = [];
    while (stack.length) {
      const cur = stack.pop()!; comp.push(cur);
      for (const n of adj[cur]!) if (!seen[n]) { seen[n] = true; stack.push(n); }
    }
    regions.push(comp.sort((a, b) => a - b));
  }
  return regions.map((comp) => {
    const touch = new Set<number>();
    const checkNeighbor = (n: number) => { if (isCitySlot(n)) touch.add(cityGroupOfSide[SLOT_SIDE[n]!]!); };
    for (const s of comp) {
      const partner = s % 2 === 0 ? s + 1 : s - 1;
      checkNeighbor(partner);
      for (const [a, b] of CORNER_PAIRS) {
        if (a === s) checkNeighbor(b);
        if (b === s) checkNeighbor(a);
      }
    }
    return { slots: comp, cityGroups: [...touch] };
  });
}

export function rotateSlot(slot: number, rot: number): number {
  return (((slot + 2 * rot) % 8) + 8) % 8;
}

export function rotateEdges(edges: EdgeType[], rot: number): EdgeType[] {
  const r = ((rot % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => edges[(i - r + 4) % 4]!);
}

export function rotateGroupSides(sides: number[], rot: number): number[] {
  return sides.map((s) => (s + rot) % 4);
}

export function rotateFieldSlots(slots: number[], rot: number): number[] {
  return slots.map((s) => rotateSlot(s, rot));
}

interface TileSpec {
  key: string;
  label: string;
  edges: Record<'N' | 'E' | 'S' | 'W', EdgeType>;
  cityGroups?: ('N' | 'E' | 'S' | 'W')[][];
  shield?: boolean;
  monastery?: boolean;
  count: number;
  river?: boolean;
  riverRole?: 'spring' | 'lake';
}

function makeTile(spec: TileSpec): TileType {
  const edges = SIDES.map((s) => spec.edges[s]) as [EdgeType, EdgeType, EdgeType, EdgeType];
  const cityGroups = (spec.cityGroups ?? []).map((g) => g.map((s) => SIDES.indexOf(s)));
  const cityGroupOfSide = new Array(4).fill(-1);
  cityGroups.forEach((g, gi) => g.forEach((side) => { cityGroupOfSide[side] = gi; }));
  const roadSides: number[] = [];
  SIDES.forEach((s, i) => { if (edges[i] === 'R') roadSides.push(i); });
  // 2 road edges => single connected segment through the tile; 1, 3 or 4 => each is its own segment-end.
  const roadGroups = roadSides.length === 2 ? [roadSides] : roadSides.map((s) => [s]);
  const fieldRegions = computeFieldRegions(edges, cityGroupOfSide);
  const slotToRegion = new Array(8).fill(-1);
  fieldRegions.forEach((r, ri) => r.slots.forEach((s) => { slotToRegion[s] = ri; }));
  return {
    key: spec.key,
    label: spec.label,
    edges,
    cityGroups,
    roadGroups,
    fieldRegions,
    slotToRegion,
    shield: !!spec.shield,
    monastery: !!spec.monastery,
    count: spec.count,
    river: !!spec.river,
    riverRole: spec.riverRole,
  };
}

// Counts match the physical 72-tile base game (the standard A–X distribution), with
// the four start-tile copies (D) including the one pulled out first. Any change here
// must keep TOTAL_TILE_COUNT at 72 — scripts/test-engine.ts checks it.
const SPECS: TileSpec[] = [
  { key: 'monastery_plain', label: 'Cloister', edges: { N: 'F', E: 'F', S: 'F', W: 'F' }, monastery: true, count: 4 }, // B
  { key: 'monastery_road', label: 'Cloister & Road', edges: { N: 'F', E: 'F', S: 'R', W: 'F' }, monastery: true, count: 2 }, // A
  { key: 'city_cap', label: 'City Edge', edges: { N: 'C', E: 'F', S: 'F', W: 'F' }, cityGroups: [['N']], count: 5 }, // E
  { key: 'city_cap_road_straight', label: 'City & Highway', edges: { N: 'C', E: 'R', S: 'F', W: 'R' }, cityGroups: [['N']], count: 4 }, // D (incl. start tile)
  { key: 'city_cap_road_curve_a', label: 'City & Bend', edges: { N: 'C', E: 'R', S: 'R', W: 'F' }, cityGroups: [['N']], count: 3 }, // J
  { key: 'city_cap_road_curve_b', label: 'City & Bend', edges: { N: 'C', E: 'F', S: 'R', W: 'R' }, cityGroups: [['N']], count: 3 }, // K
  { key: 'city_cap_3way', label: 'City & Fork', edges: { N: 'C', E: 'R', S: 'R', W: 'R' }, cityGroups: [['N']], count: 3 }, // L
  { key: 'city_opposite_shield', label: 'Twin Cities', edges: { N: 'C', E: 'F', S: 'C', W: 'F' }, cityGroups: [['N', 'S']], shield: true, count: 2 }, // F
  { key: 'city_opposite', label: 'Twin Cities', edges: { N: 'C', E: 'F', S: 'C', W: 'F' }, cityGroups: [['N', 'S']], count: 1 }, // G
  { key: 'city_opposite_separate', label: 'Rival Cities', edges: { N: 'C', E: 'F', S: 'C', W: 'F' }, cityGroups: [['N'], ['S']], count: 3 }, // H
  { key: 'city_adjacent_separate', label: 'Rival Cities', edges: { N: 'C', E: 'C', S: 'F', W: 'F' }, cityGroups: [['N'], ['E']], count: 2 }, // I
  { key: 'city_adjacent_shield', label: 'Grand Corner', edges: { N: 'C', E: 'C', S: 'F', W: 'F' }, cityGroups: [['N', 'E']], shield: true, count: 2 }, // M
  { key: 'city_adjacent', label: 'City Corner', edges: { N: 'C', E: 'C', S: 'F', W: 'F' }, cityGroups: [['N', 'E']], count: 3 }, // N
  { key: 'city_adjacent_shield_road', label: 'Grand Walled Corner', edges: { N: 'C', E: 'C', S: 'R', W: 'R' }, cityGroups: [['N', 'E']], shield: true, count: 2 }, // O
  { key: 'city_adjacent_road', label: 'Walled Corner', edges: { N: 'C', E: 'C', S: 'R', W: 'R' }, cityGroups: [['N', 'E']], count: 3 }, // P
  { key: 'city_three_shield', label: 'Fortress', edges: { N: 'C', E: 'C', S: 'C', W: 'F' }, cityGroups: [['N', 'E', 'S']], shield: true, count: 1 }, // Q
  { key: 'city_three', label: 'Fortress', edges: { N: 'C', E: 'C', S: 'C', W: 'F' }, cityGroups: [['N', 'E', 'S']], count: 3 }, // R
  { key: 'city_three_shield_road', label: 'Fortress Gate', edges: { N: 'C', E: 'C', S: 'C', W: 'R' }, cityGroups: [['N', 'E', 'S']], shield: true, count: 2 }, // S
  { key: 'city_three_road', label: 'Fortress Gate', edges: { N: 'C', E: 'C', S: 'C', W: 'R' }, cityGroups: [['N', 'E', 'S']], count: 1 }, // T
  { key: 'city_four_shield', label: 'Capital', edges: { N: 'C', E: 'C', S: 'C', W: 'C' }, cityGroups: [['N', 'E', 'S', 'W']], shield: true, count: 1 }, // C
  { key: 'road_straight', label: 'Road', edges: { N: 'F', E: 'R', S: 'F', W: 'R' }, count: 8 }, // U
  { key: 'road_curve', label: 'Bend', edges: { N: 'F', E: 'F', S: 'R', W: 'R' }, count: 9 }, // V
  { key: 'road_fork', label: 'Fork', edges: { N: 'F', E: 'R', S: 'R', W: 'R' }, count: 4 }, // W
  { key: 'road_cross', label: 'Crossroads', edges: { N: 'R', E: 'R', S: 'R', W: 'R' }, count: 1 }, // X
];

// The River (the mini-expansion boxed with the 3.0 base game): 12 tiles laid before
// the base deck, from the spring to the lake. Water edges ('V') only ever meet water.
const RIVER_SPECS: TileSpec[] = [
  { key: 'river_spring', label: 'Spring', edges: { N: 'F', E: 'V', S: 'F', W: 'F' }, count: 1, river: true, riverRole: 'spring' },
  { key: 'river_lake', label: 'Lake', edges: { N: 'F', E: 'F', S: 'F', W: 'V' }, count: 1, river: true, riverRole: 'lake' },
  { key: 'river_straight', label: 'River', edges: { N: 'F', E: 'V', S: 'F', W: 'V' }, count: 1, river: true },
  { key: 'river_curve', label: 'River Bend', edges: { N: 'F', E: 'F', S: 'V', W: 'V' }, count: 2, river: true },
  { key: 'river_straight_road', label: 'Bridge', edges: { N: 'R', E: 'V', S: 'R', W: 'V' }, count: 1, river: true },
  { key: 'river_straight_city', label: 'Riverside City', edges: { N: 'C', E: 'V', S: 'F', W: 'V' }, cityGroups: [['N']], count: 1, river: true },
  { key: 'river_straight_two_cities', label: 'Two Banks', edges: { N: 'C', E: 'V', S: 'C', W: 'V' }, cityGroups: [['N'], ['S']], count: 1, river: true },
  { key: 'river_straight_monastery', label: 'Riverside Cloister', edges: { N: 'F', E: 'V', S: 'F', W: 'V' }, monastery: true, count: 1, river: true },
  { key: 'river_curve_city', label: 'City on the Bend', edges: { N: 'C', E: 'F', S: 'V', W: 'V' }, cityGroups: [['N']], count: 1, river: true },
  { key: 'river_curve_road', label: 'Bend & Road', edges: { N: 'R', E: 'R', S: 'V', W: 'V' }, count: 1, river: true },
  { key: 'river_curve_monastery', label: 'Cloister on the Bend', edges: { N: 'F', E: 'F', S: 'V', W: 'V' }, monastery: true, count: 1, river: true },
];

export const TILE_TYPES: Record<string, TileType> = Object.fromEntries([...SPECS, ...RIVER_SPECS].map((s) => [s.key, makeTile(s)]));
export const START_TILE_KEY = 'city_cap_road_straight';
export const TOTAL_TILE_COUNT = SPECS.reduce((a, s) => a + s.count, 0); // 72, matches the physical base game
export const RIVER_TILE_COUNT = RIVER_SPECS.reduce((a, s) => a + s.count, 0); // 12
export const RIVER_TILE_KEYS = RIVER_SPECS.map((s) => s.key);

export function rotatedEdge(tileKey: string, rot: number, side: number): EdgeType {
  const t = TILE_TYPES[tileKey]!;
  return rotateEdges(t.edges, rot)[side]!;
}

export { OPPOSITE, SLOT_SIDE, CORNER_PAIRS };

/** Deterministic shuffle using a supplied RNG function returning [0,1).
 *  The start tile is one of the `city_cap_road_straight` copies already counted in
 *  its spec (count: 3 + 1 reserved start copy = 4 total, matching the physical set) —
 *  it is pulled out of the bag and placed first, not added on top of the bag. */
/** `maxTiles` (the "quick game" mode) truncates the shuffled deck to roughly that
 *  many tiles — the start tile is always included and always first, so pass a
 *  count that includes it. Omit for the full 72-tile deck. */
/** With `river`, the spring becomes the start tile, the other river tiles follow in
 *  random order with the lake always last, and the whole base deck (start tile copy
 *  included) is shuffled in after them. `maxTiles` then limits only the base part. */
export function buildDeck(rng: () => number, maxTiles?: number, river = false): string[] {
  const shuffle = (arr: string[]) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j]!, arr[i]!]; } return arr; };
  const bag: string[] = [];
  for (const spec of SPECS) for (let i = 0; i < spec.count; i++) bag.push(spec.key);
  if (!river) {
    bag.splice(bag.indexOf(START_TILE_KEY), 1);
    shuffle(bag);
    const full = [START_TILE_KEY, ...bag];
    if (maxTiles === undefined || maxTiles >= full.length) return full;
    return full.slice(0, Math.max(1, maxTiles));
  }
  const middle: string[] = [];
  for (const spec of RIVER_SPECS) if (!spec.riverRole) for (let i = 0; i < spec.count; i++) middle.push(spec.key);
  shuffle(middle);
  shuffle(bag);
  const base = maxTiles === undefined ? bag : bag.slice(0, Math.max(1, maxTiles - 1));
  return ['river_spring', ...middle, 'river_lake', ...base];
}
