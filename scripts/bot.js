// Dev-only test harness: connects to a running `wrangler dev` server as a second
// "player" over a raw WebSocket and plays automatically, so a human can test the
// real UI against a live opponent without two browser tabs colliding on localStorage
// (localStorage is shared per-origin across tabs, so it can't simulate two players).
import { getLegalPlacements, getMeepleOptions } from '../public/shared/engine.js';

const roomId = process.argv[2];
const name = process.argv[3] || 'Bot';
if (!roomId) { console.error('usage: node scripts/bot.js <roomId> [name]'); process.exit(1); }

const playerId = 'bot-' + roomId + '-' + name; // stable per room+name so a restarted bot rejoins its own seat
const url = `ws://localhost:8787/api/room/${roomId}/ws?playerId=${playerId}&name=${encodeURIComponent(name)}`;
const ws = new WebSocket(url);

ws.addEventListener('open', () => console.log(`[bot] connected as ${name} (${playerId})`));
ws.addEventListener('close', (e) => console.log('[bot] closed', e.code, e.reason));
ws.addEventListener('error', (e) => console.log('[bot] error', e.message));

let acting = false;
ws.addEventListener('message', async (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type !== 'sync') { console.log('[bot]', msg); return; }
  const room = msg.room;
  if (room.phase !== 'playing' || !room.game) return;
  const me = room.game.players[room.game.currentPlayer];
  if (me?.id !== playerId || acting) return;
  acting = true;
  await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
  try {
    if (room.game.phase === 'placeTile') {
      const legal = getLegalPlacements(room.game);
      if (legal.length === 0) { console.log('[bot] no legal placements?!'); acting = false; return; }
      const pick = legal[Math.floor(Math.random() * legal.length)];
      console.log(`[bot] placing ${room.game.currentTile} at (${pick.x},${pick.y}) rot${pick.rot}`);
      ws.send(JSON.stringify({ type: 'place_tile', x: pick.x, y: pick.y, rot: pick.rot }));
    } else if (room.game.phase === 'placeMeeple') {
      const opts = getMeepleOptions(room.game);
      if (opts.length > 0 && me.meeples > 0 && Math.random() < 0.6) {
        const o = opts[Math.floor(Math.random() * opts.length)];
        console.log(`[bot] placing meeple ${o.kind}`);
        ws.send(JSON.stringify({ type: 'place_meeple', kind: o.kind, idx: o.idx }));
      } else {
        console.log('[bot] skipping meeple');
        ws.send(JSON.stringify({ type: 'skip_meeple' }));
      }
    }
  } catch (e) {
    console.error('[bot] error acting', e);
  }
  acting = false;
});
