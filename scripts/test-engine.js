import * as E from '../public/shared/engine.js';
import { TILE_TYPES } from '../public/shared/tiles.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', msg); }
}

function mkRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// --- Test 1: city_cap at (0,0) rot=0 (city faces N), then city_cap at (0,-1) rot=2 (city faces S) closes a city ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(2));
  g.currentTile = 'city_cap';
  E.placeTile(g, 0, 0, 0); // city faces N
  E.skipMeeple(g);
  g.currentTile = 'city_cap';
  const legal = E.getLegalPlacements(g);
  const spot = legal.find((p) => p.x === 0 && p.y === -1 && p.rot === 2);
  assert(!!spot, 'city_cap rot2 at (0,-1) should be legal (city faces S, matches neighbor city facing N)');
  E.placeTile(g, 0, -1, 2);
  const opts = E.getMeepleOptions(g);
  assert(opts.some((o) => o.kind === 'city'), 'city meeple option available on newly placed tile');
  E.placeMeeple(g, 'city', opts.find((o) => o.kind === 'city').idx);
  // placing this meeple should immediately close the 2-tile city and score 4 points (2 per tile, no shield)
  assert(g.players[1].score === 4, `player B should score 4 for closed 2-tile city, got ${g.players[1].score}`);
  assert(g.players[1].meeples === 7, 'meeple returned after scoring');
}

// --- Test 2: field region count on an isolated monastery+1-road tile should be 1 (the ring is not split by a single road) ---
{
  const regions = TILE_TYPES.monastery_road.fieldRegions;
  assert(regions.length === 1 && regions[0].slots.length === 8, `monastery_road isolated should have 1 field region of 8 slots, got ${regions.length} region(s): ${JSON.stringify(regions.map(r=>r.slots))}`);
}

// --- Test 3: a straight road tile has 2 separate field regions (one on each side of the road) ---
{
  const regions = TILE_TYPES.road_straight.fieldRegions;
  assert(regions.length === 2, `road_straight should split field into 2 regions, got ${regions.length}`);
}

// --- Test 4: closing a 3-tile road between two monastery+road caps ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(3));
  g.currentTile = 'monastery_road'; // canonical: road on S
  E.placeTile(g, 0, 0, 0);
  let opts = E.getMeepleOptions(g);
  const roadOpt = opts.find((o) => o.kind === 'road');
  E.placeMeeple(g, 'road', roadOpt.idx);
  g.currentTile = 'road_straight'; // canonical road E-W; rotate 1 -> road N-S
  const legal1 = E.getLegalPlacements(g);
  assert(legal1.some((p) => p.x === 0 && p.y === 1 && p.rot === 1), 'straight road rotated to N-S should fit south of monastery tile');
  E.placeTile(g, 0, 1, 1);
  E.skipMeeple(g);
  g.currentTile = 'monastery_road'; // need road on N to cap; canonical road on S, rotate 2 -> road on N
  const legal2 = E.getLegalPlacements(g);
  assert(legal2.some((p) => p.x === 0 && p.y === 2 && p.rot === 2), 'capping monastery tile should fit south of the road, rot2');
  E.placeTile(g, 0, 2, 2);
  const opts2 = E.getMeepleOptions(g);
  assert(opts2.length === 0 || !opts2.some(o=>o.kind==='road'), 'road already claimed by player A, should not be offerable again');
  E.skipMeeple(g);
  const roadScorerA = g.players[0].score;
  assert(roadScorerA === 3, `player A should have scored 3 for the completed 3-tile road, got ${roadScorerA}`);
}

// --- Test 5: monastery completion (surrounded by 8 tiles) ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }], mkRng(4));
  g.currentTile = 'monastery_plain';
  E.placeTile(g, 0, 0, 0);
  E.placeMeeple(g, 'monastery', 0);
  const coords = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]; // spiral: each step touches a placed neighbor orthogonally
  for (const [dx, dy] of coords) {
    g.currentTile = 'city_cap';
    const legal = E.getLegalPlacements(g).find((p) => p.x === dx && p.y === dy);
    if (!legal) { console.error('no legal placement at', dx, dy, E.getLegalPlacements(g)); continue; }
    E.placeTile(g, dx, dy, legal.rot);
    E.skipMeeple(g);
  }
  assert(g.players[0].score === 9, `monastery should score 9 once surrounded, got ${g.players[0].score}`);
}

// --- Test 6: a farmer touching a completed city scores 3 at final scoring ---
{
  const g = E.createGame([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], mkRng(5));
  g.currentTile = 'city_cap';
  E.placeTile(g, 0, 0, 0); // city faces N
  const farmOpt = E.getMeepleOptions(g).find((o) => o.kind === 'farm');
  assert(!!farmOpt, 'city_cap should offer a farm meeple option');
  E.placeMeeple(g, 'farm', farmOpt.idx); // Alice farms
  g.currentTile = 'city_cap';
  E.placeTile(g, 0, -1, 2); // closes the city, no knight claims it
  assert(g.phase === 'placeMeeple', 'awaiting meeple decision on second tile');
  g.deck = []; // force end-of-game right after this decision
  E.skipMeeple(g);
  assert(g.phase === 'gameover', 'game should be over once deck is empty');
  assert(g.players[0].score === 3, `Alice's farm should score 3 (1 completed city x 3), got ${g.players[0].score}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
