import type { RoomDoc } from '../shared/room-types.js';
import { getTileCanvas, getTileBackCanvas } from './art.js';
import { h } from './dom.js';
import { currentSkin, setSkin, SKINS } from './skins/index.js';
import { unlockAudio, isMusicOn, isSfxOn, setMusic, setSfx } from './audio.js';
import { me } from './session.js';
import { navigate } from './router.js';
import { currentRoomId, isMyTurn, renderRoom, room, send } from './room.js';
import { cancelPending, confirmPending, ensureGhostAnimation, ghostAt, pending, previewRot, renderMeepleBar, renderPlacementBar, rotatePending, selectedGhost, setPending, skipHovered, skipPillAt, setHoveredGhost, setMeepleBarEl, setPlacementBarEl, setSelectedGhost, setSkipHovered, clearPending } from './placement.js';
import { renderReplayBar, replay, setReplayBarEl } from './replay.js';
import { coarsePointer, paintMeepleSwatches, reserveStack } from './ui.js';
import { boardCanvasEl, boardWrapEl, drawBoard, resizeBoardCanvas, scoreSpotlight, setScoreSpotlight, spawnConfetti, zoomBy, setBoardCanvasEl, setBoardWrapEl } from './board.js';
import { camera, fitCamera, screenToWorld, userAdjustedCamera, setHovered, setUserAdjustedCamera } from './camera.js';
import { PREF_ANIMATE, PREF_OWNERS, animateMeeples, showOwners, setAnimateMeeples, setShowOwners } from './prefs.js';
import { ensureBoardAnimation } from './wander.js';
import { meepleAt, pokeMeeple } from './life.js';

export let windowListenersAttached = false;
export let dragState: { x: number; y: number; cx: number; cy: number } | null = null;
export let dragMovedFar = false;
export let activePointerId: number | null = null;
export let settingsOpen = false;
export function renderGame(): HTMLElement {
  const game = room!.game!;
  const meP = game.players.find((p) => p.id === me.sub) ?? null;
  const myTurn = isMyTurn();

  const wrap = h('div', { class: 'board-wrap' });
  const canvas = h('canvas', {}) as HTMLCanvasElement;
  setBoardCanvasEl(canvas);
  setBoardWrapEl(wrap);
  wrap.appendChild(canvas);
  if (myTurn && game.phase === 'placeTile') {
    const bar = h('div', { class: 'board-hint' });
    setPlacementBarEl(bar);
    wrap.appendChild(bar);
    renderPlacementBar();
    if (pending) ensureGhostAnimation();
  } else {
    setPlacementBarEl(null);
    clearPending();
  }
  if (myTurn && game.phase === 'placeMeeple' && meP) {
    // The meeple decision happens on the board itself: the markers on the glowing
    // tile are the choices, and this bar is the "no thanks" (and, on touch, the
    // "yes" for the zone you tapped).
    const bar = h('div', { class: 'board-hint meeple-bar' });
    setMeepleBarEl(bar);
    wrap.appendChild(bar);
    renderMeepleBar();
    ensureGhostAnimation();
  } else {
    setHoveredGhost(null); setSelectedGhost(null); setSkipHovered(false); setMeepleBarEl(null);
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
    settingsRow('🌤 Living board (wandering meeples, weather, birds)', animateMeeples, (v) => { setAnimateMeeples(v); try { localStorage.setItem(PREF_ANIMATE, v ? 'on' : 'off'); } catch { /* fine */ } if (v) ensureBoardAnimation(); else if (boardCanvasEl) drawBoard(boardCanvasEl); }),
    settingsRow('📍 Mark who placed each tile', showOwners, (v) => { setShowOwners(v); try { localStorage.setItem(PREF_OWNERS, v ? 'on' : 'off'); } catch { /* fine */ } if (boardCanvasEl) drawBoard(boardCanvasEl); }),
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
    h('button', { class: 'small icon-btn', onclick: () => { setUserAdjustedCamera(false); redraw(); } }, '🎯 Recenter'),
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
    setUserAdjustedCamera(true);
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
        if (Math.abs(dx) + Math.abs(dy) > 4) { dragMovedFar = true; setUserAdjustedCamera(true); }
        camera.x = dragState.cx - dx / camera.scale;
        camera.y = dragState.cy - dy / camera.scale;
        drawBoard(boardCanvasEl);
      }
      const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      setHovered({ x: Math.floor(wx), y: Math.floor(wy) });
      const g = ghostAt(e.clientX, e.clientY, boardCanvasEl);
      setSkipHovered(!g && skipPillAt(e.clientX, e.clientY, boardCanvasEl));
      const overMeeple = !g && !skipHovered && !dragState && !!meepleAt(e.clientX, e.clientY, boardCanvasEl);
      boardCanvasEl.style.cursor = g || skipHovered || overMeeple ? 'pointer' : dragState ? 'grabbing' : '';
      setHoveredGhost(g);
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
    if (!room?.game) return;
    // Poking a meeple works for anyone, any time — it's just for fun. Markers and the
    // skip pill on your own meeple decision take priority.
    const deciding = isMyTurn() && room.game.phase === 'placeMeeple';
    if (!deciding || (!ghostAt(e.clientX, e.clientY, canvasEl) && !skipPillAt(e.clientX, e.clientY, canvasEl))) {
      const pm = meepleAt(e.clientX, e.clientY, canvasEl);
      if (pm) { pokeMeeple(pm); return; }
    }
    if (!isMyTurn()) return;
    if (room.game.phase === 'placeMeeple') {
      const g = ghostAt(e.clientX, e.clientY, canvasEl);
      if (!g && skipPillAt(e.clientX, e.clientY, canvasEl)) { send({ type: 'skip_meeple' }); setSelectedGhost(null); return; }
      if (!g) { if (selectedGhost) { setSelectedGhost(null); renderMeepleBar(); drawBoard(canvasEl); } return; }
      if (e.pointerType === 'touch' || coarsePointer) {
        if (selectedGhost === g) { send({ type: 'place_meeple', kind: g.kind, idx: g.idx }); setSelectedGhost(null); }
        else { setSelectedGhost(g); renderMeepleBar(); drawBoard(canvasEl); }
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
  if (replay) {
    const bar = h('div', { class: 'panel replay-bar' });
    setReplayBarEl(bar);
    sidebar.insertBefore(bar, sidebar.firstChild);
    renderReplayBar();
  } else {
    setReplayBarEl(null);
  }
  const container = h('div', { class: 'game' }, wrap, sidebar);
  if (room!.phase === 'ended' && !replay) { const modal = renderEndModal(game); if (modal) container.appendChild(modal); }
  return container;
}

export function buildSidebar(game: NonNullable<RoomDoc['game']>, myTurn: boolean): HTMLElement {
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
    h('div', { class: 'log-panel' }, ...game.log.slice(0, 40).map((l, i) => {
      const seq = game.log.length - 1 - i;
      const ev = game.scoreEvents?.find((e) => e.seq === seq);
      if (!ev) return h('div', { class: 'log-entry' }, l);
      return h('div', {
        class: 'log-entry log-entry-score',
        title: coarsePointer ? 'Tap to show where on the board' : 'Hover to show where on the board',
        onmouseenter: () => { if (!scoreSpotlight?.pinned) setScoreSpotlight(ev); },
        onmouseleave: () => { if (!scoreSpotlight?.pinned) setScoreSpotlight(null); },
        onclick: (e: Event) => {
          const el = e.currentTarget as HTMLElement;
          const already = el.classList.contains('pinned');
          el.parentElement?.querySelectorAll('.pinned').forEach((n) => n.classList.remove('pinned'));
          if (already) setScoreSpotlight(null);
          else { el.classList.add('pinned'); setScoreSpotlight(ev, true); }
        },
      }, l);
    })),
  );

  const sidebar = h('div', { class: 'sidebar' }, turnBanner, tilePreview, scoreboard, log);
  queueMicrotask(() => paintMeepleSwatches(sidebar));
  return sidebar;
}

export let lastEndedShown = false;
export let endModalDismissed = false;
export function setEndModalDismissed(v: typeof endModalDismissed): void { endModalDismissed = v; }
export function renderEndModal(game: NonNullable<RoomDoc['game']>): HTMLElement | null {
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
        room!.games.length ? h('button', { class: 'small', onclick: () => navigate(`/r/${currentRoomId}/replay/${room!.games[room!.games.length - 1]!.id}`) }, '🎞 Replay') : null,
        isHost ? h('button', { class: 'primary', onclick: () => { lastEndedShown = false; send({ type: 'new_game' }); } }, 'Play again') : null,
      ),
      isHost ? null : h('p', { style: 'color:var(--ink-soft);margin:0.8rem 0 0' }, 'Waiting for the host to start a new game…'),
    ),
  );
}

// Read-only hooks for browser automation (scripts/play-in-browser.mjs): where things
// are on screen, so a test can click them the way a person would. Nothing here can
// mutate state — all moves still go through the same clicks/keys as a human.
