import { applyEvent, foldEvents, migrateRoom, npcToActNext, type Action, type InternalAction, type RoomDoc, type RoomEvent } from './room.js';
import { chooseNpcMeepleMove, chooseNpcTilePlacement } from './npc.js';
import { registerRoom, recordHistory } from './registry.js';
import { randomSeed } from '../shared/rng.js';
import type { ReplayDoc } from '../shared/room-types.js';
import type { Env } from './env.js';

interface WsAttachment {
  playerId: string;
}

const NPC_MOVE_DELAY_MS = [700, 1400] as const;
const IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // no activity for this long -> reset the room

const evKey = (seq: number) => `ev:${String(seq).padStart(9, '0')}`;

/** A room is the fold of its event log. Storage holds every event under `ev:<seq>`
 *  plus a `room` snapshot of the fold so far; on load the snapshot is taken and any
 *  events past it (a crash between the two writes, or a manual repair) are folded
 *  in. The snapshot is a cache, the log is the truth. */
export class GameRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private room!: RoomDoc;
  private roomId = '';
  private loaded: Promise<void>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.loaded = this.state.blockConcurrencyWhile(async () => {
      const raw = await this.state.storage.get('room');
      this.room = migrateRoom(raw, Date.now());
      this.roomId = (await this.state.storage.get<string>('roomId')) ?? '';
      // Catch up on any events the snapshot doesn't include yet.
      const tail = await this.state.storage.list<RoomEvent>({ prefix: 'ev:', start: evKey(this.room.seq + 1) });
      for (const ev of tail.values()) applyEvent(this.room, ev);
    });
  }

  private async persist(): Promise<void> {
    await this.state.storage.put('room', this.room);
  }

  private broadcast(): void {
    const payload = JSON.stringify({ type: 'sync', room: this.room });
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(payload); } catch { /* socket may be mid-close; next sync will catch it up */ }
    }
  }

  /** The one mutation entrypoint: record an event, fold it, persist both. Rolls the
   *  in-memory room back on any throw, so a bug (ours or a future game mode's) can
   *  never leave `this.room` ahead of what's actually persisted and broadcast. */
  private async commit(playerId: string, action: Action | InternalAction): Promise<void> {
    const snapshot = structuredClone(this.room);
    const ev: RoomEvent = { seq: this.room.seq + 1, ts: Date.now(), playerId, seed: randomSeed(), action };
    const gamesBefore = this.room.games.length;
    try {
      applyEvent(this.room, ev);
    } catch (err) {
      this.room = snapshot;
      throw err;
    }
    await this.state.storage.put({ [evKey(ev.seq)]: ev, room: this.room });
    this.broadcast();
    if (this.room.games.length > gamesBefore) {
      const summary = this.room.games[this.room.games.length - 1]!;
      await recordHistory(this.env.ROOM_REGISTRY, this.roomId, summary);
    }
    await this.scheduleNextAlarm();
  }

  /** A Durable Object has exactly one pending alarm at a time, so this single slot
   *  does double duty: it fires soon if an NPC needs to move, or — when nothing is
   *  waiting on an NPC — it fires once idle-cleanup is actually due, tracking
   *  whatever `lastActivityAt` is *right now* rather than a fixed delay. Any real
   *  activity reschedules it forward, so the deadline always reflects the true
   *  idle time, not the moment cleanup was first considered. */
  private async scheduleNextAlarm(): Promise<void> {
    const npc = npcToActNext(this.room);
    if (npc) {
      const [lo, hi] = NPC_MOVE_DELAY_MS;
      await this.state.storage.setAlarm(Date.now() + lo + Math.random() * (hi - lo));
      return;
    }
    await this.state.storage.setAlarm(this.room.lastActivityAt + IDLE_TTL_MS);
  }

  async alarm(): Promise<void> {
    await this.loaded;
    const npc = npcToActNext(this.room);
    if (npc && this.room.game) {
      const rng = Math.random;
      try {
        if (this.room.game.phase === 'placeTile') {
          const placement = chooseNpcTilePlacement(this.room.game, npc.difficulty, rng);
          await this.commit(npc.id, { type: 'place_tile', ...placement });
        } else if (this.room.game.phase === 'placeMeeple') {
          const move = chooseNpcMeepleMove(this.room.game, npc.difficulty, rng);
          await this.commit(npc.id, move);
        }
      } catch (err) {
        // An NPC failing to move should never wedge the room — note it and let the
        // next scheduled check (if any) retry rather than throwing out of alarm().
        try { await this.commit(npc.id, { type: 'system_note', text: `(${npc.id} hesitated: ${String(err)})` }); } catch { /* noted best-effort */ }
        await this.scheduleNextAlarm();
      }
      return;
    }
    // Not an NPC turn — this alarm firing means an idle-cleanup check is due.
    if (Date.now() - this.room.lastActivityAt >= IDLE_TTL_MS) {
      await this.state.storage.deleteAll(); // room resets to fresh on the next connection
      return;
    }
    await this.scheduleNextAlarm(); // activity happened since this was scheduled; push it out again
  }

  async fetch(request: Request): Promise<Response> {
    await this.loaded;
    const url = new URL(request.url);
    const hinted = request.headers.get('X-Room-Id');
    if (hinted && hinted !== this.roomId) { this.roomId = hinted; await this.state.storage.put('roomId', hinted); }
    if (url.pathname.endsWith('/ws')) return this.handleWebSocketUpgrade(request);
    if (url.pathname.endsWith('/action')) return this.handleRpcAction(request);
    if (url.pathname.endsWith('/state')) return this.handleGetState(request);
    const replay = url.pathname.match(/\/replay\/([^/]+)$/);
    if (replay) return this.handleReplay(request, replay[1]!);
    if (url.pathname.endsWith('/verify')) return this.handleVerify(request);
    return new Response('not found', { status: 404 });
  }

  // -------------------------------------------------------------------------
  // WebSocket (hibernatable) — the DO can be evicted between messages; state
  // lives in `this.room` (reloaded from storage on wake) and in each socket's
  // small serialized attachment, not in an in-memory sessions map.
  // -------------------------------------------------------------------------
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const playerId = request.headers.get('X-Verified-User-Id');
    const name = (request.headers.get('X-Verified-User-Name') ?? 'Traveler').slice(0, 24);
    if (!playerId) return new Response('missing verified identity', { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: WsAttachment = { playerId };
    server.serializeAttachment(attachment);
    this.state.acceptWebSocket(server, [playerId]);

    const wasEmpty = this.room.players.length === 0;
    await this.commit(playerId, { type: 'join', name });
    if (wasEmpty) await registerRoom(this.env.ROOM_REGISTRY, this.roomId || this.state.id.toString(), playerId);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.loaded;
    if (typeof message !== 'string') return;
    const { playerId } = ws.deserializeAttachment() as WsAttachment;
    let msg: unknown;
    try { msg = JSON.parse(message); } catch { return; }
    const action = toAction(msg);
    if (!action) return;
    try {
      await this.commit(playerId, action);
    } catch (err) {
      try { ws.send(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) })); } catch { /* ignore */ }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.loaded;
    const { playerId } = ws.deserializeAttachment() as WsAttachment;
    const stillOpen = this.state.getWebSockets(playerId).length > 0;
    if (stillOpen) return; // another tab for the same player is still connected
    if (!this.room.players.some((p) => p.id === playerId)) return;
    try {
      await this.commit(playerId, { type: this.room.phase === 'lobby' ? 'leave' : 'disconnect' });
    } catch { /* a departure that fails to record is harmless; the next join reconciles */ }
  }

  async webSocketError(): Promise<void> {
    // Runtime will follow with webSocketClose; nothing additional to do here.
  }

  // -------------------------------------------------------------------------
  // Synchronous RPC surface — same action layer, used by the MCP server (and
  // usable by anything else that would rather poll than hold a socket open).
  // -------------------------------------------------------------------------
  private async handleRpcAction(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('POST required', { status: 405 });
    const playerId = request.headers.get('X-Verified-User-Id');
    if (!playerId) return new Response('missing verified identity', { status: 401 });
    let body: unknown;
    try { body = await request.json(); } catch { return new Response('invalid JSON', { status: 400 }); }
    const action = toAction(body);
    if (!action) return new Response('invalid action', { status: 400 });
    const wasEmpty = action.type === 'join' && this.room.players.length === 0;
    try {
      await this.commit(playerId, action);
      if (wasEmpty) await registerRoom(this.env.ROOM_REGISTRY, this.roomId || this.state.id.toString(), playerId);
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
    return Response.json({ room: this.room });
  }

  private async handleGetState(request: Request): Promise<Response> {
    const playerId = request.headers.get('X-Verified-User-Id');
    if (!playerId) return new Response('missing verified identity', { status: 401 });
    return Response.json({ room: this.room });
  }

  /** The recorded seed and moves of one finished game, for the client to replay
   *  through the same engine. */
  private async handleReplay(request: Request, gameId: string): Promise<Response> {
    if (!request.headers.get('X-Verified-User-Id')) return new Response('missing verified identity', { status: 401 });
    const summary = this.room.games.find((g) => g.id === gameId);
    if (!summary) return Response.json({ error: 'No such game in this room (replays expire when a room is cleaned up).' }, { status: 404 });
    const events = await this.state.storage.list<RoomEvent>({ start: evKey(summary.firstSeq), end: evKey(summary.lastSeq + 1) });
    const moves: ReplayDoc['moves'] = [];
    for (const ev of events.values()) {
      const a = ev.action;
      if (a.type === 'place_tile' || a.type === 'place_meeple' || a.type === 'skip_meeple') moves.push({ seq: ev.seq, ts: ev.ts, playerId: ev.playerId, action: a });
    }
    const doc: ReplayDoc = { roomId: this.roomId, summary, moves };
    return Response.json(doc);
  }

  /** Debug/ops: fold the whole log from scratch and report whether it matches the
   *  live document. Cheap insurance that the event log really is the truth. */
  private async handleVerify(request: Request): Promise<Response> {
    if (!request.headers.get('X-Verified-User-Id')) return new Response('missing verified identity', { status: 401 });
    const events = await this.state.storage.list<RoomEvent>({ prefix: 'ev:' });
    const list = [...events.values()];
    const first = list[0];
    const rebuilt = foldEvents(list, first?.ts ?? this.room.createdAt);
    // Rooms that predate the log carry state the log can't reproduce; compare only
    // when the log starts at seq 1.
    const comparable = first?.seq === 1;
    const same = comparable && JSON.stringify(rebuilt.game) === JSON.stringify(this.room.game) && JSON.stringify(rebuilt.players) === JSON.stringify(this.room.players);
    return Response.json({ events: list.length, seq: this.room.seq, comparable, matches: same });
  }
}

function toAction(msg: unknown): Action | null {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return null;
  const m = msg as Record<string, unknown>;
  switch (m.type) {
    case 'join': return typeof m.name === 'string' ? { type: 'join', name: m.name } : null;
    case 'set_name': return typeof m.name === 'string' ? { type: 'set_name', name: m.name } : null;
    case 'set_color': return typeof m.color === 'string' ? { type: 'set_color', color: m.color } : null;
    case 'set_config': return m.config && typeof m.config === 'object' ? { type: 'set_config', config: m.config as never } : null;
    case 'add_npc': return { type: 'add_npc', difficulty: (m.difficulty === 'easy' || m.difficulty === 'hard') ? m.difficulty : 'normal' };
    case 'remove_npc': return typeof m.npcId === 'string' ? { type: 'remove_npc', npcId: m.npcId } : null;
    case 'start': return { type: 'start' };
    case 'place_tile':
      return { type: 'place_tile', x: Number(m.x), y: Number(m.y), rot: Number(m.rot) };
    case 'place_meeple':
      return (m.kind === 'city' || m.kind === 'road' || m.kind === 'monastery' || m.kind === 'farm') && typeof m.idx === 'number'
        ? { type: 'place_meeple', kind: m.kind, idx: m.idx } : null;
    case 'skip_meeple': return { type: 'skip_meeple' };
    case 'new_game': return { type: 'new_game' };
    case 'chat': return typeof m.text === 'string' ? { type: 'chat', text: m.text } : null;
    default: return null; // internal action types never come from clients
  }
}
