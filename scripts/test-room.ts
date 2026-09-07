// The room is the fold of its event log: play a whole game through applyEvent with
// recorded seeds, then fold the same events from scratch and demand the identical
// document. Also checks that a game summary is recorded and that the replay
// (seed + moves) rebuilds the exact final board through the bare engine.
import * as E from '../src/shared/engine.js';
import { applyEvent, foldEvents, freshRoom, npcToActNext } from '../src/server/room.js';
import { chooseNpcMeepleMove, chooseNpcTilePlacement } from '../src/server/npc.js';
import { mkRng } from '../src/shared/rng.js';
import type { RoomEvent, Action, InternalAction } from '../src/shared/room-types.js';

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) pass++; else { fail++; console.error('FAIL:', msg); }
}

const seeds = mkRng(2024);
const events: RoomEvent[] = [];
const room = freshRoom(1_000);
let clock = 1_000;
function record(playerId: string, action: Action | InternalAction): void {
  clock += 1_000;
  const ev: RoomEvent = { seq: room.seq + 1, ts: clock, playerId, seed: Math.floor(seeds() * 0xffffffff) || 1, action };
  applyEvent(room, ev);
  events.push(ev);
}

record('alice', { type: 'join', name: 'Alice' });
record('bob', { type: 'join', name: 'Bob' });
record('alice', { type: 'add_npc', difficulty: 'normal' });
record('alice', { type: 'set_config', config: { river: true } });
record('bob', { type: 'chat', text: 'gl hf' });
record('alice', { type: 'start' });
assert(room.phase === 'playing' && !!room.game, 'game started');
assert(room.gameStart?.seq === 6, `start recorded at seq 6, got ${JSON.stringify(room.gameStart)}`);

// Play it out: humans move like the normal bot, the NPC like itself.
let guard = 0;
while (room.phase === 'playing' && room.game) {
  if (++guard > 1000) throw new Error('runaway');
  const g = room.game;
  const cur = g.players[g.currentPlayer]!;
  const npc = npcToActNext(room);
  const who = npc?.id ?? cur.id;
  const rng = mkRng(guard);
  if (g.phase === 'placeTile') {
    const p = chooseNpcTilePlacement(g, 'normal', rng);
    record(who, { type: 'place_tile', ...p });
  } else {
    const mv = chooseNpcMeepleMove(g, 'normal', rng);
    record(who, mv);
  }
  if (guard === 20) record('bob', { type: 'disconnect' });
  if (guard === 24) record('bob', { type: 'join', name: 'Bob' });
}
assert(room.phase === 'ended', 'game ended');
assert(room.games.length === 1, `one game summary recorded, got ${room.games.length}`);
const summary = room.games[0]!;
assert(summary.firstSeq === 6 && summary.lastSeq === room.seq, `summary spans the game's events (${summary.firstSeq}..${summary.lastSeq} vs seq ${room.seq})`);
assert(summary.players.length === 3 && summary.players.every((p) => typeof p.score === 'number'), 'summary carries every seat with a score');
assert(summary.tilesPlaced === Object.keys(room.game!.board).length, 'summary tile count matches the board');

// 1. Folding the log from scratch reproduces the live document exactly.
const rebuilt = foldEvents(events, 1_000);
assert(JSON.stringify(rebuilt) === JSON.stringify(room), 'fold(events) === live room');

// 2. Folding twice is idempotent (no hidden state in the fold).
assert(JSON.stringify(foldEvents(events, 1_000)) === JSON.stringify(rebuilt), 'fold is deterministic');

// 3. A replay through the bare engine, from the recorded seed and the in-game
//    moves only, lands on the same final board and scores.
const startEv = events.find((e) => e.seq === summary.firstSeq)!;
const replayGame = E.createGame(summary.players.map((p) => ({ id: p.id, name: p.name, color: p.color, isNpc: p.isNpc, npcDifficulty: p.npcDifficulty })), mkRng(startEv.seed), summary.config);
for (const ev of events) {
  if (ev.seq <= summary.firstSeq || ev.seq > summary.lastSeq) continue;
  const a = ev.action;
  if (a.type === 'place_tile') E.placeTile(replayGame, a.x, a.y, a.rot);
  else if (a.type === 'place_meeple') E.placeMeeple(replayGame, a.kind, a.idx);
  else if (a.type === 'skip_meeple') E.skipMeeple(replayGame);
}
assert(replayGame.phase === 'gameover', 'replay reaches game over');
assert(JSON.stringify(replayGame.board) === JSON.stringify(room.game!.board), 'replayed board matches');
assert(JSON.stringify(replayGame.players.map((p) => p.score)) === JSON.stringify(room.game!.players.map((p) => p.score)), 'replayed scores match');
assert(JSON.stringify(replayGame.meeples) === JSON.stringify(room.game!.meeples), 'replayed meeples match');

// 4. Internal actions are folded too: Bob's disconnect and return are in the chat.
assert(room.chat.some((c) => c.text === 'Bob disconnected.') && room.chat.some((c) => c.text === 'Bob reconnected.'), 'socket lifecycle recorded as events');

console.log(`\n${pass} passed, ${fail} failed (${events.length} events)`);
process.exit(fail ? 1 : 0);
