import * as Engine from '../public/shared/engine.js';

const MAX_PLAYERS = 6;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // WebSocket -> playerId
    this.room = null;
    this.state.blockConcurrencyWhile(async () => {
      this.room = (await this.state.storage.get('room')) || this.freshRoom();
    });
  }

  freshRoom() {
    return {
      phase: 'lobby', // lobby | playing | ended
      players: [], // { id, name, color, connected }
      hostId: null,
      game: null,
      chat: [],
      createdAt: Date.now(),
    };
  }

  async persist() {
    await this.state.storage.put('room', this.room);
  }

  usedColors() {
    return new Set(this.room.players.map((p) => p.color));
  }

  pickColor() {
    const used = this.usedColors();
    return Engine.PLAYER_COLORS.find((c) => !used.has(c)) || Engine.PLAYER_COLORS[this.room.players.length % Engine.PLAYER_COLORS.length];
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ws')) return this.handleWebSocket(request, url);
    return new Response('not found', { status: 404 });
  }

  async handleWebSocket(request, url) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const playerId = url.searchParams.get('playerId');
    const name = (url.searchParams.get('name') || 'Traveler').slice(0, 24);
    if (!playerId) return new Response('missing playerId', { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sessions.set(server, playerId);

    let player = this.room.players.find((p) => p.id === playerId);
    if (!player) {
      if (this.room.players.length >= MAX_PLAYERS) {
        server.send(JSON.stringify({ type: 'error', message: 'Room is full.' }));
        server.close(1000, 'room full');
        return new Response(null, { status: 101, webSocket: client });
      }
      const spectator = this.room.phase !== 'lobby';
      player = { id: playerId, name, color: this.pickColor(), connected: true, spectator };
      this.room.players.push(player);
      if (!this.room.hostId) this.room.hostId = playerId;
      this.pushSystemChat(spectator ? `${name} is watching the game.` : `${name} joined the game.`);
    } else {
      player.connected = true;
      player.name = name || player.name;
      this.pushSystemChat(`${player.name} reconnected.`);
    }
    await this.persist();
    this.broadcast();

    server.addEventListener('message', (ev) => this.onMessage(server, ev).catch((err) => {
      try { server.send(JSON.stringify({ type: 'error', message: String(err.message || err) })); } catch {}
    }));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  pushSystemChat(text) {
    this.room.chat.push({ id: crypto.randomUUID(), system: true, text, ts: Date.now() });
    if (this.room.chat.length > 200) this.room.chat.shift();
  }

  async onClose(ws) {
    const playerId = this.sessions.get(ws);
    this.sessions.delete(ws);
    const player = this.room.players.find((p) => p.id === playerId);
    if (player) {
      const stillConnected = [...this.sessions.values()].includes(playerId);
      if (!stillConnected) {
        player.connected = false;
        this.pushSystemChat(`${player.name} disconnected.`);
      }
    }
    await this.persist();
    this.broadcast();
  }

  currentPlayerId() {
    if (!this.room.game) return null;
    return this.room.game.players[this.room.game.currentPlayer]?.id;
  }

  async onMessage(ws, ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const playerId = this.sessions.get(ws);
    const player = this.room.players.find((p) => p.id === playerId);
    if (!player) return;

    switch (msg.type) {
      case 'set_name': {
        if (typeof msg.name === 'string' && msg.name.trim()) player.name = msg.name.trim().slice(0, 24);
        break;
      }
      case 'set_color': {
        if (this.room.phase !== 'lobby') break;
        if (typeof msg.color === 'string' && Engine.PLAYER_COLORS.includes(msg.color) && !this.usedColors().has(msg.color)) {
          player.color = msg.color;
        }
        break;
      }
      case 'start': {
        if (this.room.phase !== 'lobby') break;
        if (playerId !== this.room.hostId) break;
        if (this.room.players.length < 2) break;
        const seed = Date.now() ^ Math.floor(Math.random() * 1e9);
        const rng = mulberry32(seed);
        this.room.game = Engine.createGame(this.room.players.map((p) => ({ id: p.id, name: p.name, color: p.color })), rng);
        this.room.phase = 'playing';
        this.pushSystemChat('The game has begun. Good luck!');
        break;
      }
      case 'place_tile': {
        if (this.room.phase !== 'playing' || !this.room.game) break;
        if (playerId !== this.currentPlayerId()) break;
        Engine.placeTile(this.room.game, msg.x, msg.y, msg.rot);
        break;
      }
      case 'place_meeple': {
        if (this.room.phase !== 'playing' || !this.room.game) break;
        if (playerId !== this.currentPlayerId()) break;
        Engine.placeMeeple(this.room.game, msg.kind, msg.idx);
        if (this.room.game.phase === 'gameover') { this.room.phase = 'ended'; this.pushSystemChat('The game has ended! Final scores are in.'); }
        break;
      }
      case 'skip_meeple': {
        if (this.room.phase !== 'playing' || !this.room.game) break;
        if (playerId !== this.currentPlayerId()) break;
        Engine.skipMeeple(this.room.game);
        if (this.room.game.phase === 'gameover') { this.room.phase = 'ended'; this.pushSystemChat('The game has ended! Final scores are in.'); }
        break;
      }
      case 'new_game': {
        if (playerId !== this.room.hostId) break;
        if (this.room.phase !== 'ended') break;
        this.room.phase = 'lobby';
        this.room.game = null;
        this.pushSystemChat('Back to the lobby for a new game.');
        break;
      }
      case 'chat': {
        if (typeof msg.text !== 'string' || !msg.text.trim()) break;
        this.room.chat.push({ id: crypto.randomUUID(), playerId, name: player.name, color: player.color, text: msg.text.trim().slice(0, 300), ts: Date.now() });
        if (this.room.chat.length > 200) this.room.chat.shift();
        break;
      }
      default:
        return;
    }
    await this.persist();
    this.broadcast();
  }

  broadcast() {
    const payload = JSON.stringify({ type: 'sync', room: this.room });
    for (const ws of this.sessions.keys()) {
      try { ws.send(payload); } catch {}
    }
  }
}
