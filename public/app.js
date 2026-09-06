import { TILE_TYPES, rotateGroupSides, rotateSlot } from './shared/tiles.js';
import { getLegalPlacements, getMeepleOptions, PLAYER_COLORS } from './shared/engine.js';
import { getTileCanvas, getTileBackCanvas, getMeepleCanvas } from './art.js';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
const PLAYER_ID = localStorage.getItem('ccz_player_id') || (() => { const id = uuid(); localStorage.setItem('ccz_player_id', id); return id; })();
const ADJECTIVES = ['brave', 'swift', 'golden', 'stone', 'wild', 'noble', 'quiet', 'clever', 'lucky', 'crimson', 'wandering', 'merry'];
const ANIMALS = ['falcon', 'badger', 'fox', 'heron', 'wolf', 'raven', 'otter', 'stag', 'lynx', 'sparrow', 'boar', 'hare'];
function randomName() { return `${ADJECTIVES[Math.random() * ADJECTIVES.length | 0]}_${ANIMALS[Math.random() * ANIMALS.length | 0]}`.replace(/^./, (c) => c.toUpperCase()); }
let PLAYER_NAME = localStorage.getItem('ccz_player_name') || (() => { const n = randomName(); localStorage.setItem('ccz_player_name', n); return n; })();
function setPlayerName(n) { PLAYER_NAME = n; localStorage.setItem('ccz_player_name', n); }

function randomRoomId() {
  const a = ADJECTIVES[Math.random() * ADJECTIVES.length | 0];
  const b = ANIMALS[Math.random() * ANIMALS.length | 0];
  const n = Math.floor(10 + Math.random() * 90);
  return `${a}-${b}-${n}`;
}

// ---------------------------------------------------------------------------
// Tiny DOM helper
// ---------------------------------------------------------------------------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === false || v == null) {}
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg) {
  const t = h('div', { class: 'copy-toast' }, msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 1800);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const root = document.getElementById('app');
function navigate(path) { history.pushState({}, '', path); route(); }
window.addEventListener('popstate', route);

function route() {
  const m = location.pathname.match(/^\/r\/([a-z0-9-]+)\/?$/i);
  teardownRoom();
  if (m) mountRoom(m[1].toLowerCase());
  else mountHome();
}

// ---------------------------------------------------------------------------
// Home view
// ---------------------------------------------------------------------------
function bannerCanvas() {
  const c = document.createElement('canvas');
  const w = 420, hgt = 150; c.width = w; c.height = hgt;
  const ctx = c.getContext('2d');
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
  const mc = getMeepleCanvas(PLAYER_COLORS[0], 44, false);
  ctx.drawImage(mc, w - 60, hgt / 2 - 44, 44, 44);
  return c;
}

function mountHome() {
  const card = h('div', { class: 'home' },
    h('div', { class: 'home-banner' }, bannerCanvas()),
    h('h1', { class: 'home-title display' }, 'Carcassonne'),
    h('p', { class: 'home-subtitle' }, 'Draw a tile, extend the land, place your meeple, and race your friends to claim the roads, cities, and cloisters of the countryside.'),
    h('div', { class: 'home-actions' },
      h('div', { class: 'home-card panel' },
        h('h3', {}, '🏰 Start a game'),
        h('p', {}, 'Create a fresh table and send the link to your friends.'),
        h('button', { class: 'primary', onclick: () => navigate(`/r/${randomRoomId()}`) }, 'Create game'),
      ),
      h('div', { class: 'home-card panel' },
        h('h3', {}, '🧭 Join a game'),
        h('p', {}, 'Got a link or a room code from a friend? Hop in.'),
        (() => {
          const input = h('input', { type: 'text', placeholder: 'e.g. brave-falcon-42' });
          const go = () => { const v = input.value.trim().toLowerCase().replace(/^\/?r\//, ''); if (v) navigate(`/r/${v}`); };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
          return h('div', { class: 'join-row' }, input, h('button', { onclick: go }, 'Join'));
        })(),
      ),
    ),
    h('p', { class: 'home-footer' }, 'No sign-up. Your name and colour are remembered on this device — ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); renameSelf(); } }, 'change name'), '.'),
  );
  root.innerHTML = '';
  root.appendChild(card);
}

function renameSelf() {
  const n = prompt('What should we call you?', PLAYER_NAME);
  if (n && n.trim()) setPlayerName(n.trim().slice(0, 24));
}

// ---------------------------------------------------------------------------
// Room (lobby + game)
// ---------------------------------------------------------------------------
let socket = null;
let room = null;
let connStatus = 'connecting';
let currentRoomId = null;
let previewRot = 0;

function teardownRoom() {
  if (socket) { try { socket.close(); } catch {} socket = null; }
  room = null; currentRoomId = null; connStatus = 'connecting';
}

function mountRoom(roomId) {
  currentRoomId = roomId;
  connectSocket(roomId);
  renderRoom();
}

function connectSocket(roomId) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/api/room/${roomId}/ws?playerId=${encodeURIComponent(PLAYER_ID)}&name=${encodeURIComponent(PLAYER_NAME)}`;
  connStatus = 'connecting';
  socket = new WebSocket(url);
  socket.addEventListener('open', () => { connStatus = 'connected'; renderRoom(); });
  socket.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'sync') {
      const newTile = room?.game?.currentTile;
      room = msg.room;
      if (room.game && room.game.currentTile !== newTile) previewRot = 0;
      renderRoom();
    } else if (msg.type === 'error') {
      toast(msg.message);
    }
  });
  socket.addEventListener('close', () => {
    connStatus = 'disconnected';
    renderRoom();
    setTimeout(() => { if (currentRoomId === roomId) connectSocket(roomId); }, 1500);
  });
  socket.addEventListener('error', () => {});
}

function send(obj) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj)); }

function renderRoom() {
  root.innerHTML = '';
  if (connStatus !== 'connected' || !room) {
    root.appendChild(h('div', { class: 'home' },
      h('h2', {}, connStatus === 'disconnected' ? 'Reconnecting…' : 'Joining the table…'),
      h('p', { class: 'home-subtitle' }, `Room “${currentRoomId}”`),
    ));
    return;
  }
  if (room.phase === 'lobby') root.appendChild(renderLobby());
  else root.appendChild(renderGame());
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
function renderLobby() {
  const me = room.players.find((p) => p.id === PLAYER_ID);
  const isHost = room.hostId === PLAYER_ID;
  const link = `${location.origin}/r/${currentRoomId}`;

  const playerList = h('div', { class: 'player-list panel' },
    h('h2', {}, `Players (${room.players.length}/6)`),
    ...room.players.map((p) => h('div', { class: 'player-row' },
      h('canvas', { class: 'meeple-swatch', width: 22, height: 22, ...injectMeeple(p.color) }),
      p.id === PLAYER_ID
        ? h('input', { class: 'name-edit', type: 'text', value: p.name, maxlength: 24, onchange: (e) => send({ type: 'set_name', name: e.target.value }) })
        : h('span', { style: 'flex:1' }, p.name),
      p.id === room.hostId ? h('span', { class: 'host-badge' }, 'HOST') : null,
      p.id === PLAYER_ID ? h('span', { class: 'you-badge' }, 'YOU') : null,
      !p.connected ? h('span', { class: 'offline-dot', title: 'offline' }, '●') : null,
    )),
    room.players.length < 2 ? h('p', { style: 'color:var(--ink-soft);font-size:0.85rem' }, 'Waiting for at least one more player…') : null,
  );

  const usedColors = new Set(room.players.filter((p) => p.id !== PLAYER_ID).map((p) => p.color));
  const colorPicker = h('div', { class: 'panel' },
    h('h2', { style: 'padding:1rem 1.2rem 0' }, 'Your colour'),
    h('div', { class: 'color-swatches' }, ...PLAYER_COLORS.map((c) => h('div', {
      class: `color-dot${me?.color === c ? ' selected' : ''}${usedColors.has(c) ? ' taken' : ''}`,
      style: `background:${c}`,
      onclick: () => { if (!usedColors.has(c)) send({ type: 'set_color', color: c }); },
      title: usedColors.has(c) ? 'taken' : 'pick this colour',
    }))),
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
        h('span', { class: 'room-code' }, currentRoomId),
        h('button', { class: 'small', onclick: () => { navigator.clipboard?.writeText(link); toast('Link copied!'); } }, '🔗 Copy invite link'),
      ),
    ),
    h('div', { class: 'lobby-body' },
      playerList,
      h('div', { class: 'lobby-side' },
        colorPicker,
        rules,
        isHost
          ? h('button', { class: 'primary', disabled: room.players.length < 2, onclick: () => send({ type: 'start' }) }, room.players.length < 2 ? 'Need 2+ players' : `Start game (${room.players.length} players)`)
          : h('p', { style: 'text-align:center;color:var(--ink-soft)' }, 'Waiting for the host to start the game…'),
      ),
    ),
  );
}

function injectMeeple(color) {
  return { 'data-color': color };
}

// After the row elements exist, actually paint the tiny canvases (can't draw during h() creation easily since attrs run before append). We patch post-render.
function paintMeepleSwatches(container) {
  container.querySelectorAll('canvas.meeple-swatch[data-color]').forEach((cv) => {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(getMeepleCanvas(cv.getAttribute('data-color'), cv.width, false), 0, 0);
  });
}

// ---------------------------------------------------------------------------
// Game view
// ---------------------------------------------------------------------------
const TILE_ART_SIZE = 128;
let camera = { x: 0.5, y: 0.5, scale: 90 }; // scale = px per tile
let userAdjustedCamera = false;
let hovered = null; // {x,y}
let boardCanvasEl = null;
let boardWrapEl = null;
let particles = [];
let windowListenersAttached = false;
let dragState = null, dragMovedFar = false;

function boardBounds(board) {
  const keys = Object.keys(board);
  if (keys.length === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of keys) { const [x, y] = k.split(',').map(Number); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
}

function fitCamera(canvasW, canvasH) {
  const b = boardBounds(room.game.board);
  const w = b.maxX - b.minX + 3, hh = b.maxY - b.minY + 3;
  const scale = Math.max(30, Math.min(140, Math.min(canvasW / w, canvasH / hh)));
  camera = { x: (b.minX + b.maxX + 1) / 2, y: (b.minY + b.maxY + 1) / 2, scale };
}

function worldToScreen(wx, wy, cw, ch) {
  return [cw / 2 + (wx - camera.x) * camera.scale, ch / 2 + (wy - camera.y) * camera.scale];
}
function screenToWorld(sx, sy, cw, ch) {
  return [(sx - cw / 2) / camera.scale + camera.x, (sy - ch / 2) / camera.scale + camera.y];
}

function meepleAnchor(tileKey, rot, kind, idx) {
  const t = TILE_TYPES[tileKey];
  const MID = { 0: [0.5, 0.06], 1: [0.94, 0.5], 2: [0.5, 0.94], 3: [0.06, 0.5] };
  const SLOT_POS = [[0.3, 0.08], [0.7, 0.08], [0.92, 0.3], [0.92, 0.7], [0.7, 0.92], [0.3, 0.92], [0.08, 0.7], [0.08, 0.3]];
  if (kind === 'monastery') return [0.5, 0.78];
  if (kind === 'city') {
    const abs = rotateGroupSides(t.cityGroups[idx], rot);
    const pts = abs.map((s) => MID[s]);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return [cx + (0.5 - cx) * 0.45, cy + (0.5 - cy) * 0.45];
  }
  if (kind === 'road') {
    const abs = rotateGroupSides(t.roadGroups[idx], rot);
    if (abs.length === 2) { const [a, b] = abs.map((s) => MID[s]); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    const a = MID[abs[0]]; return [a[0] + (0.5 - a[0]) * 0.6, a[1] + (0.5 - a[1]) * 0.6];
  }
  if (kind === 'farm') {
    const slots = t.fieldRegions[idx].slots.map((s) => rotateSlot(s, rot));
    const pts = slots.map((s) => SLOT_POS[s]);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return [cx, cy];
  }
  return [0.5, 0.5];
}

function drawBoard(canvas) {
  const ctx = canvas.getContext('2d');
  // canvas.width/height are the DPR-scaled backing-store size; the context transform
  // (set in resizeBoardCanvas) already maps CSS pixels -> device pixels, so all drawing
  // math below must use CSS-pixel dimensions, not the raw backing-store size.
  const rect = canvas.getBoundingClientRect();
  const cw = rect.width, ch = rect.height;
  ctx.clearRect(0, 0, cw, ch);
  const g = ctx.createLinearGradient(0, 0, 0, ch);
  g.addColorStop(0, '#7a9556'); g.addColorStop(1, '#5f7a41');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);

  const board = room.game.board;
  const myTurn = isMyTurn();
  const legal = (myTurn && room.game.phase === 'placeTile') ? getLegalPlacements(room.game) : [];
  const legalByCell = new Map();
  for (const l of legal) { const k = `${l.x},${l.y}`; if (!legalByCell.has(k)) legalByCell.set(k, []); legalByCell.get(k).push(l.rot); }

  // grid dots under empty legal cells + subtle grid
  ctx.save();
  for (const [k, rots] of legalByCell) {
    const [x, y] = k.split(',').map(Number);
    const [sx, sy] = worldToScreen(x, y, cw, ch);
    const s = camera.scale;
    ctx.fillStyle = 'rgba(255, 224, 130, 0.28)';
    ctx.strokeStyle = 'rgba(184,134,42,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    roundRect(ctx, sx + 2, sy + 2, s - 4, s - 4, 6);
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // placed tiles
  for (const k of Object.keys(board)) {
    const [x, y] = k.split(',').map(Number);
    const { tileKey, rot } = board[k];
    const [sx, sy] = worldToScreen(x, y, cw, ch);
    const s = camera.scale;
    const tc = getTileCanvas(tileKey, rot, TILE_ART_SIZE);
    ctx.drawImage(tc, sx, sy, s, s);
    if (room.game.lastPlaced && room.game.lastPlaced.x === x && room.game.lastPlaced.y === y) {
      ctx.save();
      ctx.strokeStyle = 'rgba(232,184,75,0.95)';
      ctx.lineWidth = 3;
      roundRect(ctx, sx + 2, sy + 2, s - 4, s - 4, 6);
      ctx.stroke();
      ctx.restore();
    }
  }

  // meeples
  for (const m of room.game.meeples) {
    const tile = board[`${m.x},${m.y}`];
    if (!tile) continue;
    const [ax, ay] = meepleAnchor(tile.tileKey, tile.rot, m.kind, m.idx);
    const [sx, sy] = worldToScreen(m.x + ax, m.y + ay, cw, ch);
    const size = camera.scale * 0.34;
    const player = room.game.players[m.playerIdx];
    const mc = getMeepleCanvas(player.color, size, m.kind === 'farm');
    ctx.drawImage(mc, sx - size / 2, sy - size / 2, size, size);
  }

  // hover ghost
  if (myTurn && room.game.phase === 'placeTile' && hovered) {
    const k = `${hovered.x},${hovered.y}`;
    const rots = legalByCell.get(k);
    const [sx, sy] = worldToScreen(hovered.x, hovered.y, cw, ch);
    const s = camera.scale;
    const rotOk = rots && rots.includes(((previewRot % 4) + 4) % 4);
    ctx.save();
    ctx.globalAlpha = 0.75;
    const tc = getTileCanvas(room.game.currentTile, ((previewRot % 4) + 4) % 4, TILE_ART_SIZE);
    ctx.drawImage(tc, sx, sy, s, s);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rotOk ? 'rgba(60,140,60,0.9)' : 'rgba(190,50,50,0.85)';
    ctx.lineWidth = 3;
    roundRect(ctx, sx + 2, sy + 2, s - 4, s - 4, 6);
    ctx.stroke();
    ctx.restore();
  }

  drawParticles(ctx, cw, ch);
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function spawnConfetti(cw, ch) {
  const colors = PLAYER_COLORS;
  for (let i = 0; i < 140; i++) {
    particles.push({
      x: Math.random() * cw, y: -20 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3,
      color: colors[i % colors.length], size: 4 + Math.random() * 5, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      life: 260 + Math.random() * 120,
    });
  }
}
function drawParticles(ctx, cw, ch) {
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

function isMyTurn() {
  if (!room.game || room.game.phase === 'gameover') return false;
  return room.game.players[room.game.currentPlayer]?.id === PLAYER_ID;
}

function resizeBoardCanvas(canvas, wrap) {
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(200, rect.width * dpr);
  canvas.height = Math.max(200, rect.height * dpr);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: rect.width, h: rect.height };
}

function renderGame() {
  const game = room.game;
  const me = game.players.find((p) => p.id === PLAYER_ID);
  const myTurn = isMyTurn();

  const wrap = h('div', { class: 'board-wrap' });
  const canvas = h('canvas', {});
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
    const rect = boardCanvasEl.getBoundingClientRect();
    const before = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    camera.scale = Math.max(28, Math.min(220, camera.scale * (e.deltaY > 0 ? 0.9 : 1.1)));
    const after = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    camera.x += before[0] - after[0]; camera.y += before[1] - after[1];
    drawBoard(boardCanvasEl);
  }, { passive: false });

  if (!windowListenersAttached) {
    windowListenersAttached = true;
    window.addEventListener('mousemove', (e) => {
      if (!boardCanvasEl) return;
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
      if (e.key.toLowerCase() === 'r' && boardCanvasEl && isMyTurn() && room.game.phase === 'placeTile') { previewRot = (previewRot + 1) % 4; drawBoard(boardCanvasEl); }
    });
    window.addEventListener('resize', () => redraw());
  }

  function handleBoardClick(e, canvasEl) {
    if (!isMyTurn() || room.game.phase !== 'placeTile') return;
    const rect = canvasEl.getBoundingClientRect();
    const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    const gx = Math.floor(wx), gy = Math.floor(wy);
    const legal = getLegalPlacements(room.game).filter((p) => p.x === gx && p.y === gy);
    if (legal.length === 0) return;
    const pr = ((previewRot % 4) + 4) % 4;
    const chosen = legal.find((p) => p.rot === pr) || legal[0];
    previewRot = chosen.rot;
    send({ type: 'place_tile', x: gx, y: gy, rot: chosen.rot });
  }

  requestAnimationFrame(() => redraw());

  const sidebar = buildSidebar(game, me, myTurn);

  const container = h('div', { class: 'game' }, wrap, sidebar);

  if (room.phase === 'ended') {
    container.appendChild(renderEndModal(game));
  }
  return container;
}

function buildSidebar(game, me, myTurn) {
  const turnBanner = h('div', { class: `turn-banner${myTurn ? ' mine' : ''}` },
    game.phase === 'gameover'
      ? h('span', {}, 'The game has ended.')
      : myTurn
        ? h('span', {}, game.phase === 'placeTile' ? h('strong', {}, 'Your turn — place a tile') : h('strong', {}, 'Your turn — place a meeple or skip'))
        : h('span', {}, `Waiting for `, h('strong', {}, game.players[game.currentPlayer]?.name || '…')),
  );

  const tilePreview = h('div', { class: 'tile-preview-row' },
    (() => {
      const cv = h('canvas', { width: 72, height: 72, style: 'cursor:pointer' });
      const paint = () => {
        const ctx = cv.getContext('2d');
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

  const meepleBox = (myTurn && game.phase === 'placeMeeple')
    ? h('div', { class: 'meeple-menu panel', style: 'padding:0.8rem' },
        h('h2', { style: 'font-size:0.95rem' }, 'Place a meeple?'),
        ...getMeepleOptions(game).map((o) => h('button', { class: 'meeple-choice', onclick: () => send({ type: 'place_meeple', kind: o.kind, idx: o.idx }) },
          meepleIconCanvas(me.color, o.kind),
          h('span', {}, meepleLabel(o.kind)),
        )),
        h('button', { class: 'ghost small', onclick: () => send({ type: 'skip_meeple' }) }, 'Skip — place no meeple'),
      )
    : null;

  const scoreboard = h('div', { class: 'panel', style: 'padding:0.8rem' },
    h('h2', { style: 'font-size:0.95rem' }, 'Scoreboard'),
    h('div', { class: 'scoreboard' }, ...game.players.map((p, i) => h('div', { class: `score-row${i === game.currentPlayer && game.phase !== 'gameover' ? ' active' : ''}` },
      h('canvas', { class: 'meeple-swatch', width: 18, height: 18, ...injectMeeple(p.color) }),
      h('span', { class: 'sname' }, p.name + (p.id === PLAYER_ID ? ' (you)' : '')),
      h('span', { class: 'smeeples' }, '●'.repeat(p.meeples) + '○'.repeat(7 - p.meeples)),
      h('span', { class: 'spoints' }, p.score),
    ))),
  );

  const log = h('div', { class: 'panel', style: 'padding:0.8rem;display:flex;flex-direction:column;min-height:0;flex:1' },
    h('h2', { style: 'font-size:0.95rem' }, 'Chronicle'),
    h('div', { class: 'log-panel' }, ...game.log.slice(0, 40).map((l) => h('div', { class: 'log-entry' }, l))),
  );

  const chat = h('div', { class: 'panel chat-panel', style: 'padding:0.8rem' },
    h('h2', { style: 'font-size:0.95rem' }, 'Table talk'),
    h('div', { class: 'chat-log', id: 'chatlog' }, ...room.chat.slice(-60).map((c) => c.system
      ? h('div', { class: 'chat-msg', style: 'opacity:0.65;font-style:italic' }, c.text)
      : h('div', { class: 'chat-msg' }, h('span', { class: 'who', style: `color:${c.color}` }, c.name + ': '), c.text))),
    (() => {
      const input = h('input', { type: 'text', placeholder: 'Say something…', maxlength: 300 });
      const go = () => { if (input.value.trim()) { send({ type: 'chat', text: input.value }); input.value = ''; } };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      return h('div', { class: 'chat-form' }, input, h('button', { class: 'small', onclick: go }, 'Send'));
    })(),
  );

  const invite = h('button', { class: 'small', onclick: () => { navigator.clipboard?.writeText(location.href); toast('Link copied!'); } }, '🔗 Copy invite link');

  const sidebar = h('div', { class: 'sidebar' }, turnBanner, tilePreview, meepleBox, scoreboard, invite, log, chat);
  queueMicrotask(() => { paintMeepleSwatches(sidebar); const cl = sidebar.querySelector('#chatlog'); if (cl) cl.scrollTop = cl.scrollHeight; });
  return sidebar;
}

function meepleLabel(kind) {
  return { city: 'Knight — claim the city', road: 'Highwayman — claim the road', monastery: 'Monk — claim the cloister', farm: 'Farmer — claim the field' }[kind];
}
function meepleIconCanvas(color, kind) {
  const cv = document.createElement('canvas'); cv.width = 24; cv.height = 24;
  cv.getContext('2d').drawImage(getMeepleCanvas(color, 24, kind === 'farm'), 0, 0);
  return cv;
}

let lastEndedShown = false;
function renderEndModal(game) {
  const sorted = [...game.players].sort((a, b) => b.score - a.score);
  const top = sorted[0].score;
  if (!lastEndedShown) { lastEndedShown = true; if (boardCanvasEl) { const r = boardCanvasEl.getBoundingClientRect(); spawnConfetti(r.width, r.height); drawBoard(boardCanvasEl); } }
  const isHost = room.hostId === PLAYER_ID;
  return h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal' },
      h('h2', {}, '🏆 Final Scores'),
      h('div', { class: 'final-scores' }, ...sorted.map((p) => h('div', { class: `final-row${p.score === top ? ' winner' : ''}` },
        p.score === top ? h('span', { class: 'crown' }, '👑') : null,
        h('canvas', { class: 'meeple-swatch', width: 20, height: 20, ...injectMeeple(p.color) }),
        h('span', { style: 'flex:1' }, p.name),
        h('span', { style: 'font-family:Cinzel,serif;font-weight:700' }, p.score),
      ))),
      isHost ? h('button', { class: 'primary', onclick: () => { lastEndedShown = false; send({ type: 'new_game' }); } }, 'Play again')
             : h('p', { style: 'color:var(--ink-soft)' }, 'Waiting for the host to start a new game…'),
      h('button', { class: 'ghost small', onclick: () => { navigator.clipboard?.writeText(location.href); toast('Link copied!'); } }, 'Copy invite link'),
    ),
  );
}

// Patch renderRoom to paint swatches after DOM insert (lobby uses them too).
const _origRenderRoom = renderRoom;
renderRoom = function patchedRenderRoom() {
  _origRenderRoom();
  paintMeepleSwatches(root);
};

route();
