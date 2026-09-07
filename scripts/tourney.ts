// Round-robin-ish tournament between the NPC brains, to measure them rather than
// guess. Seats are filled at random from a pool of bots (so every bot meets every
// other, in every seat), across 2..5-player tables.
//
//   npx tsx scripts/tourney.ts [--players 2,3,4,5] [--games 40] [--seed 1] [--out report.json]
//
// Bots: easy / normal / hard are the live brains; old-normal / old-hard are the
// pre-rewrite heuristics (scripts/legacy-npc.ts) kept as a baseline.
import * as E from '../src/shared/engine.js';
import { chooseNpcMeepleMove, chooseNpcTilePlacement, NPC_SEARCH, NPC_TUNING } from '../src/server/npc.js';
import { chooseNpcMeepleMove as oldMeeple, chooseNpcTilePlacement as oldTile } from './legacy-npc.js';
import type { GameState, NpcDifficulty, Placement } from '../src/shared/types.js';
import { writeFileSync } from 'node:fs';

type BotName = 'easy' | 'normal' | 'hard' | 'old-normal' | 'old-hard' | 'net' | 'net-hard' | 'blend' | 'blend-hard' | 'hand' | 'hand-hard';
const BOTS: BotName[] = ['easy', 'normal', 'hard', 'old-normal', 'old-hard', 'net', 'net-hard', 'blend', 'blend-hard', 'hand', 'hand-hard'];
/** Which evaluator each bot thinks with (switched per move so bots can share a table);
 *  plain normal/hard use whatever NPC_TUNING.evaluator ships with. */
const EVALUATOR: Partial<Record<BotName, 'hand' | 'net' | 'blend'>> = { net: 'net', 'net-hard': 'net', blend: 'blend', 'blend-hard': 'blend', hand: 'hand', 'hand-hard': 'hand' };

function mkRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
}
function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
}

const playerCounts = arg('players', '2,3,4,5').split(',').map(Number);
const gamesPer = Number(arg('games', '40'));
const seed = Number(arg('seed', '1'));
const outPath = arg('out', '');
NPC_SEARCH.thinkMs = Number(arg('think', '400'));
// --tune '{"reserveValue":6,"staticWeight":0.6,"rollouts":12}' overrides any knob for a sweep.
for (const [k, v] of Object.entries(JSON.parse(arg('tune', '{}')) as Record<string, number>)) {
  if (k in NPC_SEARCH) (NPC_SEARCH as Record<string, number>)[k] = v; else if (k in NPC_TUNING) (NPC_TUNING as Record<string, number>)[k] = v; else throw new Error(`unknown knob ${k}`);
}
const onlyBots = arg('bots', '');
const POOL: BotName[] = onlyBots ? (onlyBots.split(',') as BotName[]) : BOTS.filter((b) => !EVALUATOR[b]);

const baseEvaluator = NPC_TUNING.evaluator;
function difficultyOf(bot: BotName): NpcDifficulty { return bot.endsWith('-hard') ? 'hard' : EVALUATOR[bot] ? 'normal' : bot as NpcDifficulty; }
function tileMove(bot: BotName, g: GameState, rng: () => number): Placement {
  if (bot === 'old-normal') return oldTile(g, 'normal', rng);
  if (bot === 'old-hard') return oldTile(g, 'hard', rng);
  NPC_TUNING.evaluator = EVALUATOR[bot] ?? baseEvaluator;
  return chooseNpcTilePlacement(g, difficultyOf(bot), rng);
}
function meepleMove(bot: BotName, g: GameState, rng: () => number) {
  if (bot === 'old-normal') return oldMeeple(g, 'normal', rng);
  if (bot === 'old-hard') return oldMeeple(g, 'hard', rng);
  NPC_TUNING.evaluator = EVALUATOR[bot] ?? baseEvaluator;
  return chooseNpcMeepleMove(g, difficultyOf(bot), rng);
}

interface Tally { games: number; wins: number; score: number; margin: number; midReserve: number; idleTurns: number; turns: number; thinkMs: number; moves: number }
const tally: Record<number, Record<BotName, Tally>> = {};
const h2h: Record<string, { games: number; wins: number }> = {}; // 2-player only: "a>b"

const fresh = (): Tally => ({ games: 0, wins: 0, score: 0, margin: 0, midReserve: 0, idleTurns: 0, turns: 0, thinkMs: 0, moves: 0 });

for (const n of playerCounts) {
  tally[n] = Object.fromEntries(BOTS.map((b) => [b, fresh()])) as Record<BotName, Tally>;
  const started = Date.now();
  for (let gi = 0; gi < gamesPer; gi++) {
    const rng = mkRng(seed * 1000003 + n * 7919 + gi * 104729);
    // Random lineup, but never a table of clones — that measures nothing.
    let lineup: BotName[];
    do lineup = Array.from({ length: n }, () => POOL[Math.floor(rng() * POOL.length)]!); while (new Set(lineup).size < 2);
    const g = E.createGame(lineup.map((b, i) => ({ id: `p${i}`, name: `${b}#${i}`, isNpc: true })), rng, {});
    const total = g.deck.length + 1;
    const idle = lineup.map(() => 0), turnsBy = lineup.map(() => 0), think = lineup.map(() => 0), moves = lineup.map(() => 0);
    let midReserve: number[] | null = null;
    let guard = 0;
    while (g.phase !== 'gameover') {
      if (++guard > 2000) throw new Error('runaway game');
      const who = g.currentPlayer;
      const bot = lineup[who]!;
      const t0 = performance.now();
      if (g.phase === 'placeTile') {
        turnsBy[who]!++;
        if (g.players[who]!.meeples === 0) idle[who]!++;
        const p = tileMove(bot, g, rng);
        E.placeTile(g, p.x, p.y, p.rot);
      } else {
        const mv = meepleMove(bot, g, rng);
        if (mv.type === 'place_meeple') E.placeMeeple(g, mv.kind, mv.idx); else E.skipMeeple(g);
      }
      think[who]! += performance.now() - t0; moves[who]!++;
      if (!midReserve && g.deck.length <= total / 2) midReserve = g.players.map((p) => p.meeples);
    }
    const scores = g.players.map((p) => p.score);
    const top = Math.max(...scores);
    const winners = scores.filter((s) => s === top).length;
    const mean = scores.reduce((a, b) => a + b, 0) / n;
    lineup.forEach((b, i) => {
      const t = tally[n]![b];
      t.games++; t.wins += scores[i] === top ? 1 / winners : 0;
      t.score += scores[i]!; t.margin += scores[i]! - mean;
      t.midReserve += midReserve?.[i] ?? 0;
      t.idleTurns += idle[i]!; t.turns += turnsBy[i]!;
      t.thinkMs += think[i]!; t.moves += moves[i]!;
    });
    if (n === 2) {
      const [a, b] = lineup as [BotName, BotName];
      for (const [x, y, i] of [[a, b, 0], [b, a, 1]] as const) {
        const k = `${x}>${y}`;
        h2h[k] ??= { games: 0, wins: 0 };
        h2h[k].games++; h2h[k].wins += scores[i] === top ? 1 / winners : 0;
      }
    }
    if ((gi + 1) % 10 === 0) console.error(`  ${n}p: ${gi + 1}/${gamesPer} games (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }
}

// ---- report ----
const fmt = (x: number, d = 1) => x.toFixed(d).padStart(6);
for (const n of playerCounts) {
  console.log(`\n${n} players — ${gamesPer} games, random seats\n`);
  console.log('bot         seats  win%   avg pts  margin  reserve@mid  idle turns%  ms/move');
  for (const b of BOTS) {
    const t = tally[n]![b];
    if (!t.games) continue;
    console.log(`${b.padEnd(11)} ${String(t.games).padStart(5)} ${fmt(100 * t.wins / t.games)} ${fmt(t.score / t.games)}  ${fmt(t.margin / t.games)}  ${fmt(t.midReserve / t.games, 2)}       ${fmt(100 * t.idleTurns / Math.max(1, t.turns))}  ${fmt(t.thinkMs / Math.max(1, t.moves), 0)}`);
  }
}
if (playerCounts.includes(2)) {
  console.log('\nHead-to-head, 2 players (row beats column, win%)\n');
  console.log('            ' + BOTS.map((b) => b.padStart(11)).join(''));
  for (const a of BOTS) {
    console.log(a.padEnd(12) + BOTS.map((b) => { const r = h2h[`${a}>${b}`]; return r && a !== b ? `${(100 * r.wins / r.games).toFixed(0)}% (${r.games})`.padStart(11) : '—'.padStart(11); }).join(''));
  }
}
if (outPath) writeFileSync(outPath, JSON.stringify({ playerCounts, gamesPer, seed, tally, h2h }, null, 2));
