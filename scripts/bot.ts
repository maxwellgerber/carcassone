// Dev-only test harness: logs in via the dev-mode mock auth (a real session cookie,
// same code path production OIDC would produce), then drives a WebSocket connection
// as a "player" for local testing. Superseded for actual gameplay by the in-product
// NPC feature (see src/server/npc.ts) — this remains useful for protocol-level
// testing (malformed messages, reconnects) that a real NPC seat wouldn't exercise.
import WebSocket from 'ws';
import { getLegalPlacements, getMeepleOptions } from '../src/shared/engine.js';
import type { RoomDoc } from '../src/shared/room-types.js';

const roomId = process.argv[2];
const name = process.argv[3] || 'Bot';
const host = process.argv[4] || 'localhost:8787';
if (!roomId) { console.error('usage: tsx scripts/bot.ts <roomId> [name] [host]'); process.exit(1); }

async function devLogin(): Promise<string> {
  const res = await fetch(`http://${host}/auth/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `name=${encodeURIComponent(name)}` });
  // Node's fetch (undici) exposes getSetCookie() for multiple Set-Cookie headers;
  // dev login can send two (a persistent dev-id cookie plus the session cookie).
  const cookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (cookies.length === 0) {
    const single = res.headers.get('set-cookie');
    if (single) cookies.push(single);
  }
  if (cookies.length === 0) throw new Error(`dev login failed: no Set-Cookie in response (status ${res.status})`);
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function main() {
  const cookie = await devLogin();
  const ws = new WebSocket(`ws://${host}/api/room/${roomId}/ws`, { headers: { Cookie: cookie } });

  ws.addEventListener('open', () => console.log(`[bot] connected as ${name}`));
  ws.addEventListener('close', (e) => console.log('[bot] closed', e.code, e.reason));
  ws.addEventListener('error', (e) => console.log('[bot] error', e.message));

  let acting = false;
  ws.addEventListener('message', async (ev) => {
    const msg = JSON.parse(ev.data as string);
    if (msg.type !== 'sync') { console.log('[bot]', msg); return; }
    const room = msg.room as RoomDoc;
    if (room.phase !== 'playing' || !room.game) return;
    const me = room.game.players[room.game.currentPlayer];
    if (!me || acting) return;
    // We don't know our own verified id from here (dev login mints it server-side);
    // act whenever it's the seat we most recently joined as — good enough for manual testing.
    acting = true;
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    try {
      if (room.game.phase === 'placeTile') {
        const legal = getLegalPlacements(room.game);
        if (legal.length === 0) { console.log('[bot] no legal placements?!'); acting = false; return; }
        const pick = legal[Math.floor(Math.random() * legal.length)]!;
        console.log(`[bot] placing ${room.game.currentTile} at (${pick.x},${pick.y}) rot${pick.rot}`);
        ws.send(JSON.stringify({ type: 'place_tile', ...pick }));
      } else if (room.game.phase === 'placeMeeple') {
        const opts = getMeepleOptions(room.game);
        if (opts.length > 0 && me.meeples > 0 && Math.random() < 0.6) {
          const o = opts[Math.floor(Math.random() * opts.length)]!;
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
}

main().catch((e) => { console.error(e); process.exit(1); });
