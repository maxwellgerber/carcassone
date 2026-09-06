import * as E from '../src/shared/engine.js';
import { TILE_TYPES, TOTAL_TILE_COUNT, buildDeck } from '../src/shared/tiles.js';

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) pass++;
  else { fail++; console.error('FAIL:', msg); }
}

function mkRng(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// --- Test 1: city_cap at (0,0) rot=0 (city faces N), then city_cap at (0,-1) rot=2 (city faces S) closes a city ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(2));
  g.currentTile = 'city_cap';
  E.placeTile(g, 0, 0, 0);
  E.skipMeeple(g);
  g.currentTile = 'city_cap';
  const legal = E.getLegalPlacements(g);
  const spot = legal.find((p) => p.x === 0 && p.y === -1 && p.rot === 2);
  assert(!!spot, 'city_cap rot2 at (0,-1) should be legal (city faces S, matches neighbor city facing N)');
  E.placeTile(g, 0, -1, 2);
  const opts = E.getMeepleOptions(g);
  assert(opts.some((o) => o.kind === 'city'), 'city meeple option available on newly placed tile');
  E.placeMeeple(g, 'city', opts.find((o) => o.kind === 'city')!.idx);
  assert(g.players[1]!.score === 4, `player B should score 4 for closed 2-tile city, got ${g.players[1]!.score}`);
  assert(g.players[1]!.meeples === 7, 'meeple returned after scoring');
}

// --- Test 2: field region count on an isolated monastery+1-road tile should be 1 ---
{
  const regions = TILE_TYPES.monastery_road!.fieldRegions;
  assert(regions.length === 1 && regions[0]!.slots.length === 8, `monastery_road isolated should have 1 field region of 8 slots, got ${regions.length}`);
}

// --- Test 3: a straight road tile has 2 separate field regions ---
{
  const regions = TILE_TYPES.road_straight!.fieldRegions;
  assert(regions.length === 2, `road_straight should split field into 2 regions, got ${regions.length}`);
}

// --- Test 4: closing a 3-tile road between two monastery+road caps ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(3));
  g.currentTile = 'monastery_road';
  E.placeTile(g, 0, 0, 0);
  const roadOpt = E.getMeepleOptions(g).find((o) => o.kind === 'road')!;
  E.placeMeeple(g, 'road', roadOpt.idx);
  g.currentTile = 'road_straight';
  const legal1 = E.getLegalPlacements(g);
  assert(legal1.some((p) => p.x === 0 && p.y === 1 && p.rot === 1), 'straight road rotated to N-S should fit south of monastery tile');
  E.placeTile(g, 0, 1, 1);
  E.skipMeeple(g);
  g.currentTile = 'monastery_road';
  const legal2 = E.getLegalPlacements(g);
  assert(legal2.some((p) => p.x === 0 && p.y === 2 && p.rot === 2), 'capping monastery tile should fit south of the road, rot2');
  E.placeTile(g, 0, 2, 2);
  const opts2 = E.getMeepleOptions(g);
  assert(!opts2.some((o) => o.kind === 'road'), 'road already claimed by player A, should not be offerable again');
  E.skipMeeple(g);
  assert(g.players[0]!.score === 3, `player A should have scored 3 for the completed 3-tile road, got ${g.players[0]!.score}`);
}

// --- Test 5: monastery completion (surrounded by 8 tiles) ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }], mkRng(4));
  g.currentTile = 'monastery_plain';
  E.placeTile(g, 0, 0, 0);
  E.placeMeeple(g, 'monastery', 0);
  const coords: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  for (const [dx, dy] of coords) {
    g.currentTile = 'city_cap';
    const legal = E.getLegalPlacements(g).find((p) => p.x === dx && p.y === dy);
    if (!legal) { console.error('no legal placement at', dx, dy); continue; }
    E.placeTile(g, dx, dy, legal.rot);
    E.skipMeeple(g);
  }
  assert(g.players[0]!.score === 9, `monastery should score 9 once surrounded, got ${g.players[0]!.score}`);
}

// --- Test 6: a farmer touching a completed city scores 3 at final scoring ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(5));
  g.currentTile = 'city_cap';
  E.placeTile(g, 0, 0, 0);
  const farmOpt = E.getMeepleOptions(g).find((o) => o.kind === 'farm')!;
  assert(!!farmOpt, 'city_cap should offer a farm meeple option');
  E.placeMeeple(g, 'farm', farmOpt.idx);
  g.currentTile = 'city_cap';
  E.placeTile(g, 0, -1, 2);
  assert(g.phase === 'placeMeeple', 'awaiting meeple decision on second tile');
  g.deck = [];
  E.skipMeeple(g);
  assert(g.phase === 'gameover', 'game should be over once deck is empty');
  assert(g.players[0]!.score === 3, `Alice's farm should score 3 (1 completed city x 3), got ${g.players[0]!.score}`);
}

// --- Test 7: deck totals exactly 72 tiles, start tile not double-counted ---
{
  const deck = buildDeck(mkRng(6));
  assert(deck.length === TOTAL_TILE_COUNT, `deck should have ${TOTAL_TILE_COUNT} tiles, got ${deck.length}`);
  assert(deck.length === 72, `deck should have exactly 72 tiles (physical base game), got ${deck.length}`);
  assert(deck[0] === 'city_cap_road_straight', 'first tile of the deck should be the guaranteed start tile');
}

// --- Test 8: input validation rejects malformed placements (the critical QA finding) ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(7));
  assert(!E.isLegalPlacement(g, g.currentTile!, NaN, 0, 0), 'NaN rotation must be rejected');
  assert(!E.isLegalPlacement(g, g.currentTile!, 0.5, 0, 0), 'non-integer rotation must be rejected');
  assert(!E.isLegalPlacement(g, g.currentTile!, 4, 0, 0), 'out-of-range rotation must be rejected');
  assert(!E.isLegalPlacement(g, g.currentTile!, 0, 1.5, 0), 'non-integer x must be rejected');
  let threw = false;
  try { E.placeTile(g, 0, 0, NaN); } catch { threw = true; }
  assert(threw, 'placeTile with NaN rot must throw, not corrupt the board');
}

// --- Test 9: game-mode config — disabling farm scoring removes farmer options and final points ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(8), { farmScoring: false });
  g.currentTile = 'city_cap';
  E.placeTile(g, 0, 0, 0);
  const opts = E.getMeepleOptions(g);
  assert(!opts.some((o) => o.kind === 'farm'), 'farm meeple option should not be offered when farmScoring is disabled');
}

// --- Test 10: an unplaceable tile is auto-discarded rather than soft-locking the game ---
{
  // A hand-built near-full 3x1 strip where the next deck tile (city_four_shield, all
  // city edges) cannot legally attach anywhere among the current frontier's field/road
  // edges — regression test for the "discard and draw again" rule.
  const g = E.createGame([{ id: 'a', name: 'Alice' }], mkRng(9));
  g.currentTile = 'road_straight';
  E.placeTile(g, 0, 0, 0); // field N/S, road E/W
  E.skipMeeple(g);
  g.deck = ['city_four_shield', 'road_straight'];
  g.currentTile = null;
  // Force a fresh draw via skip on a synthetic placeMeeple-phase state is awkward;
  // instead directly exercise the discard loop by re-triggering draw through a no-op turn.
  (g as unknown as { phase: string }).phase = 'placeMeeple';
  g.lastPlaced = { x: 0, y: 0, rot: 0 };
  E.skipMeeple(g);
  assert(g.currentTile === 'road_straight', `city_four_shield had nowhere legal to go and should have been discarded, got currentTile=${g.currentTile}`);
  assert(g.log.some((l) => l.includes('set aside')), 'a log entry should record the discarded tile');
}

// --- Test 11: quickGame uses a shorter deck, start tile still guaranteed first ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(10), { quickGame: true });
  const totalTiles = g.deck.length + 1; // +1 for the already-drawn currentTile
  assert(totalTiles === E.QUICK_GAME_TILE_COUNT, `quickGame should use a ${E.QUICK_GAME_TILE_COUNT}-tile deck, got ${totalTiles}`);
  assert(g.currentTile === 'city_cap_road_straight', 'the guaranteed start tile should still be drawn first in quick games');
}

// --- Test 12: shieldBonus disabled removes the +2/shield bonus, both mid-game and at final scoring ---
{
  const withBonus = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(11), { shieldBonus: true });
  withBonus.currentTile = 'city_opposite_shield'; // one shielded, self-contained 2-tile-worth city (opposite, connected)
  E.placeTile(withBonus, 0, 0, 0);
  const knightOpt = E.getMeepleOptions(withBonus).find((o) => o.kind === 'city')!;
  withBonus.deck = []; // so placeMeeple's internal turn-advance triggers gameover immediately
  E.placeMeeple(withBonus, 'city', knightOpt.idx); // -> resolves (incomplete, no score yet), advances, deck empty -> finishGame
  assert(withBonus.phase === 'gameover', 'game should end once the deck empties after the meeple decision');
  assert(withBonus.players[0]!.score === 2, `shielded 1-tile city with bonus on should score 2 (1 tile + 1 shield, unfinished), got ${withBonus.players[0]!.score}`);

  const noBonus = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(11), { shieldBonus: false });
  noBonus.currentTile = 'city_opposite_shield';
  E.placeTile(noBonus, 0, 0, 0);
  const knightOpt2 = E.getMeepleOptions(noBonus).find((o) => o.kind === 'city')!;
  noBonus.deck = [];
  E.placeMeeple(noBonus, 'city', knightOpt2.idx);
  assert(noBonus.players[0]!.score === 1, `shielded 1-tile city with bonus off should score 1 (tile only, unfinished), got ${noBonus.players[0]!.score}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
