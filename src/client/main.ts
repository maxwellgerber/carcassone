import { TILE_TYPES, rotateGroupSides, rotateSlot } from '../shared/tiles.js';
import { getLegalPlacements, getMeepleOptions, PLAYER_COLORS, QUICK_GAME_TILE_COUNT } from '../shared/engine.js';
import type { RoomDoc } from '../shared/room-types.js';
import type { GameConfig, NpcDifficulty } from '../shared/types.js';
import { getTileCanvas, getTileBackCanvas, getMeepleCanvas, preloadTileArt } from './art.js';
import { h, toast } from './dom.js';

// ---------------------------------------------------------------------------
// Session (identity now comes entirely from the server-verified cookie session —
// the client never invents or stores its own player id).
// ---------------------------------------------------------------------------
interface MeInfo { signedIn: boolean; sub: string | null; name: string | null; devMode: boolean; }
let me: MeInfo = { signedIn: false, sub: null, name: null, devMode: false };

async function refreshMe(): Promise<MeInfo> {
  const res = await fetch('/api/me');
  me = await res.json();
  return me;
}

function randomRoomId(): string {
  const adjectives = ['brave', 'swift', 'golden', 'stone', 'wild', 'noble', 'quiet', 'clever', 'lucky', 'crimson'];
  const animals = ['falcon', 'badger', 'fox', 'heron', 'wolf', 'raven', 'otter', 'stag', 'lynx', 'sparrow'];
  const a = adjectives[Math.random() * adjectives.length | 0];
  const b = animals[Math.random() * animals.length | 0];
  const n = Math.floor(10 + Math.random() * 90);
  return `${a}-${b}-${n}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const root = document.getElementById('app')!;
function navigate(path: string): void { history.pushState({}, '', path); route(); }
window.addEventListener('popstate', route);

function route(): void {
  teardownRoom();
  const m = location.pathname.match(/^\/r\/([a-z0-9-]+)\/?$/i);
  if (location.pathname === '/welcome') { void mountWelcome(); return; }
  if (m) { void mountRoom(m[1]!.toLowerCase()); return; }
  void mountHome();
}

// ---------------------------------------------------------------------------
// Landing / home
// ---------------------------------------------------------------------------
function bannerCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const w = 420, hgt = 150; c.width = w; c.height = hgt;
  const ctx = c.getContext('2d')!;
  const size = 96;
  const tiles = [
    { key: 'city_cap_road_curve_a', rot: 1 },
    { key: 'monastery_road', rot: 0 },
    { key: 'road_fork', rot: 0 },
    { key: 'city_four_shield', rot: 0 },
  ];
  tiles.forEach((t, i) => {
    const tc = getTileCanvas(t.key, t.rot, size);
    const x = i * (size + 6) + 8, y = (hgt - size) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.translate(x + size / 2, y + size / 2);
    ctx.rotate((i - 1.5) * 0.05);
    ctx.drawImage(tc, -size / 2, -size / 2, size, size);
    ctx.restore();
  });
  const mc = getMeepleCanvas(PLAYER_COLORS[0]!, 44, false);
  ctx.drawImage(mc, w - 60, hgt / 2 - 44, 44, 44);
  return c;
}

async function mountHome(): Promise<void> {
  root.innerHTML = '';
  root.appendChild(h('div', { class: 'home' }, h('p', {}, 'Loading…')));
  await refreshMe();
  root.innerHTML = '';

  const authArea = me.signedIn
    ? h('div', { class: 'home-actions' },
        h('div', { class: 'home-card panel' },
          h('h3', {}, '🏰 Start a game'),
          h('p', {}, 'Create a fresh table and send the link to your friends.'),
          h('button', { class: 'primary', onclick: () => navigate(`/r/${randomRoomId()}`) }, 'Create game'),
        ),
        h('div', { class: 'home-card panel' },
          h('h3', {}, '🧭 Join a game'),
          h('p', {}, 'Got a link or a room code from a friend? Hop in.'),
          (() => {
            const input = h('input', { type: 'text', placeholder: 'e.g. brave-falcon-42' }) as HTMLInputElement;
            const go = () => { const v = input.value.trim().toLowerCase().replace(/^\/?r\//, ''); if (v) navigate(`/r/${v}`); };
            input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go(); });
            return h('div', { class: 'join-row' }, input, h('button', { onclick: go }, 'Join'));
          })(),
        ),
      )
    : h('div', { class: 'home-actions' },
        h('div', { class: 'home-card panel', style: 'align-items:center;text-align:center' },
          h('h3', {}, '⚔️ Ready to play?'),
          h('p', {}, 'Sign in to create or join a table. It takes a few seconds.'),
          h('button', { class: 'primary', onclick: () => { window.location.href = '/auth/login'; } }, me.devMode ? 'Continue (dev mode)' : 'Sign in to play'),
        ),
      );

  const footer = me.signedIn
    ? h('p', { class: 'home-footer' }, `Signed in as ${me.name}. `, h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); window.location.href = '/auth/logout'; } }, 'Sign out'), '.')
    : h('p', { class: 'home-footer' }, me.devMode ? 'Running in local dev mode — no real identity provider configured.' : 'No spam, no passwords stored by us — sign-in is handled by your identity provider.');

  root.appendChild(h('div', { class: 'home' },
    h('div', { class: 'home-banner' }, bannerCanvas()),
    h('h1', { class: 'home-title display' }, 'Carcassonne'),
    h('p', { class: 'home-subtitle' }, 'Draw a tile, extend the land, place your meeple, and race your friends — or a table of NPCs — to claim the roads, cities, and cloisters of the countryside.'),
    authArea,
    footer,
  ));
}

async function mountWelcome(): Promise<void> {
  root.innerHTML = '';
  await refreshMe();
  root.innerHTML = '';
  const next = new URLSearchParams(location.search).get('next') || '/';
  root.appendChild(h('div', { class: 'home' },
    h('h1', { class: 'home-title display' }, 'Welcome!'),
    h('p', { class: 'home-subtitle' }, "What should we call you at the table? You can change this later from the lobby."),
    h('form', { class: 'home-card panel', method: 'POST', action: '/auth/set-name', style: 'align-items:stretch;gap:1rem' },
      h('input', { type: 'hidden', name: 'next', value: next }),
      h('input', { type: 'text', name: 'name', placeholder: 'Your name', maxlength: 24, required: true, autofocus: true }),
      h('button', { class: 'primary', type: 'submit' }, "Let's play"),
    ),
  ));
}

// ---------------------------------------------------------------------------
// Room (lobby + game)
// ---------------------------------------------------------------------------
let socket: WebSocket | null = null;
let room: RoomDoc | null = null;
let connStatus: 'connecting' | 'connected' | 'disconnected' | 'unauthorized' = 'connecting';
let currentRoomId: string | null = null;
let previewRot = 0;

function teardownRoom(): void {
  if (socket) { try { socket.close(); } catch { /* ignore */ } socket = null; }
  room = null; currentRoomId = null; connStatus = 'connecting';
  boardCanvasEl = null; boardWrapEl = null; hovered = null;
  userAdjustedCamera = false;
  particles = [];
}

async function mountRoom(roomId: string): Promise<void> {
  await refreshMe();
  if (!me.signedIn) { window.location.href = `/auth/login?next=${encodeURIComponent(location.pathname)}`; return; }
  currentRoomId = roomId;
  connectSocket(roomId);
  renderRoom();
}

function connectSocket(roomId: string): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/api/room/${roomId}/ws`;
  connStatus = 'connecting';
  socket = new WebSocket(url);
  socket.addEventListener('open', () => { connStatus = 'connected'; renderRoom(); });
  socket.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data as string);
    if (msg.type === 'sync') {
      const prevTile = room?.game?.currentTile;
      room = msg.room as RoomDoc;
      if (room.game && room.game.currentTile !== prevTile) previewRot = 0;
      renderRoom();
    } else if (msg.type === 'error') {
      toast(msg.message);
    }
  });
  socket.addEventListener('close', (ev) => {
    connStatus = ev.code === 4001 ? 'unauthorized' : 'disconnected';
    renderRoom();
    if (connStatus !== 'unauthorized') setTimeout(() => { if (currentRoomId === roomId) connectSocket(roomId); }, 1500);
  });
}

function send(obj: Record<string, unknown>): void { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj)); }

function renderRoom(): void {
  root.innerHTML = '';
  if (connStatus !== 'connected' || !room) {
    root.appendChild(h('div', { class: 'home' },
      h('h2', {}, connStatus === 'disconnected' ? 'Reconnecting…' : connStatus === 'unauthorized' ? 'Sign-in required' : 'Joining the table…'),
      h('p', { class: 'home-subtitle' }, `Room "${currentRoomId}"`),
    ));
    return;
  }
  if (room.phase === 'lobby') root.appendChild(renderLobby());
  else root.appendChild(renderGame());
  paintMeepleSwatches(root);
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
function renderLobby(): HTMLElement {
  const r = room!;
  const isHost = r.hostId === me.sub;
  const link = `${location.origin}/r/${currentRoomId}`;

  const playerList = h('div', { class: 'player-list panel' },
    h('h2', {}, `Players (${r.players.length}/6)`),
    ...r.players.map((p) => h('div', { class: 'player-row' },
      h('canvas', { class: 'meeple-swatch', width: 22, height: 22, 'data-color': p.color }),
      p.id === me.sub
        ? h('input', { class: 'name-edit', type: 'text', value: p.name, maxlength: 24, onchange: (e: Event) => send({ type: 'set_name', name: (e.target as HTMLInputElement).value }) })
        : h('span', { style: 'flex:1' }, p.name + (p.isNpc ? ` (NPC · ${p.npcDifficulty})` : '')),
      p.id === r.hostId ? h('span', { class: 'host-badge' }, 'HOST') : null,
      p.id === me.sub ? h('span', { class: 'you-badge' }, 'YOU') : null,
      !p.connected && !p.isNpc ? h('span', { class: 'offline-dot', title: 'offline' }, '●') : null,
      isHost && p.isNpc ? h('button', { class: 'ghost small', onclick: () => send({ type: 'remove_npc', npcId: p.id }) }, '✕') : null,
    )),
    r.players.length < 2 ? h('p', { style: 'color:var(--ink-soft);font-size:0.85rem' }, 'Waiting for at least one more player… or add an NPC below.') : null,
  );

  const usedColors = new Set(r.players.filter((p) => p.id !== me.sub).map((p) => p.color));
  const meColor = r.players.find((p) => p.id === me.sub)?.color;
  const colorPicker = h('div', { class: 'panel' },
    h('h2', { style: 'padding:1rem 1.2rem 0' }, 'Your colour'),
    h('div', { class: 'color-swatches' }, ...PLAYER_COLORS.map((c) => h('div', {
      class: `color-dot${meColor === c ? ' selected' : ''}${usedColors.has(c) ? ' taken' : ''}`,
      style: `background:${c}`,
      onclick: () => { if (!usedColors.has(c)) send({ type: 'set_color', color: c }); },
      title: usedColors.has(c) ? 'taken' : 'pick this colour',
    }))),
  );

  const npcPanel = isHost ? h('div', { class: 'panel', style: 'padding:1rem 1.2rem' },
    h('h2', { style: 'font-size:1rem' }, '🤖 Fill a seat with an NPC'),
    h('p', { style: 'color:var(--ink-soft);font-size:0.85rem;margin:0 0 0.6rem' }, "No friends online, or don't want to hand your agent connection to a full table? Add a computer opponent."),
    h('div', { style: 'display:flex;gap:0.5rem;flex-wrap:wrap' },
      ...(['easy', 'normal', 'hard'] as NpcDifficulty[]).map((d) =>
        h('button', { class: 'small', onclick: () => send({ type: 'add_npc', difficulty: d }) }, `+ ${d[0]!.toUpperCase()}${d.slice(1)} NPC`)),
    ),
  ) : null;

  const modesPanel = h('div', { class: 'panel', style: 'padding:1rem 1.2rem' },
    h('h2', { style: 'font-size:1rem' }, '⚙️ Game modes'),
    ...configToggle(r, isHost, 'farmScoring', 'Farm scoring', 'Farmers score points for completed cities at the end of the game. Turn off for a shorter, simpler game.'),
    ...configToggle(r, isHost, 'monasteryScoring', 'Cloisters', 'Include cloister tiles and monk scoring.'),
    ...configToggle(r, isHost, 'shieldBonus', 'Shield bonus', 'Cities with a shield score +2 extra points when they close (+1 if unfinished at game end).'),
    ...configToggle(r, isHost, 'quickGame', 'Quick game', `Play with a ~${QUICK_GAME_TILE_COUNT}-tile deck instead of the full 72, for a shorter game.`),
    h('label', { style: 'display:flex;gap:0.6rem;align-items:center;margin-top:0.3rem' },
      h('span', {}, h('strong', {}, 'Meeples per player')),
      h('select', {
        disabled: !isHost,
        onchange: (e: Event) => send({ type: 'set_config', config: { meeplesPerPlayer: Number((e.target as HTMLSelectElement).value) } }),
      }, ...[5, 6, 7, 8, 9].map((n) => h('option', { value: n, selected: r.config.meeplesPerPlayer === n }, String(n)))),
    ),
  );

  const rules = h('div', { class: 'rules-card panel' },
    h('h3', {}, 'How to play'),
    h('p', {}, 'On your turn, place the drawn tile so its edges match its neighbours, then optionally place one meeple: a ', h('b', {}, 'knight'), ' in a city, a ', h('b', {}, 'highwayman'), ' on a road, a ', h('b', {}, 'monk'), ' in a cloister, or a ', h('b', {}, 'farmer'), ' in a field.'),
    h('p', {}, 'Completed cities score 2 pts/tile (+2 per shield), roads 1 pt/tile, cloisters 9 pts. Unclaimed farms score 3 pts per completed city they touch — tallied at the very end.'),
  );

  return h('div', { class: 'lobby' },
    h('div', { class: 'lobby-header' },
      h('h1', {}, 'The Table Is Set'),
      h('div', { class: 'room-code-row' },
        h('span', { class: 'room-code' }, currentRoomId!),
        h('button', { class: 'small', onclick: () => { navigator.clipboard?.writeText(link); toast('Link copied!'); } }, '🔗 Copy invite link'),
      ),
    ),
    h('div', { class: 'lobby-body' },
      playerList,
      h('div', { class: 'lobby-side' },
        colorPicker,
        npcPanel,
        modesPanel,
        rules,
        isHost
          ? h('button', { class: 'primary', disabled: r.players.length < 2, onclick: () => send({ type: 'start' }) }, r.players.length < 2 ? 'Need 2+ players' : `Start game (${r.players.length} players)`)
          : h('p', { style: 'text-align:center;color:var(--ink-soft)' }, 'Waiting for the host to start the game…'),
      ),
    ),
  );
}

function configToggle(r: RoomDoc, isHost: boolean, key: keyof GameConfig, label: string, desc: string): HTMLElement[] {
  const checked = !!r.config[key];
  return [h('label', { style: 'display:flex;gap:0.6rem;align-items:flex-start;margin-bottom:0.7rem;cursor:' + (isHost ? 'pointer' : 'default') },
    h('input', {
      type: 'checkbox', checked, disabled: !isHost,
      onchange: (e: Event) => send({ type: 'set_config', config: { [key]: (e.target as HTMLInputElement).checked } }),
    }),
    h('span', {}, h('strong', {}, label), h('br', {}), h('span', { style: 'color:var(--ink-soft);font-size:0.82rem' }, desc)),
  )];
}

function paintMeepleSwatches(container: HTMLElement): void {
  container.querySelectorAll<HTMLCanvasElement>('canvas.meeple-swatch[data-color]').forEach((cv) => {
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(getMeepleCanvas(cv.getAttribute('data-color')!, cv.width, false), 0, 0);
  });
}

// ---------------------------------------------------------------------------
// Game view
// ---------------------------------------------------------------------------
const TILE_ART_SIZE = 128;
let camera = { x: 0.5, y: 0.5, scale: 90 };
let userAdjustedCamera = false;
let hovered: { x: number; y: number } | null = null;
let boardCanvasEl: HTMLCanvasElement | null = null;
let boardWrapEl: HTMLElement | null = null;
let particles: { x: number; y: number; vx: number; vy: number; color: string; size: number; rot: number; vr: number; life: number }[] = [];
let windowListenersAttached = false;
let dragState: { x: number; y: number; cx: number; cy: number } | null = null;
let dragMovedFar = false;

function boardBounds(board: RoomDoc['game'] extends null ? never : NonNullable<RoomDoc['game']>['board']) {
  const keys = Object.keys(board);
  if (keys.length === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of keys) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function fitCamera(canvasW: number, canvasH: number): void {
  if (!room?.game) return;
  const b = boardBounds(room.game.board);
  const w = b.maxX - b.minX + 3, hh = b.maxY - b.minY + 3;
  const scale = Math.max(30, Math.min(140, Math.min(canvasW / w, canvasH / hh)));
  camera = { x: (b.minX + b.maxX + 1) / 2, y: (b.minY + b.maxY + 1) / 2, scale };
}

function worldToScreen(wx: number, wy: number, cw: number, ch: number): [number, number] {
  return [cw / 2 + (wx - camera.x) * camera.scale, ch / 2 + (wy - camera.y) * camera.scale];
}
function screenToWorld(sx: number, sy: number, cw: number, ch: number): [number, number] {
  return [(sx - cw / 2) / camera.scale + camera.x, (sy - ch / 2) / camera.scale + camera.y];
}

function meepleAnchor(tileKey: string, rot: number, kind: string, idx: number): [number, number] {
  const t = TILE_TYPES[tileKey]!;
  const MID: Record<number, [number, number]> = { 0: [0.5, 0.06], 1: [0.94, 0.5], 2: [0.5, 0.94], 3: [0.06, 0.5] };
  const SLOT_POS: [number, number][] = [[0.3, 0.08], [0.7, 0.08], [0.92, 0.3], [0.92, 0.7], [0.7, 0.92], [0.3, 0.92], [0.08, 0.7], [0.08, 0.3]];
  if (kind === 'monastery') return [0.5, 0.78];
  if (kind === 'city') {
    const abs = rotateGroupSides(t.cityGroups[idx]!, rot);
    const pts = abs.map((s) => MID[s]!);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return [cx + (0.5 - cx) * 0.45, cy + (0.5 - cy) * 0.45];
  }
  if (kind === 'road') {
    const abs = rotateGroupSides(t.roadGroups[idx]!, rot);
    if (abs.length === 2) { const a = MID[abs[0]!]!, b = MID[abs[1]!]!; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    const a = MID[abs[0]!]!; return [a[0] + (0.5 - a[0]) * 0.6, a[1] + (0.5 - a[1]) * 0.6];
  }
  if (kind === 'farm') {
    const slots = t.fieldRegions[idx]!.slots.map((s) => rotateSlot(s, rot));
    const pts = slots.map((s) => SLOT_POS[s]!);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return [cx, cy];
  }
  return [0.5, 0.5];
}

function isMyTurn(): boolean {
  if (!room?.game || room.game.phase === 'gameover') return false;
  return room.game.players[room.game.currentPlayer]?.id === me.sub;
}

function resizeBoardCanvas(canvas: HTMLCanvasElement, wrap: HTMLElement): { w: number; h: number } {
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(200, rect.width * dpr);
  canvas.height = Math.max(200, rect.height * dpr);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: rect.width, h: rect.height };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBoard(canvas: HTMLCanvasElement): void {
  if (!room?.game) return;
  const ctx = canvas.getContext('2d')!;
  const rect = canvas.getBoundingClientRect();
  const cw = rect.width, ch = rect.height;
  ctx.clearRect(0, 0, cw, ch);
  const g = ctx.createLinearGradient(0, 0, 0, ch);
  g.addColorStop(0, '#5F7A6E'); g.addColorStop(1, '#3E534A');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);

  const game = room.game;
  const board = game.board;
  const myTurn = isMyTurn();
  const legal = (myTurn && game.phase === 'placeTile') ? getLegalPlacements(game) : [];
  const legalByCell = new Map<string, number[]>();
  for (const l of legal) { const k = `${l.x},${l.y}`; if (!legalByCell.has(k)) legalByCell.set(k, []); legalByCell.get(k)!.push(l.rot); }

  ctx.save();
  for (const [k] of legalByCell) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    const [sx, sy] = worldToScreen(x, y, cw, ch);
    const s = camera.scale;
    ctx.fillStyle = 'rgba(212, 184, 90, 0.28)';
    ctx.strokeStyle = 'rgba(154, 140, 62, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    roundRect(ctx, sx + 2, sy + 2, s - 4, s - 4, 6);
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  for (const k of Object.keys(board)) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    const { tileKey, rot } = board[k]!;
    const [sx, sy] = worldToScreen(x, y, cw, ch);
    const s = camera.scale;
    ctx.drawImage(getTileCanvas(tileKey, rot, TILE_ART_SIZE), sx, sy, s, s);
    if (game.lastPlaced && game.lastPlaced.x === x && game.lastPlaced.y === y) {
      ctx.save();
      ctx.strokeStyle = 'rgba(212,184,90,0.95)';
      ctx.lineWidth = 3;
      roundRect(ctx, sx + 2, sy + 2, s - 4, s - 4, 6);
      ctx.stroke();
      ctx.restore();
    }
  }

  for (const m of game.meeples) {
    const tile = board[`${m.x},${m.y}`];
    if (!tile) continue;
    const [ax, ay] = meepleAnchor(tile.tileKey, tile.rot, m.kind, m.idx);
    const [sx, sy] = worldToScreen(m.x + ax, m.y + ay, cw, ch);
    const size = camera.scale * 0.34;
    const player = game.players[m.playerIdx]!;
    ctx.drawImage(getMeepleCanvas(player.color, size, m.kind === 'farm'), sx - size / 2, sy - size / 2, size, size);
  }

  if (myTurn && game.phase === 'placeTile' && hovered && game.currentTile) {
    const k = `${hovered.x},${hovered.y}`;
    const rots = legalByCell.get(k);
    const [sx, sy] = worldToScreen(hovered.x, hovered.y, cw, ch);
    const s = camera.scale;
    const rotOk = !!rots && rots.includes(((previewRot % 4) + 4) % 4);
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.drawImage(getTileCanvas(game.currentTile, ((previewRot % 4) + 4) % 4, TILE_ART_SIZE), sx, sy, s, s);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rotOk ? 'rgba(63,203,184,0.9)' : 'rgba(190,50,50,0.85)';
    ctx.lineWidth = 3;
    roundRect(ctx, sx + 2, sy + 2, s - 4, s - 4, 6);
    ctx.stroke();
    ctx.restore();
  }

  drawParticles(ctx, cw, ch);
}

function spawnConfetti(cw: number, _ch: number): void {
  for (let i = 0; i < 140; i++) {
    particles.push({
      x: Math.random() * cw, y: -20 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length]!, size: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, life: 260 + Math.random() * 120,
    });
  }
}
function drawParticles(ctx: CanvasRenderingContext2D, cw: number, ch: number): void {
  if (!particles.length) return;
  particles.forEach((p) => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.rot += p.vr; p.life--;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  });
  particles = particles.filter((p) => p.life > 0 && p.y < ch + 40);
  if (particles.length) requestAnimationFrame(() => { if (boardCanvasEl) drawBoard(boardCanvasEl); });
}

function renderGame(): HTMLElement {
  const game = room!.game!;
  const meP = game.players.find((p) => p.id === me.sub) ?? null;
  const myTurn = isMyTurn();

  const wrap = h('div', { class: 'board-wrap' });
  const canvas = h('canvas', {}) as HTMLCanvasElement;
  boardCanvasEl = canvas;
  boardWrapEl = wrap;
  wrap.appendChild(canvas);
  if (myTurn && game.phase === 'placeTile') {
    wrap.appendChild(h('div', { class: 'board-hint' }, 'Click a glowing tile to place • drag to pan • scroll to zoom • R to rotate'));
  }
  wrap.appendChild(h('div', { class: 'board-controls' },
    h('button', { class: 'small icon-btn', onclick: () => { userAdjustedCamera = false; redraw(); } }, '🎯 Recenter'),
  ));

  const redraw = () => {
    if (!boardWrapEl || !boardCanvasEl) return;
    const dims = resizeBoardCanvas(boardCanvasEl, boardWrapEl);
    if (!userAdjustedCamera) fitCamera(dims.w, dims.h);
    drawBoard(boardCanvasEl);
  };

  canvas.addEventListener('mousedown', (e) => { dragState = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y }; dragMovedFar = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    userAdjustedCamera = true;
    const rect = boardCanvasEl!.getBoundingClientRect();
    const before = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    camera.scale = Math.max(28, Math.min(220, camera.scale * (e.deltaY > 0 ? 0.9 : 1.1)));
    const after = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    camera.x += before[0] - after[0]; camera.y += before[1] - after[1];
    drawBoard(boardCanvasEl!);
  }, { passive: false });

  if (!windowListenersAttached) {
    windowListenersAttached = true;
    window.addEventListener('mousemove', (e) => {
      if (!boardCanvasEl || !room) return;
      const rect = boardCanvasEl.getBoundingClientRect();
      if (dragState) {
        const dx = e.clientX - dragState.x, dy = e.clientY - dragState.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) { dragMovedFar = true; userAdjustedCamera = true; }
        camera.x = dragState.cx - dx / camera.scale;
        camera.y = dragState.cy - dy / camera.scale;
        drawBoard(boardCanvasEl);
      }
      const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      hovered = { x: Math.floor(wx), y: Math.floor(wy) };
      if (!dragState) drawBoard(boardCanvasEl);
    });
    window.addEventListener('mouseup', (e) => {
      if (dragState && !dragMovedFar && boardCanvasEl) handleBoardClick(e, boardCanvasEl);
      dragState = null;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'r' && boardCanvasEl && room?.game && isMyTurn() && room.game.phase === 'placeTile') { previewRot = (previewRot + 1) % 4; drawBoard(boardCanvasEl); }
    });
    window.addEventListener('resize', () => redraw());
  }

  function handleBoardClick(e: MouseEvent, canvasEl: HTMLCanvasElement): void {
    if (!room?.game || !isMyTurn() || room.game.phase !== 'placeTile') return;
    const rect = canvasEl.getBoundingClientRect();
    const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    const gx = Math.floor(wx), gy = Math.floor(wy);
    const legal = getLegalPlacements(room.game).filter((p) => p.x === gx && p.y === gy);
    if (legal.length === 0) return;
    const pr = ((previewRot % 4) + 4) % 4;
    const chosen = legal.find((p) => p.rot === pr) ?? legal[0]!;
    previewRot = chosen.rot;
    send({ type: 'place_tile', x: gx, y: gy, rot: chosen.rot });
  }

  requestAnimationFrame(() => redraw());

  const sidebar = buildSidebar(game, meP, myTurn);
  const container = h('div', { class: 'game' }, wrap, sidebar);
  if (room!.phase === 'ended') container.appendChild(renderEndModal(game));
  return container;
}

function buildSidebar(game: NonNullable<RoomDoc['game']>, meP: NonNullable<RoomDoc['game']>['players'][number] | null, myTurn: boolean): HTMLElement {
  const turnBanner = h('div', { class: `turn-banner${myTurn ? ' mine' : ''}` },
    game.phase === 'gameover'
      ? h('span', {}, 'The game has ended.')
      : myTurn
        ? h('span', {}, game.phase === 'placeTile' ? h('strong', {}, 'Your turn — place a tile') : h('strong', {}, 'Your turn — place a meeple or skip'))
        : h('span', {}, `Waiting for `, h('strong', {}, game.players[game.currentPlayer]?.name ?? '…')),
  );

  const tilePreview = h('div', { class: 'tile-preview-row' },
    (() => {
      const cv = h('canvas', { width: 72, height: 72, style: 'cursor:pointer' }) as HTMLCanvasElement;
      const paint = () => {
        const ctx = cv.getContext('2d')!;
        ctx.clearRect(0, 0, 72, 72);
        if (game.currentTile) ctx.drawImage(getTileCanvas(game.currentTile, ((previewRot % 4) + 4) % 4, 128), 0, 0, 72, 72);
        else ctx.drawImage(getTileBackCanvas(128), 0, 0, 72, 72);
      };
      paint();
      cv.addEventListener('click', () => { if (myTurn && game.phase === 'placeTile') { previewRot = (previewRot + 1) % 4; paint(); if (boardCanvasEl) drawBoard(boardCanvasEl); } });
      return cv;
    })(),
    h('div', {},
      h('div', {}, `${game.deck.length} tile${game.deck.length === 1 ? '' : 's'} left in the pile`),
      myTurn && game.phase === 'placeTile' ? h('button', { class: 'small', onclick: () => { previewRot = (previewRot + 1) % 4; if (boardCanvasEl) drawBoard(boardCanvasEl); } }, '↻ Rotate (R)') : null,
    ),
  );

  const meepleBox = (myTurn && game.phase === 'placeMeeple' && meP)
    ? h('div', { class: 'meeple-menu panel', style: 'padding:0.8rem' },
        h('h2', { style: 'font-size:0.95rem' }, 'Place a meeple?'),
        ...getMeepleOptions(game).map((o) => h('button', { class: 'meeple-choice', onclick: () => send({ type: 'place_meeple', kind: o.kind, idx: o.idx }) },
          meepleIconCanvas(meP.color, o.kind),
          h('span', {}, meepleLabel(o.kind)),
        )),
        h('button', { class: 'ghost small', onclick: () => send({ type: 'skip_meeple' }) }, 'Skip — place no meeple'),
      )
    : null;

  const scoreboard = h('div', { class: 'panel', style: 'padding:0.8rem' },
    h('h2', { style: 'font-size:0.95rem' }, 'Scoreboard'),
    h('div', { class: 'scoreboard' }, ...game.players.map((p, i) => {
      const roomPlayer = room!.players.find((rp) => rp.id === p.id);
      const offline = roomPlayer && !roomPlayer.connected && !p.isNpc;
      return h('div', { class: `score-row${i === game.currentPlayer && game.phase !== 'gameover' ? ' active' : ''}` },
      h('canvas', { class: 'meeple-swatch', width: 18, height: 18, 'data-color': p.color }),
      h('span', { class: 'sname' }, p.name + (p.id === me.sub ? ' (you)' : p.isNpc ? ' 🤖' : '')),
      offline ? h('span', { class: 'offline-dot', title: 'disconnected' }, '●') : null,
      h('span', { class: 'smeeples' }, '●'.repeat(p.meeples) + '○'.repeat(Math.max(0, game.config.meeplesPerPlayer - p.meeples))),
      h('span', { class: 'spoints' }, String(p.score)),
      );
    })),
  );

  const log = h('div', { class: 'panel', style: 'padding:0.8rem;display:flex;flex-direction:column;min-height:0;flex:1' },
    h('h2', { style: 'font-size:0.95rem' }, 'Chronicle'),
    h('div', { class: 'log-panel' }, ...game.log.slice(0, 40).map((l) => h('div', { class: 'log-entry' }, l))),
  );

  const chat = h('div', { class: 'panel chat-panel', style: 'padding:0.8rem' },
    h('h2', { style: 'font-size:0.95rem' }, 'Table talk'),
    h('div', { class: 'chat-log', id: 'chatlog' }, ...room!.chat.slice(-60).map((c) => c.system
      ? h('div', { class: 'chat-msg', style: 'opacity:0.65;font-style:italic' }, c.text)
      : h('div', { class: 'chat-msg' }, h('span', { class: 'who', style: `color:${c.color}` }, c.name + ': '), c.text))),
    (() => {
      const input = h('input', { type: 'text', placeholder: 'Say something…', maxlength: 300 }) as HTMLInputElement;
      const go = () => { if (input.value.trim()) { send({ type: 'chat', text: input.value }); input.value = ''; } };
      input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go(); });
      return h('div', { class: 'chat-form' }, input, h('button', { class: 'small', onclick: go }, 'Send'));
    })(),
  );

  const invite = h('button', { class: 'small', onclick: () => { navigator.clipboard?.writeText(location.href); toast('Link copied!'); } }, '🔗 Copy invite link');
  const sidebar = h('div', { class: 'sidebar' }, turnBanner, tilePreview, meepleBox, scoreboard, invite, log, chat);
  queueMicrotask(() => { paintMeepleSwatches(sidebar); const cl = sidebar.querySelector('#chatlog'); if (cl) cl.scrollTop = cl.scrollHeight; });
  return sidebar;
}

function meepleLabel(kind: string): string {
  return { city: 'Knight — claim the city', road: 'Highwayman — claim the road', monastery: 'Monk — claim the cloister', farm: 'Farmer — claim the field' }[kind] ?? kind;
}
function meepleIconCanvas(color: string, kind: string): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = 24; cv.height = 24;
  cv.getContext('2d')!.drawImage(getMeepleCanvas(color, 24, kind === 'farm'), 0, 0);
  return cv;
}

let lastEndedShown = false;
function renderEndModal(game: NonNullable<RoomDoc['game']>): HTMLElement {
  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  const top = sorted[0]!.score;
  if (!lastEndedShown) {
    lastEndedShown = true;
    if (boardCanvasEl) { const r = boardCanvasEl.getBoundingClientRect(); spawnConfetti(r.width, r.height); drawBoard(boardCanvasEl); }
  }
  const isHost = room!.hostId === me.sub;
  return h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal' },
      h('h2', {}, '🏆 Final Scores'),
      h('div', { class: 'final-scores' }, ...sorted.map((p) => h('div', { class: `final-row${p.score === top ? ' winner' : ''}` },
        p.score === top ? h('span', { class: 'crown' }, '👑') : null,
        h('canvas', { class: 'meeple-swatch', width: 20, height: 20, 'data-color': p.color }),
        h('span', { style: 'flex:1' }, p.name),
        h('span', { style: 'font-family:"Space Grotesk",sans-serif;font-weight:700' }, String(p.score)),
      ))),
      isHost ? h('button', { class: 'primary', onclick: () => { lastEndedShown = false; send({ type: 'new_game' }); } }, 'Play again')
             : h('p', { style: 'color:var(--ink-soft)' }, 'Waiting for the host to start a new game…'),
      h('button', { class: 'ghost small', onclick: () => { navigator.clipboard?.writeText(location.href); toast('Link copied!'); } }, 'Copy invite link'),
    ),
  );
}

// Tile art is decoded from inline SVG data: URIs before the very first render —
// this is well under a frame for 22 small images, and it means drawBoard() (which
// runs synchronously off mouse events) never has to handle a not-yet-loaded image.
preloadTileArt()
  .catch((err) => { console.error('Tile art failed to preload:', err); })
  .then(() => route());
