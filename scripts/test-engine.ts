import * as E from '../src/shared/engine.js';
import type { GameConfig, GameState } from '../src/shared/types.js';
import { TILE_TYPES, TOTAL_TILE_COUNT, RIVER_TILE_COUNT, buildDeck } from '../src/shared/tiles.js';

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) pass++;
  else { fail++; console.error('FAIL:', msg); }
}

function mkRng(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/** A game whose board is empty, for tests that lay tiles out by hand. (A real game
 *  starts with the start tile already at (0,0) — see Test 15.) */
function blankGame(players: { id: string; name: string }[], seed: number, config: Partial<GameConfig> = {}): GameState {
  const g = E.createGame(players, mkRng(seed), config);
  g.board = {};
  return g;
}

// --- Test 1: city_cap at (0,0) rot=0 (city faces N), then city_cap at (0,-1) rot=2 (city faces S) closes a city ---
{
  const g = blankGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], 2);
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
  const ev = g.scoreEvents?.[0];
  assert(!!ev && ev.kind === 'city' && ev.points === 4 && ev.tiles.length === 2, `score event should record the 2 city tiles, got ${JSON.stringify(ev)}`);
  assert(!!ev && g.log[g.log.length - 1 - ev.seq]!.includes('scored 4 pts'), 'score event seq should map back to its chronicle line');
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
  const g = blankGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], 3);
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
  const g = blankGame([{ id: 'a', name: 'Alice' }], 4);
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
  const g = blankGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], 5);
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
  const farmEv = g.scoreEvents?.find((e) => e.kind === 'farm');
  assert(!!farmEv && farmEv.tiles.length >= 1 && (farmEv.fedTiles?.length ?? 0) === 2, `farm score event should list field tiles and the 2 tiles of the fed city, got ${JSON.stringify(farmEv)}`);
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
  const g = blankGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], 7);
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
  const g = blankGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], 8, { farmScoring: false });
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
  const g = blankGame([{ id: 'a', name: 'Alice' }], 9);
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
  const totalTiles = g.deck.length + 2; // +1 for the already-drawn currentTile, +1 for the start tile on the table
  assert(totalTiles === E.QUICK_GAME_TILE_COUNT, `quickGame should use a ${E.QUICK_GAME_TILE_COUNT}-tile deck, got ${totalTiles}`);
  assert(g.board['0,0']?.tileKey === 'city_cap_road_straight', 'the start tile is on the table in quick games too');
}

// --- Test 12: shieldBonus disabled removes the +2/shield bonus, both mid-game and at final scoring ---
{
  const withBonus = blankGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], 11, { shieldBonus: true });
  withBonus.currentTile = 'city_opposite_shield'; // one shielded, self-contained 2-tile-worth city (opposite, connected)
  E.placeTile(withBonus, 0, 0, 0);
  const knightOpt = E.getMeepleOptions(withBonus).find((o) => o.kind === 'city')!;
  withBonus.deck = []; // so placeMeeple's internal turn-advance triggers gameover immediately
  E.placeMeeple(withBonus, 'city', knightOpt.idx); // -> resolves (incomplete, no score yet), advances, deck empty -> finishGame
  assert(withBonus.phase === 'gameover', 'game should end once the deck empties after the meeple decision');
  assert(withBonus.players[0]!.score === 2, `shielded 1-tile city with bonus on should score 2 (1 tile + 1 shield, unfinished), got ${withBonus.players[0]!.score}`);

  const noBonus = blankGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], 11, { shieldBonus: false });
  noBonus.currentTile = 'city_opposite_shield';
  E.placeTile(noBonus, 0, 0, 0);
  const knightOpt2 = E.getMeepleOptions(noBonus).find((o) => o.kind === 'city')!;
  noBonus.deck = [];
  E.placeMeeple(noBonus, 'city', knightOpt2.idx);
  assert(noBonus.players[0]!.score === 1, `shielded 1-tile city with bonus off should score 1 (tile only, unfinished), got ${noBonus.players[0]!.score}`);
}

// --- Test 13: tile distribution matches the physical base game exactly ---
{
  const expected: Record<string, number> = {
    monastery_plain: 4, monastery_road: 2, city_cap: 5, city_cap_road_straight: 4,
    city_cap_road_curve_a: 3, city_cap_road_curve_b: 3, city_cap_3way: 3,
    city_opposite_shield: 2, city_opposite: 1, city_opposite_separate: 3,
    city_adjacent_separate: 2, city_adjacent_shield: 2, city_adjacent: 3,
    city_adjacent_shield_road: 2, city_adjacent_road: 3,
    city_three_shield: 1, city_three: 3, city_three_shield_road: 2, city_three_road: 1,
    city_four_shield: 1, road_straight: 8, road_curve: 9, road_fork: 4, road_cross: 1,
  };
  const deck = buildDeck(mkRng(13));
  const counts: Record<string, number> = {};
  for (const k of deck) counts[k] = (counts[k] ?? 0) + 1;
  for (const [k, n] of Object.entries(expected)) assert(counts[k] === n, `expected ${n} × ${k} in the deck, got ${counts[k] ?? 0}`);
  assert(Object.keys(counts).length === Object.keys(expected).length, 'deck contains no unexpected tile types');
  const cloisters = deck.filter((k) => TILE_TYPES[k]!.monastery).length;
  assert(cloisters === 6, `base game has exactly 6 cloister tiles, got ${cloisters}`);
  assert(TILE_TYPES.city_adjacent_shield_road!.shield && TILE_TYPES.city_three_shield_road!.shield, 'the two shield+road variants carry a shield');
}

// --- Test 14: the meeple step is skipped automatically when there is nothing to decide ---
{
  // (a) player is out of meeples
  const g = blankGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], 14, { meeplesPerPlayer: 1 });
  g.currentTile = 'city_cap';
  E.placeTile(g, 0, 0, 0);
  E.placeMeeple(g, 'city', 0); // Alice's only meeple
  assert(g.currentPlayer === 1 && g.phase === 'placeTile', 'Bob to place a tile');
  g.currentTile = 'road_straight';
  E.placeTile(g, 0, 1, 0); // Bob has a meeple: should be asked
  assert(g.phase === 'placeMeeple', 'Bob (with a meeple) is asked about a meeple');
  E.skipMeeple(g);
  assert(g.currentPlayer === 0 && g.phase === 'placeTile', 'back to Alice');
  g.currentTile = 'road_straight';
  E.placeTile(g, 0, 2, 0);
  assert(g.phase === 'placeTile' && g.currentPlayer === 1, `Alice has no meeples, so her turn should end right after placing the tile (phase=${g.phase}, current=${g.currentPlayer})`);
  assert(g.log[0]!.includes('no meeples left'), 'the chronicle explains why the turn passed');

  // (b) every feature on the new tile is already claimed (farm scoring off, so the field is not an option)
  const g2 = blankGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], 15, { farmScoring: false });
  g2.currentTile = 'city_cap';
  E.placeTile(g2, 0, 0, 0);
  E.placeMeeple(g2, 'city', 0);
  g2.currentTile = 'city_cap';
  E.placeTile(g2, 0, -1, 2); // joins (and closes) Alice's city; the only feature is hers
  assert(g2.phase === 'placeTile' && g2.currentPlayer === 0, 'Bob has nothing to claim, so his turn ends immediately');
  assert(g2.players[0]!.score === 4, `the closed city still scores for Alice on the auto-skip path, got ${g2.players[0]!.score}`);
  assert(g2.players[0]!.meeples === 7, 'and her knight comes home');
}

// --- Test 15: the start tile is pre-placed by the table, not by the first player ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(16));
  assert(g.board['0,0']?.tileKey === 'city_cap_road_straight' && g.board['0,0']?.placedBy === -1, 'start tile sits at the origin, owned by nobody');
  assert(g.phase === 'placeTile' && g.currentPlayer === 0 && g.currentTile !== null, 'Alice is drawing the first real tile');
  assert(g.deck.length + 2 === 72, `72 tiles = start tile + current tile + ${g.deck.length} in the bag`);
  assert(E.getLegalPlacements(g).every((p) => !(p.x === 0 && p.y === 0)), 'nothing can go on top of the start tile');
  assert(E.getMeepleOptions(g).length === 0, 'no meeple decision is offered before a tile is placed');
}

// --- Test 16: the River — spring first, lake last, then the whole base deck ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(20), { river: true });
  assert(g.board['0,0']?.tileKey === 'river_spring', 'the spring is the start tile');
  assert(g.deck.length + 2 === TOTAL_TILE_COUNT + RIVER_TILE_COUNT, `river game deals ${TOTAL_TILE_COUNT + RIVER_TILE_COUNT} tiles, got ${g.deck.length + 2}`);
  assert(RIVER_TILE_COUNT === 12, 'the River has 12 tiles');
  const riverPart = [g.currentTile!, ...g.deck.slice(0, 10)];
  assert(riverPart.every((k) => TILE_TYPES[k]!.river) && riverPart[riverPart.length - 1] === 'river_lake', `the 11 tiles after the spring are river tiles ending with the lake, got ${riverPart.join(',')}`);
  assert(g.deck.slice(10).every((k) => !TILE_TYPES[k]!.river), 'no river tiles after the lake');
  assert(g.deck.slice(10).includes('city_cap_road_straight') && g.deck.slice(10).length === TOTAL_TILE_COUNT, 'the base deck (start tile included) follows in full');
}

// --- Test 17: river tiles must continue the river and may not double back ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }], mkRng(21), { river: true }); // spring at (0,0), water on E
  g.currentTile = 'river_straight'; // water W–E at rot 0
  assert(E.isLegalPlacement(g, 'river_straight', 0, 1, 0), 'a straight continues the river eastward');
  assert(!E.isLegalPlacement(g, 'river_straight', 1, 1, 0), 'a straight turned N–S beside the spring does not meet the water');
  assert(!E.isLegalPlacement(g, 'river_straight', 0, 0, 1), 'field-to-field on the spring\'s south side is not a river continuation');
  g.currentTile = 'river_curve'; // water S+W at rot 0
  E.placeTile(g, 1, 0, 0); // enters from W, leaves S
  E.skipMeeple(g);
  assert(g.riverLastTurn === 3, `first bend recorded (turn ${g.riverLastTurn})`);
  g.currentTile = 'river_curve';
  assert(!E.isLegalPlacement(g, 'river_curve', 1, 1, 1), 'a second bend the same way (a U-turn) is forbidden');
  assert(E.isLegalPlacement(g, 'river_curve', 2, 1, 1), 'a bend the other way is fine');
  g.currentTile = 'river_straight';
  assert(E.isLegalPlacement(g, 'river_straight', 1, 1, 1), 'a straight between bends is fine');
  assert(!E.isLegalPlacement(g, 'city_cap', 0, 1, 1), 'a base tile cannot sit on the open river end');
  E.placeTile(g, 1, 1, 1); // river now flows south through (1,1)
  E.skipMeeple(g);
  g.currentTile = 'river_curve';
  assert(!E.isLegalPlacement(g, 'river_curve', 1, 1, 2), 'after a straight, a bend the same way as the last bend is still forbidden');
  assert(E.isLegalPlacement(g, 'river_curve', 2, 1, 2), 'a bend the other way is allowed');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
