// Play whole games with the NPC brains against the pure engine, checking invariants
// on every move. Not part of `npm test` by default (it's slow-ish); run it with
//   npx tsx scripts/simulate.ts [games] [seed]
// to shake out rules bugs that a hand-written unit test wouldn't think to cover.
import * as E from '../src/shared/engine.js';
import { chooseNpcMeepleMove, chooseNpcTilePlacement } from '../src/server/npc.js';
import { TILE_TYPES } from '../src/shared/tiles.js';
import type { GameConfig, NpcDifficulty } from '../src/shared/types.js';

function mkRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
}

const games = Number(process.argv[2] ?? 40);
const baseSeed = Number(process.argv[3] ?? 1);
const difficulties: NpcDifficulty[] = ['easy', 'normal', 'hard'];
const configs: Partial<GameConfig>[] = [
  {},
  { farmScoring: false },
  { monasteryScoring: false },
  { shieldBonus: false },
  { quickGame: true },
  { meeplesPerPlayer: 5 },
  { farmScoring: false, monasteryScoring: false, shieldBonus: false, quickGame: true, meeplesPerPlayer: 9 },
  { river: true },
  { river: true, quickGame: true },
  { river: true, farmScoring: false },
];

let autoSkips = 0, discards = 0, totalTurns = 0, maxTurnMs = 0;
const wins = new Map<string, number>();

for (let gi = 0; gi < games; gi++) {
  const rng = mkRng(baseSeed + gi * 7919);
  const nPlayers = 2 + Math.floor(rng() * 5);
  const players = Array.from({ length: nPlayers }, (_, i) => ({ id: `p${i}`, name: `P${i}-${difficulties[i % 3]}`, isNpc: true, npcDifficulty: difficulties[i % 3] }));
  const cfg = configs[gi % configs.length]!;
  const g = E.createGame(players, rng, cfg);
  const initialTiles = g.deck.length + 2; // bag + the drawn tile + the start tile already on the table
  let turns = 0;
  while (g.phase !== 'gameover') {
    turns++;
    if (turns > 500) throw new Error(`game ${gi}: runaway turn loop`);
    const cur = g.players[g.currentPlayer]!;
    const diff = cur.npcDifficulty ?? 'normal';
    const t0 = performance.now();
    if (g.phase === 'placeTile') {
      const before = Object.keys(g.board).length;
      const logBefore = g.log.length;
      const p = chooseNpcTilePlacement(g, diff, rng);
      const who = g.currentPlayer;
      E.placeTile(g, p.x, p.y, p.rot);
      if (Object.keys(g.board).length !== before + 1) throw new Error('tile count did not grow by one');
      if ((g.phase as string) === 'placeTile' && g.currentPlayer !== who) {
        autoSkips++;
        if (!g.log.slice(0, g.log.length - logBefore).some((l) => l.includes('turn passes'))) throw new Error('auto-skip without a log line');
      } else if (g.phase !== 'placeMeeple' && (g.phase as string) !== 'gameover') throw new Error(`unexpected phase ${g.phase}`);
      if (g.phase === 'placeMeeple' && E.getMeepleOptions(g).length === 0) throw new Error('paused for a meeple decision with no options');
    } else if (g.phase === 'placeMeeple') {
      const opts = E.getMeepleOptions(g);
      if (opts.length === 0) throw new Error('engine stopped for a meeple with nothing to place');
      const mv = chooseNpcMeepleMove(g, diff, rng);
      if (mv.type === 'place_meeple') E.placeMeeple(g, mv.kind, mv.idx); else E.skipMeeple(g);
    }
    maxTurnMs = Math.max(maxTurnMs, performance.now() - t0);
    // Invariants after every move
    for (const p of g.players) {
      if (p.meeples < 0 || p.meeples > g.config.meeplesPerPlayer) throw new Error(`meeple count out of range for ${p.name}: ${p.meeples}`);
      if (p.score < 0) throw new Error('negative score');
    }
    const onBoard = g.meeples.length;
    const inHand = g.players.reduce((a, p) => a + p.meeples, 0);
    if (g.phase !== 'gameover' && onBoard + inHand !== g.config.meeplesPerPlayer * g.players.length) throw new Error(`meeples leaked: ${onBoard} on board + ${inHand} in hand`);
    for (const m of g.meeples) if (!g.board[`${m.x},${m.y}`]) throw new Error('meeple on an empty cell');
  }
  discards += g.log.filter((l) => l.includes('set aside')).length;
  totalTurns += turns;
  const placed = Object.keys(g.board).length;
  if (placed + g.log.filter((l) => l.includes('set aside')).length !== initialTiles) throw new Error(`game ${gi}: ${placed} placed + discards != ${initialTiles} dealt`);
  if (!g.winnerIds || g.winnerIds.length === 0) throw new Error('no winner recorded');
  for (const w of g.winnerIds) {
    const p = g.players.find((pp) => pp.id === w)!;
    wins.set(p.npcDifficulty!, (wins.get(p.npcDifficulty!) ?? 0) + 1);
  }
  const top = Math.max(...g.players.map((p) => p.score));
  console.log(`game ${String(gi).padStart(3)}: ${nPlayers}p ${JSON.stringify(cfg).padEnd(60)} ${placed} tiles, top score ${top}, winner ${g.winnerIds.map((w) => g.players.find((p) => p.id === w)!.name).join('/')}`);
}

const kinds = Object.keys(TILE_TYPES).length;
console.log(`\n${games} games OK — ${totalTurns} turns, ${autoSkips} auto-skipped meeple decisions, ${discards} discarded tiles, ${kinds} tile types, slowest move ${maxTurnMs.toFixed(1)}ms`);
console.log('wins by difficulty:', Object.fromEntries(wins));
