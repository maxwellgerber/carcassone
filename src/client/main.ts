import { TILE_TYPES, rotateGroupSides, rotateSlot } from '../shared/tiles.js';
import { getLegalPlacements, getMeepleOptions, placeMeeple, placeTile, skipMeeple, PLAYER_COLORS, QUICK_GAME_TILE_COUNT } from '../shared/engine.js';
import type { RoomDoc } from '../shared/room-types.js';
import type { GameConfig, MeepleKind, NpcDifficulty } from '../shared/types.js';
import { getTileCanvas, getTileCanvasIn, getTileBackCanvas, getMeepleCanvas, preloadTileArt, type MeepleLook } from './art.js';
import { h, toast } from './dom.js';
import { SKINS, currentSkin, setSkin, onSkinChange, applySkinToDocument } from './skins/index.js';
import { monasteryCenter } from './skins/geometry.js';
import {
  unlockAudio, isMusicOn, isSfxOn, setMusic, setSfx,
  sfxTilePlaced, sfxMeeplePlaced, sfxScore, sfxYourTurn, sfxGameOver,
} from './audio.js';

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
      const prev = room;
      room = msg.room as RoomDoc;
      if (room.game && (room.game.currentTile !== prev?.game?.currentTile || room.game.turnNumber !== prev?.game?.turnNumber)) { previewRot = 0; pending = null; }
      if (room.phase === 'lobby' || (prev?.phase !== 'playing' && room.phase === 'playing')) { walkCache.clear(); endModalDismissed = false; }
      reactToSync(prev, room);
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

/** Everything that should happen *because the world changed* (sounds, toasts) is
 *  derived here by diffing the previous room document against the new one — the
 *  server never sends events, only state, so this is the one place that notices
 *  "a tile landed", "someone scored", "it's your turn now". */
let awaitingMeepleDecision = false; // set when we place a tile, cleared on the next sync
function reactToSync(prev: RoomDoc | null, next: RoomDoc): void {
  const g = next.game, pg = prev?.game ?? null;
  const justPlacedTile = awaitingMeepleDecision;
  awaitingMeepleDecision = false;
  if (!g) return;
  const sameGame = !!pg && prev!.phase !== 'lobby';
  if (!sameGame) return;

  if (Object.keys(g.board).length > Object.keys(pg!.board).length) sfxTilePlaced();
  if (g.meeples.length > pg!.meeples.length) sfxMeeplePlaced();

  let biggest = 0, mine = false;
  g.players.forEach((p, i) => {
    const gained = p.score - (pg!.players[i]?.score ?? 0);
    if (gained > biggest) { biggest = gained; mine = p.id === me.sub; }
  });
  if (biggest > 0) sfxScore(biggest, mine);

  if (next.phase === 'ended' && prev!.phase !== 'ended') sfxGameOver();
  else if (g.phase !== 'gameover' && isMyTurn() && !(pg!.players[pg!.currentPlayer]?.id === me.sub && pg!.phase !== 'gameover')) sfxYourTurn();

  // We placed a tile and the server moved straight on to the next player: the engine
  // found nothing a meeple could go on. Say so, since the board won't pause to ask.
  if (justPlacedTile && g.phase === 'placeTile' && !isMyTurn() && g.log[0]?.includes('turn passes')) toast(g.log[0]);
}

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
    r.players.length < 2 ? h('p', { style: 'color:var(--ink-soft);font-size:0.85rem' }, isHost ? 'Waiting for at least one more player… or seat an NPC.' : 'Waiting for at least one more player…') : null,
    isHost ? h('div', { class: 'npc-row' },
      h('span', { class: 'npc-row-label' }, '🤖 Seat an NPC'),
      ...(['easy', 'normal', 'hard'] as NpcDifficulty[]).map((d) =>
        h('button', { class: 'small', disabled: r.players.length >= 6, onclick: () => send({ type: 'add_npc', difficulty: d }) }, `+ ${d[0]!.toUpperCase()}${d.slice(1)}`)),
    ) : null,
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


  const modesPanel = h('div', { class: 'panel modes-banner' },
    h('h2', { style: 'font-size:1rem' }, '⚙️ Game modes'),
    h('div', { class: 'modes-grid' },
      ...configToggle(r, isHost, 'farmScoring', 'Fields', 'Farmers claim fields and score 3 points per completed city their field supplies, at the end of the game.'),
      ...configToggle(r, isHost, 'river', 'The River', 'Twelve river tiles are laid first, from the spring to the lake. The river must keep flowing and may not double back.'),
      ...configToggle(r, isHost, 'quickGame', 'Quick game', `A shorter game: about ${QUICK_GAME_TILE_COUNT} regular tiles instead of 72.`),
    ),
  );

  const skinPanel = h('div', { class: 'panel', style: 'padding:1rem 1.2rem' },
    h('h2', { style: 'font-size:1rem' }, '🎨 Pick your look'),
    h('p', { style: 'color:var(--ink-soft);font-size:0.85rem;margin:0 0 0.6rem' }, 'Four tilesets, each with its own palette. Your choice is just for your screen — everyone at the table can pick their own.'),
    h('div', { class: 'skin-grid' }, ...SKINS.map((sk) => {
      const preview = h('canvas', { width: 64, height: 64 }) as HTMLCanvasElement;
      const card = h('button', { class: `skin-card${sk.id === currentSkin().id ? ' selected' : ''}`, title: sk.blurb, onclick: () => setSkin(sk.id) },
        preview, h('span', {}, sk.name));
      queueMicrotask(() => { preview.getContext('2d')!.drawImage(getTileCanvasIn(sk.id, 'city_cap_road_curve_a', 64), 0, 0); });
      return card;
    })),
  );

  const rules = h('div', { class: 'rules-card panel' },
    h('h3', {}, 'How to play'),
    h('p', {}, 'On your turn, place the drawn tile so its edges match its neighbours, then optionally place one meeple by clicking a ghost on that tile: a ', h('b', {}, 'knight'), ' in a city, a ', h('b', {}, 'highwayman'), ' on a road, a ', h('b', {}, 'monk'), ' in a cloister, or a ', h('b', {}, 'farmer'), ' in a field.'),
    h('p', {}, 'Completed cities score 2 pts per tile and 2 per coat of arms, roads 1 pt per tile, cloisters 9 pts. Unfinished features score 1 per tile at the end. Fields score 3 pts per completed city they supply — tallied at the very end.'),
  );

  return h('div', { class: 'lobby' },
    h('div', { class: 'lobby-header' },
      h('h1', {}, 'The Table Is Set'),
      h('div', { class: 'room-code-row' },
        h('span', { class: 'room-code' }, currentRoomId!),
        h('button', { class: 'small', onclick: () => { navigator.clipboard?.writeText(link); toast('Link copied!'); } }, '🔗 Copy invite link'),
      ),
    ),
    modesPanel,
    h('div', { class: 'lobby-body' },
      playerList,
      h('div', { class: 'lobby-side' },
        isHost
          ? h('button', { class: 'primary start-btn', disabled: r.players.length < 2, onclick: () => send({ type: 'start' }) }, r.players.length < 2 ? 'Need 2+ players' : `Start game (${r.players.length} players)`)
          : h('p', { style: 'text-align:center;color:var(--ink-soft)' }, 'Waiting for the host to start the game…'),
        colorPicker,
        skinPanel,
        rules,
      ),
    ),
  );
}

function configToggle(r: RoomDoc, isHost: boolean, key: keyof GameConfig, label: string, desc: string): HTMLElement[] {
  const checked = !!r.config[key];
  return [h('label', { class: 'mode-toggle', style: 'cursor:' + (isHost ? 'pointer' : 'default') },
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
let hoveredGhost: MeepleSpot | null = null;
/** Touch flow: the zone tapped once (shown as a full meeple); a second tap places. */
let selectedGhost: MeepleSpot | null = null;
let ghostAnimFrame: number | null = null;
/** A tile set down but not yet confirmed: the player can still rotate or move it. */
let pending: { x: number; y: number; rot: number } | null = null;
let activePointerId: number | null = null;
const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

function legalRotsAt(x: number, y: number): number[] {
  if (!room?.game) return [];
  return getLegalPlacements(room.game).filter((p) => p.x === x && p.y === y).map((p) => p.rot);
}
function setPending(x: number, y: number): boolean {
  const rots = legalRotsAt(x, y);
  if (!rots.length) return false;
  const pr = ((previewRot % 4) + 4) % 4;
  pending = { x, y, rot: rots.includes(pr) ? pr : rots[0]! };
  previewRot = pending.rot;
  renderPlacementBar();
  if (boardCanvasEl) drawBoard(boardCanvasEl);
  return true;
}
function rotatePending(): void {
  if (!pending) { previewRot = (previewRot + 1) % 4; if (boardCanvasEl) drawBoard(boardCanvasEl); return; }
  const rots = legalRotsAt(pending.x, pending.y);
  if (rots.length <= 1) { toast('Only one way this tile fits here'); return; }
  const i = rots.indexOf(pending.rot);
  pending.rot = rots[(i + 1) % rots.length]!;
  previewRot = pending.rot;
  renderPlacementBar();
  if (boardCanvasEl) drawBoard(boardCanvasEl);
}
function confirmPending(): void {
  if (!pending) return;
  awaitingMeepleDecision = true;
  send({ type: 'place_tile', x: pending.x, y: pending.y, rot: pending.rot });
  pending = null;
  renderPlacementBar();
}
function cancelPending(): void { pending = null; renderPlacementBar(); if (boardCanvasEl) drawBoard(boardCanvasEl); }

/** The bar above the board during tile placement: a hint before the tile is set
 *  down, and Rotate / Place / Cancel once it is. Rebuilt in place so the board
 *  itself doesn't have to re-render. */
let placementBarEl: HTMLElement | null = null;
function renderPlacementBar(): void {
  if (!placementBarEl) return;
  placementBarEl.innerHTML = '';
  if (!pending) {
    placementBarEl.className = 'board-hint';
    const riverTile = !!room?.game?.currentTile && TILE_TYPES[room.game.currentTile]!.river;
    placementBarEl.textContent = riverTile
      ? (coarsePointer ? 'River tile: tap the glowing cell at the river\u2019s end' : 'River tile: click the glowing cell at the river\u2019s end • R to rotate')
      : (coarsePointer ? 'Tap a glowing cell to set the tile down' : 'Click a glowing cell to set the tile down • drag to pan • R to rotate');
    return;
  }
  const rots = legalRotsAt(pending.x, pending.y);
  placementBarEl.className = 'board-hint place-bar';
  const rotateBtn = h('button', { class: 'small', disabled: rots.length <= 1, title: rots.length <= 1 ? 'Only one orientation fits here' : 'Rotate (R)', onclick: rotatePending }, '↻ Rotate');
  const pts = pendingPoints();
  const placeBtn = h('button', { class: 'small primary', title: 'Place (Enter)', onclick: confirmPending }, pts > 0 ? `✓ Place (+${pts})` : '✓ Place');
  const cancelBtn = h('button', { class: 'small ghost', title: 'Cancel (Esc)', onclick: cancelPending }, '✕');
  placementBarEl.appendChild(rotateBtn); placementBarEl.appendChild(placeBtn); placementBarEl.appendChild(cancelBtn);
}

let meepleBarEl: HTMLElement | null = null;
function renderMeepleBar(): void {
  if (!meepleBarEl || !room?.game) return;
  const meP = room.game.players[room.game.currentPlayer];
  meepleBarEl.innerHTML = '';
  const sel = selectedGhost;
  const label = sel ? getMeepleOptions(room.game).find((o) => o.kind === sel.kind && o.idx === sel.idx)?.label : null;
  const bar = meepleBarEl;
  bar.appendChild(h('canvas', { class: 'meeple-swatch', width: 22, height: 22, 'data-color': meP?.color ?? '#888' }));
  if (sel && label) bar.appendChild(h('span', {}, h('strong', {}, label), ` — ${kindNoun(sel.kind)}`));
  else bar.appendChild(h('span', {}, h('strong', {}, 'Place a meeple?'), coarsePointer ? ' Tap a marker on the glowing tile' : ' Hover a marker on the glowing tile'));
  if (sel) bar.appendChild(h('button', { class: 'small primary', onclick: () => { send({ type: 'place_meeple', kind: sel.kind, idx: sel.idx }); selectedGhost = null; } }, '✓ Place'));
  bar.appendChild(h('button', { class: sel ? 'small' : 'small primary', onclick: () => send({ type: 'skip_meeple' }) }, 'Skip (Esc)'));
  paintMeepleSwatches(meepleBarEl);
}

function zoomBy(factor: number): void {
  if (!boardCanvasEl) return;
  userAdjustedCamera = true;
  camera.scale = Math.max(28, Math.min(220, camera.scale * factor));
  drawBoard(boardCanvasEl);
}
let settingsOpen = false;
const PREF_OWNERS = 'carcassonne.showOwners';
let showOwners = (() => { try { return localStorage.getItem(PREF_OWNERS) === 'on'; } catch { return false; } })();

/** The player's unplaced meeples, drawn as a stack: solid ones are in hand, faint
 *  outlines are out on the board earning their keep. */
function reserveStack(color: string, inHand: number, total: number): HTMLElement {
  const size = 30, step = 16;
  const cv = h('canvas', { width: step * (total - 1) + size + 6, height: size + 8 }) as HTMLCanvasElement;
  const ctx = cv.getContext('2d')!;
  for (let i = 0; i < total; i++) {
    const x = 3 + i * step, y = 4 + (i % 2) * 3;
    ctx.globalAlpha = i < inHand ? 1 : 0.22;
    ctx.drawImage(getMeepleCanvas(color, size, false), x, y, size, size);
  }
  ctx.globalAlpha = 1;
  return h('div', { class: 'meeple-reserve', title: `${inHand} of ${total} meeples in reserve` },
    cv,
    h('span', { class: 'meeple-reserve-count' }, `${inHand}`, h('small', {}, ` / ${total}`)),
  );
}

function kindNoun(kind: MeepleKind): string {
  return { city: 'claim this city', road: 'claim this road', monastery: 'claim this cloister', farm: 'claim this field' }[kind];
}

/** Keep the board repainting while ghost meeples are on it so they can pulse; stops
 *  itself the moment there is nothing left to animate. */
function ensureGhostAnimation(): void {
  if (ghostAnimFrame !== null) return;
  const step = () => {
    ghostAnimFrame = null;
    if (!boardCanvasEl || !room?.game || !isMyTurn() || !(room.game.phase === 'placeMeeple' || (room.game.phase === 'placeTile' && pending))) return;
    if (!animateMeeples) drawBoard(boardCanvasEl); // otherwise the board loop already repaints
    ghostAnimFrame = requestAnimationFrame(step);
  };
  ghostAnimFrame = requestAnimationFrame(step);
}

function ghostAt(clientX: number, clientY: number, canvasEl: HTMLCanvasElement): MeepleSpot | null {
  const rect = canvasEl.getBoundingClientRect();
  const px = clientX - rect.left, py = clientY - rect.top;
  let best: { spot: MeepleSpot; d: number } | null = null;
  for (const g of ghostTargets(rect.width, rect.height)) {
    const d = Math.hypot(g.sx - px, g.sy - py);
    if (d <= Math.max(20, g.size * 0.6) && (!best || d < best.d)) best = { spot: g.spot, d };
  }
  return best?.spot ?? null;
}

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

interface MeepleSpot { kind: MeepleKind; idx: number; x: number; y: number }

function rawMeepleAnchor(tileKey: string, rot: number, kind: string, idx: number): [number, number] {
  const t = TILE_TYPES[tileKey]!;
  const MID: Record<number, [number, number]> = { 0: [0.5, 0.06], 1: [0.94, 0.5], 2: [0.5, 0.94], 3: [0.06, 0.5] };
  const SLOT_POS: [number, number][] = [[0.3, 0.08], [0.7, 0.08], [0.92, 0.3], [0.92, 0.7], [0.7, 0.92], [0.3, 0.92], [0.08, 0.7], [0.08, 0.3]];
  if (kind === 'monastery') { const [mx, my] = monasteryCenter(t); return [mx / 200, my / 200 + 0.02]; }
  if (kind === 'city') {
    const abs = rotateGroupSides(t.cityGroups[idx]!, rot);
    const pts = abs.map((s) => MID[s]!);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return [cx + (0.5 - cx) * 0.45, cy + (0.5 - cy) * 0.45];
  }
  if (kind === 'road') {
    const abs = rotateGroupSides(t.roadGroups[idx]!, rot);
    if (abs.length === 2) {
      const a = MID[abs[0]!]!, b = MID[abs[1]!]!;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      // A bend is drawn as a quarter-circle around the tile corner, whose midpoint
      // lies a little closer to the tile centre than the chord midpoint does.
      const isBend = Math.abs(abs[0]! - abs[1]!) % 2 === 1;
      return isBend ? [mx - (mx - 0.5) * 0.3, my - (my - 0.5) * 0.3] : [mx, my];
    }
    const a = MID[abs[0]!]!; return [a[0] + (0.5 - a[0]) * 0.55, a[1] + (0.5 - a[1]) * 0.55];
  }
  if (kind === 'farm') {
    const slots = t.fieldRegions[idx]!.slots.map((s) => rotateSlot(s, rot));
    const pts = slots.map((s) => SLOT_POS[s]!);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    // A field wrapping most of the tile averages out near the middle, where the city
    // or road art is — pull it toward the tile's grassiest edge instead.
    const d = Math.hypot(cx - 0.5, cy - 0.5);
    if (d < 0.12) {
      const far = pts.reduce((best, p) => (Math.hypot(p[0] - 0.5, p[1] - 0.5) > Math.hypot(best[0] - 0.5, best[1] - 0.5) ? p : best), pts[0]!);
      return [0.5 + (far[0] - 0.5) * 0.55, 0.5 + (far[1] - 0.5) * 0.55];
    }
    return [cx, cy];
  }
  return [0.5, 0.5];
}

const meepleSpotCache = new Map<string, MeepleSpot[]>();
/** Every place a meeple can stand on this tile (one per feature), spread apart so two
 *  never sit on top of each other. Used both for drawing placed meeples and for the
 *  click-to-place ghosts, so what you click is exactly where the meeple will appear. */
function meepleSpots(tileKey: string, rot: number): MeepleSpot[] {
  const ck = `${tileKey}:${rot}`;
  const cached = meepleSpotCache.get(ck);
  if (cached) return cached;
  const t = TILE_TYPES[tileKey]!;
  const spots: MeepleSpot[] = [];
  const add = (kind: MeepleKind, idx: number) => { const [x, y] = rawMeepleAnchor(tileKey, rot, kind, idx); spots.push({ kind, idx, x, y }); };
  t.cityGroups.forEach((_, g) => add('city', g));
  t.roadGroups.forEach((_, g) => add('road', g));
  if (t.monastery) add('monastery', 0);
  t.fieldRegions.forEach((_, r) => add('farm', r));
  // Relax: push any pair closer than `minGap` apart, then keep everything on the tile.
  const minGap = 0.26;
  for (let iter = 0; iter < 24; iter++) {
    let moved = false;
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      const a = spots[i]!, b = spots[j]!;
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= minGap) continue;
      if (d < 1e-4) { dx = 0.01 * (j - i); dy = -0.013; d = Math.hypot(dx, dy); }
      const push = (minGap - d) / 2;
      a.x -= (dx / d) * push; a.y -= (dy / d) * push;
      b.x += (dx / d) * push; b.y += (dy / d) * push;
      moved = true;
    }
    for (const s of spots) { s.x = Math.min(0.84, Math.max(0.16, s.x)); s.y = Math.min(0.84, Math.max(0.16, s.y)); }
    if (!moved) break;
  }
  meepleSpotCache.set(ck, spots);
  return spots;
}

// ---------------------------------------------------------------------------
// Idle animation: meeples patrol the feature they stand on. Each gets a path in
// tile-local coordinates (0..1) and walks it at its own pace; roads are walked back
// and forth along the real road line, cities and cloisters are looped.
// ---------------------------------------------------------------------------
const PREF_ANIMATE = 'carcassonne.animate';
let animateMeeples = (() => { try { return localStorage.getItem(PREF_ANIMATE) !== 'off'; } catch { return true; } })();
interface WalkPath { pts: [number, number][]; cum: number[]; length: number; loop: boolean; speed: number; phase: number }
const walkCache = new Map<string, WalkPath>();

function rotatePt([x, y]: [number, number], rot: number): [number, number] {
  let px = x, py = y;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) { const nx = 1 - py, ny = px; px = nx; py = ny; }
  return [px, py];
}

function roadPolyline(tileKey: string, rot: number, idx: number): [number, number][] {
  const grp = TILE_TYPES[tileKey]!.roadGroups[idx]!;
  const MID: [number, number][] = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
  const pts: [number, number][] = [];
  const a = grp[0]!;
  if (grp.length === 2) {
    const b = grp[1]!;
    if ((a + 2) % 4 === b) { pts.push(MID[a]!, MID[b]!); }
    else {
      // Quarter circle around the shared corner, matching how every skin draws bends.
      const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
      const corner: [number, number] = lo === 0 && hi === 3 ? [0, 0] : lo === 0 ? [1, 0] : lo === 1 ? [1, 1] : [0, 1];
      const [ax, ay] = MID[a]!, [bx, by] = MID[b]!;
      const a0 = Math.atan2(ay - corner[1], ax - corner[0]), a1 = Math.atan2(by - corner[1], bx - corner[0]);
      let d = a1 - a0; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      for (let i = 0; i <= 12; i++) { const t = a0 + (d * i) / 12; pts.push([corner[0] + Math.cos(t) * 0.5, corner[1] + Math.sin(t) * 0.5]); }
    }
  } else {
    pts.push(MID[a]!, [0.5, 0.5]);
  }
  // Trim the ends so the walker turns around a little inside the tile edge / junction.
  const trimmed = pts.map((p) => p);
  const shrink = (p: [number, number], q: [number, number], k: number): [number, number] => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  trimmed[0] = shrink(trimmed[0]!, trimmed[1]!, 0.18);
  const n = trimmed.length - 1;
  trimmed[n] = shrink(trimmed[n]!, trimmed[n - 1]!, grp.length === 2 ? 0.18 : 0.35);
  return trimmed.map((p) => rotatePt(p, rot));
}

function walkPathFor(m: { x: number; y: number; kind: MeepleKind; idx: number; playerIdx: number }, tileKey: string, rot: number): WalkPath {
  const key = `${m.x},${m.y}|${m.kind}|${m.idx}|${m.playerIdx}`;
  const hit = walkCache.get(key);
  if (hit) return hit;
  const [ax, ay] = meepleAnchor(tileKey, rot, m.kind, m.idx);
  const seed = ((m.x * 73856093) ^ (m.y * 19349663) ^ (m.idx * 83492791)) >>> 0;
  const phase = (seed % 1000) / 1000;
  let pts: [number, number][] = [];
  let loop = true, speed = 0.05; // tile units per second
  if (m.kind === 'road') { pts = roadPolyline(tileKey, rot, m.idx); loop = false; speed = 0.07; }
  else if (m.kind === 'city') { for (let i = 0; i <= 16; i++) { const t = (i / 16) * Math.PI * 2; pts.push([ax + Math.cos(t) * 0.075, ay + Math.sin(t) * 0.045]); } speed = 0.045; }
  else if (m.kind === 'monastery') { const r = TILE_TYPES[tileKey]!.river ? 0.13 : 0.2; for (let i = 0; i <= 20; i++) { const t = (i / 20) * Math.PI * 2; pts.push([ax + Math.cos(t) * r, ay + 0.03 + Math.sin(t) * r * 0.8]); } speed = 0.06; }
  else { pts = [[ax, ay]]; speed = 0; }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const wp: WalkPath = { pts, cum, length: cum[cum.length - 1]!, loop, speed, phase };
  walkCache.set(key, wp);
  return wp;
}

/** Where a meeple is right now, in tile-local units, plus which way it faces. */
function meeplePose(m: { x: number; y: number; kind: MeepleKind; idx: number; playerIdx: number }, tileKey: string, rot: number, now: number): { x: number; y: number; flip: boolean; bob: number } {
  const wp = walkPathFor(m, tileKey, rot);
  if (!animateMeeples || wp.length === 0 || wp.speed === 0) {
    const p = wp.pts[0]!;
    const rock = animateMeeples && m.kind === 'farm' ? Math.sin(now / 900 + wp.phase * 6) * 0.004 : 0;
    return { x: p[0], y: p[1] + rock, flip: false, bob: 0 };
  }
  const t = (now / 1000) * wp.speed + wp.phase * wp.length * 2;
  let d: number, forward = true;
  if (wp.loop) d = t % wp.length;
  else { const cycle = t % (wp.length * 2); if (cycle <= wp.length) d = cycle; else { d = wp.length * 2 - cycle; forward = false; } }
  let i = 1; while (i < wp.cum.length - 1 && wp.cum[i]! < d) i++;
  const seg0 = wp.cum[i - 1]!, seg1 = wp.cum[i]!;
  const k = seg1 > seg0 ? (d - seg0) / (seg1 - seg0) : 0;
  const p = wp.pts[i - 1]!, q = wp.pts[i]!;
  const dx = (q[0] - p[0]) * (forward ? 1 : -1);
  const bob = Math.abs(Math.sin(now / 140 + wp.phase * 10)) * 0.012;
  return { x: p[0] + (q[0] - p[0]) * k, y: p[1] + (q[1] - p[1]) * k - bob, flip: dx < -0.0005, bob };
}

let boardAnimFrame: number | null = null;
let lastAnimDraw = 0;
/** Keep the board alive at ~30fps while a game is on screen and animation is on. */
function ensureBoardAnimation(): void {
  if (boardAnimFrame !== null) return;
  const step = (ts: number) => {
    boardAnimFrame = null;
    if (!boardCanvasEl || !room?.game || !animateMeeples) return;
    if (ts - lastAnimDraw >= 33 && !dragState) { lastAnimDraw = ts; drawBoard(boardCanvasEl); }
    boardAnimFrame = requestAnimationFrame(step);
  };
  boardAnimFrame = requestAnimationFrame(step);
}

function meepleAnchor(tileKey: string, rot: number, kind: string, idx: number): [number, number] {
  const s = meepleSpots(tileKey, rot).find((sp) => sp.kind === kind && sp.idx === idx);
  return s ? [s.x, s.y] : [0.5, 0.5];
}

/** Ghost meeples the current player can click, in screen space. */
function ghostTargets(cw: number, ch: number): { spot: MeepleSpot; sx: number; sy: number; size: number; label: string; instant: number }[] {
  const game = room?.game;
  if (!game || !isMyTurn() || game.phase !== 'placeMeeple' || !game.lastPlaced) return [];
  const { x, y } = game.lastPlaced;
  const tile = game.board[`${x},${y}`];
  if (!tile) return [];
  const options = getMeepleOptions(game);
  const size = Math.max(22, camera.scale * 0.34);
  return meepleSpots(tile.tileKey, tile.rot)
    .filter((s) => options.some((o) => o.kind === s.kind && o.idx === s.idx))
    .map((spot) => {
      const [sx, sy] = worldToScreen(x + spot.x, y + spot.y, cw, ch);
      const label = options.find((o) => o.kind === spot.kind && o.idx === spot.idx)!.label;
      return { spot, sx, sy, size, label, instant: instantPoints(spot.kind, spot.idx) };
    });
}

/** Points the current player would bank right now by placing this meeple — i.e.
 *  the feature is already complete and scores the moment it is claimed. Cached per
 *  option for the current tile, since this runs a full scoring pass on a copy. */
let instantCache: { turn: number; values: Map<string, number> } | null = null;
function instantPoints(kind: MeepleKind, idx: number): number {
  const game = room?.game;
  if (!game) return 0;
  if (!instantCache || instantCache.turn !== game.turnNumber) instantCache = { turn: game.turnNumber, values: new Map() };
  const k = `${kind}:${idx}`;
  const hit = instantCache.values.get(k);
  if (hit !== undefined) return hit;
  let gained = 0;
  try {
    // Only the points this meeple adds: the tile itself may already be completing
    // features you own, and those come in whether you place a meeple or not.
    const me = game.currentPlayer;
    const withMeeple = structuredClone(game); placeMeeple(withMeeple, kind, idx);
    const without = structuredClone(game); skipMeeple(without);
    gained = withMeeple.players[me]!.score - without.players[me]!.score;
  } catch { gained = 0; }
  instantCache.values.set(k, gained);
  return gained;
}

/** Points the current player banks the moment the pending tile is confirmed —
 *  features it completes that already carry their meeples. */
let pendingPointsCache: { key: string; value: number } | null = null;
function pendingPoints(): number {
  const game = room?.game;
  if (!game || !pending || !game.currentTile) return 0;
  const key = `${game.turnNumber}:${pending.x},${pending.y},${pending.rot}`;
  if (pendingPointsCache?.key === key) return pendingPointsCache.value;
  let gained = 0;
  try {
    const me = game.currentPlayer;
    const trial = structuredClone(game);
    placeTile(trial, pending.x, pending.y, pending.rot);
    if (trial.phase === 'placeMeeple') skipMeeple(trial);
    gained = trial.players[me]!.score - game.players[me]!.score;
  } catch { gained = 0; }
  pendingPointsCache = { key, value: gained };
  return gained;
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

let tablePatternCache: { skinId: string; pattern: CanvasPattern } | null = null;
onSkinChange(() => { tablePatternCache = null; });
function tablePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const skin = currentSkin();
  if (!skin.table) return null;
  if (tablePatternCache?.skinId === skin.id) return tablePatternCache.pattern;
  const T = skin.tableSize ?? 400;
  const c = document.createElement('canvas'); c.width = T; c.height = T;
  const pctx = c.getContext('2d')!;
  pctx.save(); pctx.beginPath(); pctx.rect(0, 0, T, T); pctx.clip(); skin.table(pctx); pctx.restore();
  const pattern = ctx.createPattern(c, 'repeat')!;
  tablePatternCache = { skinId: skin.id, pattern };
  return pattern;
}

function drawBoard(canvas: HTMLCanvasElement): void {
  if (!room?.game) return;
  const ctx = canvas.getContext('2d')!;
  const rect = canvas.getBoundingClientRect();
  const cw = rect.width, ch = rect.height;
  ctx.clearRect(0, 0, cw, ch);
  const g = ctx.createLinearGradient(0, 0, 0, ch);
  const [top, bottom] = currentSkin().board;
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  // The table surface: a seamless pattern pinned to the world grid, so it scrolls
  // and zooms with the tiles instead of sitting still behind them like wallpaper.
  const pattern = tablePattern(ctx);
  if (pattern) {
    const [ox, oy] = worldToScreen(0, 0, cw, ch);
    const m = new DOMMatrix().translate(ox, oy).scale(camera.scale / 200);
    pattern.setTransform(m);
    ctx.save(); ctx.fillStyle = pattern; ctx.fillRect(0, 0, cw, ch); ctx.restore();
  }

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

  // The most recently placed tile (by anyone) stays marked in its placer's colour
  // until the next one lands, so you can always see what just happened.
  let newest: { x: number; y: number; by: number; turn: number } | null = null;
  for (const k of Object.keys(board)) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    const { tileKey, rot, placedBy, placedTurn } = board[k]!;
    const [sx, sy] = worldToScreen(x, y, cw, ch);
    const s = camera.scale;
    ctx.drawImage(getTileCanvas(tileKey, rot, TILE_ART_SIZE), sx, sy, s, s);
    if (placedBy >= 0 && (!newest || placedTurn > newest.turn)) newest = { x, y, by: placedBy, turn: placedTurn };
    if (showOwners && placedBy >= 0) {
      const color = game.players[placedBy]?.color ?? '#888';
      const r = Math.max(3, s * 0.05);
      ctx.save();
      ctx.beginPath(); ctx.arc(sx + r * 2, sy + r * 2, r, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
  }
  if (newest && !(game.phase === 'placeMeeple' && game.lastPlaced && game.lastPlaced.x === newest.x && game.lastPlaced.y === newest.y)) {
    const color = game.players[newest.by]?.color ?? '#D4B85A';
    const [sx, sy] = worldToScreen(newest.x, newest.y, cw, ch);
    const s = camera.scale;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 3.5;
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    roundRect(ctx, sx + 2, sy + 2, s - 4, s - 4, 6);
    ctx.stroke();
    // A small tab with the placer's meeple, so the colour reads even on busy art.
    const tab = Math.max(16, s * 0.22);
    roundRect(ctx, sx + s - tab - 3, sy + 3, tab, tab, 4);
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(245,248,246,0.92)'; ctx.fill();
    ctx.drawImage(getMeepleCanvas(color, tab - 4, false), sx + s - tab - 1, sy + 5, tab - 4, tab - 4);
    ctx.restore();
  }
  if (game.phase === 'placeMeeple' && game.lastPlaced && !isMyTurn()) {
    // Someone else is deciding about a meeple on this tile right now.
    const [sx, sy] = worldToScreen(game.lastPlaced.x, game.lastPlaced.y, cw, ch);
    const s = camera.scale;
    ctx.save();
    ctx.strokeStyle = 'rgba(212,184,90,0.95)'; ctx.lineWidth = 3; ctx.setLineDash([8, 5]);
    roundRect(ctx, sx + 2, sy + 2, s - 4, s - 4, 6);
    ctx.stroke();
    ctx.restore();
  }

  const now = performance.now();
  for (const m of game.meeples) {
    const tile = board[`${m.x},${m.y}`];
    if (!tile) continue;
    const pose = meeplePose(m, tile.tileKey, tile.rot, now);
    const [sx, sy] = worldToScreen(m.x + pose.x, m.y + pose.y, cw, ch);
    const size = camera.scale * 0.34;
    const player = game.players[m.playerIdx]!;
    const img = getMeepleCanvas(player.color, size, m.kind as MeepleLook);
    if (pose.flip) { ctx.save(); ctx.translate(sx, sy); ctx.scale(-1, 1); ctx.drawImage(img, -size / 2, -size / 2, size, size); ctx.restore(); }
    else ctx.drawImage(img, sx - size / 2, sy - size / 2, size, size);
  }

  // Meeple decision: the freshly placed tile glows and every feature you could claim
  // shows a translucent meeple in your colour. Hover one to see what it is; click to
  // place it. (The Skip button lives in the overlay above the board.)
  const ghosts = ghostTargets(cw, ch);
  if (ghosts.length && game.lastPlaced) {
    const meColor = game.players[game.currentPlayer]!.color;
    const [tx, ty] = worldToScreen(game.lastPlaced.x, game.lastPlaced.y, cw, ch);
    const s = camera.scale;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 380);
    ctx.save();
    ctx.shadowColor = `rgba(63,203,184,${0.5 + 0.4 * pulse})`;
    ctx.shadowBlur = 14 + 10 * pulse;
    ctx.strokeStyle = 'rgba(63,203,184,0.95)';
    ctx.lineWidth = 3;
    roundRect(ctx, tx + 2, ty + 2, s - 4, s - 4, 6);
    ctx.stroke();
    ctx.restore();
    for (const g of ghosts) {
      const hot = hoveredGhost === g.spot || selectedGhost === g.spot;
      if (hot) {
        const size = g.size * 1.15;
        ctx.save();
        ctx.beginPath(); ctx.arc(g.sx, g.sy, size * 0.58, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.drawImage(getMeepleCanvas(meColor, size, g.spot.kind as MeepleLook), g.sx - size / 2, g.sy - size / 2, size, size);
        ctx.restore();
      } else {
        // A quiet zone marker: a dot in your colour, so the tile art stays readable.
        const r = Math.max(6, g.size * 0.2) * (1 + 0.12 * pulse);
        ctx.save();
        ctx.beginPath(); ctx.arc(g.sx, g.sy, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.25 * pulse})`; ctx.fill();
        ctx.beginPath(); ctx.arc(g.sx, g.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = meColor; ctx.fill();
        ctx.strokeStyle = 'rgba(31,46,43,0.7)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
      if (g.instant > 0) {
        // This claim banks points immediately: say so next to the marker.
        ctx.save();
        ctx.font = '700 11px "Space Grotesk", sans-serif';
        const text = `+${g.instant}`;
        const w = ctx.measureText(text).width + 10;
        const off = hot ? g.size * 0.5 : Math.max(6, g.size * 0.2) + 4;
        const bx = g.sx + off, by = g.sy - off - 6;
        roundRect(ctx, bx, by, w, 16, 8);
        ctx.fillStyle = '#D4B85A'; ctx.fill();
        ctx.strokeStyle = 'rgba(31,46,43,0.8)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#1F2E2B'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 5, by + 8.5);
        ctx.restore();
      }
    }
    const hot = ghosts.find((g) => hoveredGhost === g.spot || selectedGhost === g.spot);
    if (hot) {
      ctx.save();
      ctx.font = '600 13px "Space Grotesk", sans-serif';
      const text = `${hot.label} — ${kindNoun(hot.spot.kind)}${hot.instant > 0 ? ` · scores ${hot.instant} pt${hot.instant === 1 ? '' : 's'} now` : ''}`;
      const tw = ctx.measureText(text).width + 18;
      const bx = Math.min(cw - tw - 4, Math.max(4, hot.sx - tw / 2)), by = hot.sy - hot.size * 0.7 - 30;
      roundRect(ctx, bx, by, tw, 24, 12);
      ctx.fillStyle = 'rgba(31,46,43,0.92)';
      ctx.fill();
      ctx.fillStyle = '#E7EDEA';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 9, by + 12);
      ctx.restore();
    }
  }

  if (myTurn && game.phase === 'placeTile' && game.currentTile && pending) {
    // Set down but not confirmed: full-strength preview with a pulsing outline.
    const [sx, sy] = worldToScreen(pending.x, pending.y, cw, ch);
    const s = camera.scale;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
    ctx.save();
    ctx.shadowColor = `rgba(63,203,184,${0.5 + 0.4 * pulse})`; ctx.shadowBlur = 12 + 8 * pulse;
    ctx.drawImage(getTileCanvas(game.currentTile, pending.rot, TILE_ART_SIZE), sx, sy, s, s);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(63,203,184,0.95)'; ctx.lineWidth = 4;
    roundRect(ctx, sx + 2, sy + 2, s - 4, s - 4, 6);
    ctx.stroke();
    ctx.restore();
    const pts = pendingPoints();
    if (pts > 0) {
      // This placement completes something you already hold: say what it's worth.
      ctx.save();
      ctx.font = '700 13px "Space Grotesk", sans-serif';
      const text = `+${pts} on placing`;
      const w = ctx.measureText(text).width + 14;
      const bx = sx + s / 2 - w / 2, by = sy - 24;
      roundRect(ctx, bx, by, w, 20, 10);
      ctx.fillStyle = '#D4B85A'; ctx.fill();
      ctx.strokeStyle = 'rgba(31,46,43,0.8)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#1F2E2B'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 7, by + 10.5);
      ctx.restore();
    }
  } else if (myTurn && game.phase === 'placeTile' && hovered && game.currentTile && !coarsePointer) {
    const k = `${hovered.x},${hovered.y}`;
    const rots = legalByCell.get(k);
    if (rots) {
      const [sx, sy] = worldToScreen(hovered.x, hovered.y, cw, ch);
      const s = camera.scale;
      const pr = ((previewRot % 4) + 4) % 4;
      const rot = rots.includes(pr) ? pr : rots[0]!;
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.drawImage(getTileCanvas(game.currentTile, rot, TILE_ART_SIZE), sx, sy, s, s);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(63,203,184,0.8)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      roundRect(ctx, sx + 2, sy + 2, s - 4, s - 4, 6);
      ctx.stroke();
      ctx.restore();
    }
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
    placementBarEl = h('div', { class: 'board-hint' });
    wrap.appendChild(placementBarEl);
    renderPlacementBar();
    if (pending) ensureGhostAnimation();
  } else {
    placementBarEl = null;
    pending = null;
  }
  if (myTurn && game.phase === 'placeMeeple' && meP) {
    // The meeple decision happens on the board itself: the markers on the glowing
    // tile are the choices, and this bar is the "no thanks" (and, on touch, the
    // "yes" for the zone you tapped).
    meepleBarEl = h('div', { class: 'board-hint meeple-bar' });
    wrap.appendChild(meepleBarEl);
    renderMeepleBar();
    ensureGhostAnimation();
  } else {
    hoveredGhost = null; selectedGhost = null; meepleBarEl = null;
  }
  // Upper right: view + settings. The settings popover holds the audio toggles.
  const settingsRow = (label: string, on: boolean, onChange: (v: boolean) => void) => h('label', { class: 'settings-row' },
    h('span', {}, label),
    h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
  );
  const popover = h('div', { class: 'settings-pop panel', hidden: !settingsOpen },
    h('h2', {}, 'Settings'),
    settingsRow('🎵 Background music', isMusicOn(), (v) => setMusic(v)),
    settingsRow('🔔 Sound effects', isSfxOn(), (v) => setSfx(v)),
    settingsRow('🚶 Meeples wander their features', animateMeeples, (v) => { animateMeeples = v; try { localStorage.setItem(PREF_ANIMATE, v ? 'on' : 'off'); } catch { /* fine */ } if (v) ensureBoardAnimation(); else if (boardCanvasEl) drawBoard(boardCanvasEl); }),
    settingsRow('📍 Mark who placed each tile', showOwners, (v) => { showOwners = v; try { localStorage.setItem(PREF_OWNERS, v ? 'on' : 'off'); } catch { /* fine */ } if (boardCanvasEl) drawBoard(boardCanvasEl); }),
    h('label', { class: 'settings-row' },
      h('span', {}, '🎨 Look'),
      h('select', { onchange: (e: Event) => setSkin((e.target as HTMLSelectElement).value) },
        ...SKINS.map((sk) => h('option', { value: sk.id, selected: sk.id === currentSkin().id }, sk.name))),
    ),
    h('p', { class: 'settings-note' }, 'Esc skips the meeple step • R rotates the tile'),
  );
  const gear = h('button', { class: 'small icon-btn', title: 'Settings', 'aria-expanded': String(settingsOpen), onclick: () => { settingsOpen = !settingsOpen; popover.hidden = !settingsOpen; gear.setAttribute('aria-expanded', String(settingsOpen)); } }, '⚙️');
  wrap.appendChild(h('div', { class: 'board-controls top' },
    h('button', { class: 'small icon-btn zoom-btn', title: 'Zoom out', onclick: () => zoomBy(1 / 1.25) }, '−'),
    h('button', { class: 'small icon-btn zoom-btn', title: 'Zoom in', onclick: () => zoomBy(1.25) }, '+'),
    h('button', { class: 'small icon-btn', onclick: () => { userAdjustedCamera = false; redraw(); } }, '🎯 Recenter'),
    gear,
    popover,
  ));

  // Lower right: your meeples in reserve, as a little pile on the table edge.
  if (meP) wrap.appendChild(reserveStack(meP.color, meP.meeples, game.config.meeplesPerPlayer));

  const redraw = () => {
    if (!boardWrapEl || !boardCanvasEl) return;
    const dims = resizeBoardCanvas(boardCanvasEl, boardWrapEl);
    if (!userAdjustedCamera) fitCamera(dims.w, dims.h);
    drawBoard(boardCanvasEl);
  };

  // Pointer events cover mouse, touch and pen alike, so dragging to pan works on phones.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (activePointerId !== null && activePointerId !== e.pointerId) return; // a second finger: ignore it
    activePointerId = e.pointerId;
    dragState = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y }; dragMovedFar = false;
    if (settingsOpen) { settingsOpen = false; popover.hidden = true; gear.setAttribute('aria-expanded', 'false'); }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not supported — fine */ }
  });
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
    window.addEventListener('pointermove', (e) => {
      if (!boardCanvasEl || !room) return;
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
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
      const g = ghostAt(e.clientX, e.clientY, boardCanvasEl);
      boardCanvasEl.style.cursor = g ? 'pointer' : dragState ? 'grabbing' : '';
      hoveredGhost = g;
      if (!dragState) drawBoard(boardCanvasEl);
    });
    const endDrag = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      if (dragState && !dragMovedFar && boardCanvasEl) handleBoardClick(e, boardCanvasEl);
      dragState = null; activePointerId = null;
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', () => { dragState = null; activePointerId = null; });
    window.addEventListener('keydown', (e) => {
      if (!boardCanvasEl || !room?.game || !isMyTurn()) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (room.game.phase === 'placeTile') {
        if (e.key.toLowerCase() === 'r') rotatePending();
        if (e.key === 'Enter' && pending) confirmPending();
        if (e.key === 'Escape' && pending) cancelPending();
      }
      if (e.key === 'Escape' && room.game.phase === 'placeMeeple') send({ type: 'skip_meeple' });
    });
    window.addEventListener('resize', () => redraw());
    // Browsers only let audio start from a user gesture: the first tap anywhere unlocks it.
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  function handleBoardClick(e: PointerEvent, canvasEl: HTMLCanvasElement): void {
    if (!room?.game || !isMyTurn()) return;
    if (room.game.phase === 'placeMeeple') {
      const g = ghostAt(e.clientX, e.clientY, canvasEl);
      if (!g) { if (selectedGhost) { selectedGhost = null; renderMeepleBar(); drawBoard(canvasEl); } return; }
      if (e.pointerType === 'touch' || coarsePointer) {
        if (selectedGhost === g) { send({ type: 'place_meeple', kind: g.kind, idx: g.idx }); selectedGhost = null; }
        else { selectedGhost = g; renderMeepleBar(); drawBoard(canvasEl); }
        return;
      }
      send({ type: 'place_meeple', kind: g.kind, idx: g.idx });
      return;
    }
    if (room.game.phase !== 'placeTile') return;
    const rect = canvasEl.getBoundingClientRect();
    const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    const gx = Math.floor(wx), gy = Math.floor(wy);
    // Two taps: the first sets the tile down (rotate / move it freely), the second on
    // the same cell confirms. Tapping a different legal cell moves it there.
    if (pending && pending.x === gx && pending.y === gy) { confirmPending(); return; }
    if (setPending(gx, gy)) ensureGhostAnimation();
  }

  requestAnimationFrame(() => redraw());
  if (animateMeeples) ensureBoardAnimation();

  const sidebar = buildSidebar(game, myTurn);
  const container = h('div', { class: 'game' }, wrap, sidebar);
  if (room!.phase === 'ended') { const modal = renderEndModal(game); if (modal) container.appendChild(modal); }
  return container;
}

function buildSidebar(game: NonNullable<RoomDoc['game']>, myTurn: boolean): HTMLElement {
  const isHost = room!.hostId === me.sub;
  const winners = game.winnerIds ? game.players.filter((p) => game.winnerIds!.includes(p.id)).map((p) => p.name).join(' & ') : '';
  const turnBanner = h('div', { class: `turn-banner${myTurn ? ' mine' : ''}` },
    game.phase === 'gameover'
      ? h('div', { class: 'game-over-banner' },
          h('span', {}, '👑 ', h('strong', {}, winners || 'Game over')),
          h('div', { style: 'display:flex;gap:0.4rem;justify-content:center;flex-wrap:wrap;margin-top:0.5rem' },
            h('button', { class: 'small', onclick: () => { endModalDismissed = false; renderRoom(); } }, '🏆 Final scores'),
            isHost ? h('button', { class: 'small primary', onclick: () => { lastEndedShown = false; send({ type: 'new_game' }); } }, 'Play again') : null,
          ),
        )
      : myTurn
        ? h('span', {}, game.phase === 'placeTile' ? h('strong', {}, 'Your turn — place a tile') : h('strong', {}, 'Your turn — place a meeple on the board, or skip'))
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
      cv.addEventListener('click', () => { if (myTurn && game.phase === 'placeTile') { rotatePending(); paint(); } });
      return cv;
    })(),
    h('div', {},
      h('div', {}, `${game.deck.length} tile${game.deck.length === 1 ? '' : 's'} left in the pile`),
      myTurn && game.phase === 'placeTile' ? h('button', { class: 'small', onclick: () => rotatePending() }, '↻ Rotate (R)') : null,
    ),
  );

  const scoreboard = h('div', { class: 'panel', style: 'padding:0.8rem' },
    h('h2', { style: 'font-size:0.95rem' }, 'Scoreboard'),
    h('div', { class: 'scoreboard' }, ...game.players.map((p, i) => {
      const roomPlayer = room!.players.find((rp) => rp.id === p.id);
      const offline = roomPlayer && !roomPlayer.connected && !p.isNpc;
      return h('div', { class: `score-row${i === game.currentPlayer && game.phase !== 'gameover' ? ' active' : ''}` },
      h('canvas', { class: 'meeple-swatch', width: 18, height: 18, 'data-color': p.color }),
      h('span', { class: 'sname' }, p.name + (p.id === me.sub ? ' (you)' : p.isNpc ? ' 🤖' : '')),
      offline ? h('span', { class: 'offline-dot', title: 'disconnected' }, '●') : null,
      h('span', { class: 'smeeples', title: `${p.meeples} of ${game.config.meeplesPerPlayer} meeples in reserve` },
        h('canvas', { class: 'meeple-swatch', width: 14, height: 14, 'data-color': p.color }), ` ×${p.meeples}`),
      h('span', { class: 'spoints' }, String(p.score)),
      );
    })),
  );

  const log = h('div', { class: 'panel', style: 'padding:0.8rem;display:flex;flex-direction:column;min-height:0;flex:1' },
    h('h2', { style: 'font-size:0.95rem' }, 'Chronicle'),
    h('div', { class: 'log-panel' }, ...game.log.slice(0, 40).map((l) => h('div', { class: 'log-entry' }, l))),
  );

  const sidebar = h('div', { class: 'sidebar' }, turnBanner, tilePreview, scoreboard, log);
  queueMicrotask(() => paintMeepleSwatches(sidebar));
  return sidebar;
}

let lastEndedShown = false;
let endModalDismissed = false;
function renderEndModal(game: NonNullable<RoomDoc['game']>): HTMLElement | null {
  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  const top = sorted[0]!.score;
  if (!lastEndedShown) {
    lastEndedShown = true;
    if (boardCanvasEl) { const r = boardCanvasEl.getBoundingClientRect(); spawnConfetti(r.width, r.height); drawBoard(boardCanvasEl); }
  }
  if (endModalDismissed) return null;
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
      h('div', { style: 'display:flex;gap:0.6rem;justify-content:center;flex-wrap:wrap' },
        h('button', { class: 'small', onclick: () => { endModalDismissed = true; renderRoom(); } }, '🔍 Look at the board'),
        isHost ? h('button', { class: 'primary', onclick: () => { lastEndedShown = false; send({ type: 'new_game' }); } }, 'Play again') : null,
      ),
      isHost ? null : h('p', { style: 'color:var(--ink-soft);margin:0.8rem 0 0' }, 'Waiting for the host to start a new game…'),
    ),
  );
}

// Read-only hooks for browser automation (scripts/play-in-browser.mjs): where things
// are on screen, so a test can click them the way a person would. Nothing here can
// mutate state — all moves still go through the same clicks/keys as a human.
(window as unknown as { __carcassonne: unknown }).__carcassonne = {
  room: () => room,
  myTurn: () => isMyTurn(),
  legalCells: () => {
    if (!room?.game || !boardCanvasEl) return [];
    const r = boardCanvasEl.getBoundingClientRect();
    return getLegalPlacements(room.game).map((p) => {
      const [sx, sy] = worldToScreen(p.x + 0.5, p.y + 0.5, r.width, r.height);
      return { ...p, sx: sx + r.left, sy: sy + r.top };
    });
  },
  ghosts: () => {
    if (!boardCanvasEl) return [];
    const r = boardCanvasEl.getBoundingClientRect();
    return ghostTargets(r.width, r.height).map((g) => ({ kind: g.spot.kind, idx: g.spot.idx, label: g.label, sx: g.sx + r.left, sy: g.sy + r.top }));
  },
  previewRot: () => ((previewRot % 4) + 4) % 4,
  pending: () => pending,
  meeple: (color: string, size: number, look: MeepleLook) => getMeepleCanvas(color, size, look),
  tileTypes: () => TILE_TYPES,
  tileCanvas: (key: string, rot: number, size: number) => getTileCanvas(key, rot, size),
};

onSkinChange(() => { if (room) renderRoom(); else route(); });
applySkinToDocument();

// Tile art is decoded from inline SVG data: URIs before the very first render —
// this is well under a frame for 22 small images, and it means drawBoard() (which
// runs synchronously off mouse events) never has to handle a not-yet-loaded image.
preloadTileArt()
  .catch((err) => { console.error('Tile art failed to preload:', err); })
  .then(() => route());
