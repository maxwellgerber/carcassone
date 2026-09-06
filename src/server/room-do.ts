import { applyAction, migrateRoom, npcToActNext, type Action, type ApplyContext, type RoomDoc } from './room.js';
import { chooseNpcMeepleMove, chooseNpcTilePlacement } from './npc.js';
import { registerRoom } from './registry.js';
import type { Env } from './env.js';

interface WsAttachment {
  playerId: string;
}

const NPC_MOVE_DELAY_MS = [700, 1400] as const;

export class GameRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private room!: RoomDoc;
  private loaded: Promise<void>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.loaded = this.state.blockConcurrencyWhile(async () => {
      const raw = await this.state.storage.get('room');
      this.room = migrateRoom(raw, Date.now());
    });
  }

  private ctx(): ApplyContext {
    return { now: Date.now(), rng: Math.random, newId: () => crypto.randomUUID() };
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

  /** The one mutation entrypoint. Snapshots before mutating and rolls back the
   *  in-memory room on any throw, so a bug (ours or a future game mode's) can never
   *  leave `this.room` ahead of what's actually persisted and broadcast. */
  private async commit(playerId: string, action: Action): Promise<void> {
    const snapshot = structuredClone(this.room);
    try {
      applyAction(this.room, playerId, action, this.ctx());
    } catch (err) {
      this.room = snapshot;
      throw err;
    }
    await this.persist();
    this.broadcast();
    await this.scheduleNpcIfNeeded();
  }

  private async scheduleNpcIfNeeded(): Promise<void> {
    const npc = npcToActNext(this.room);
    if (!npc) return;
    const [lo, hi] = NPC_MOVE_DELAY_MS;
    await this.state.storage.setAlarm(Date.now() + lo + Math.random() * (hi - lo));
  }

  async alarm(): Promise<void> {
    await this.loaded;
    const npc = npcToActNext(this.room);
    if (!npc || !this.room.game) return;
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
      // An NPC failing to move should never wedge the room — log and let the next
      // scheduled check (if any) retry rather than throwing out of alarm().
      this.room.chat.push({ id: crypto.randomUUID(), system: true, text: `(${npc.id} hesitated: ${String(err)})`, ts: Date.now() });
      await this.persist();
      this.broadcast();
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.loaded;
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ws')) return this.handleWebSocketUpgrade(request);
    if (url.pathname.endsWith('/action')) return this.handleRpcAction(request);
    if (url.pathname.endsWith('/state')) return this.handleGetState(request);
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
    if (wasEmpty) await registerRoom(this.env.ROOM_REGISTRY, this.roomIdGuess(), playerId);
    return new Response(null, { status: 101, webSocket: client });
  }

  private roomIdGuess(): string {
    // Best-effort label for the registry; the DO doesn't otherwise know its own name.
    return this.state.id.toString();
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
    const player = this.room.players.find((p) => p.id === playerId);
    if (!player) return;
    if (this.room.phase === 'lobby') {
      this.room.players = this.room.players.filter((p) => p.id !== playerId);
      this.migrateHostIfNeeded(playerId);
      this.room.chat.push({ id: crypto.randomUUID(), system: true, text: `${player.name} left.`, ts: Date.now() });
    } else {
      player.connected = false;
      this.migrateHostIfNeeded(playerId);
      this.room.chat.push({ id: crypto.randomUUID(), system: true, text: `${player.name} disconnected.`, ts: Date.now() });
    }
    await this.persist();
    this.broadcast();
  }

  async webSocketError(): Promise<void> {
    // Runtime will follow with webSocketClose; nothing additional to do here.
  }

  private migrateHostIfNeeded(departingId: string): void {
    if (this.room.hostId !== departingId) return;
    const next = this.room.players.find((p) => p.connected && !p.isNpc && p.id !== departingId);
    this.room.hostId = next?.id ?? this.room.players.find((p) => !p.isNpc)?.id ?? null;
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
      if (wasEmpty) await registerRoom(this.env.ROOM_REGISTRY, this.roomIdGuess(), playerId);
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
    default: return null;
  }
}
