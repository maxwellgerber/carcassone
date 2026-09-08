import { createGame, placeMeeple, placeTile, skipMeeple } from '../shared/engine.js';
import type { RoomDoc, ReplayDoc } from '../shared/room-types.js';
import { mkRng } from '../shared/rng.js';
import type { MeepleKind } from '../shared/types.js';
import { h } from './dom.js';
import { me, refreshMe } from './session.js';
import { navigate, root } from './router.js';
import { renderRoom, setConnStatus, setCurrentRoomId, setRoom } from './room.js';
import { boardCanvasEl, drawBoard } from './board.js';
import { walkCache } from './wander.js';

export interface Replay { doc: ReplayDoc; states: NonNullable<RoomDoc['game']>[]; step: number; playing: boolean; timer: ReturnType<typeof setInterval> | null; speed: number }
export let replay: Replay | null = null;
export function setReplay(v: Replay | null): void { replay = v; }

export async function mountReplay(roomId: string, gameId: string): Promise<void> {
  await refreshMe();
  if (!me.signedIn) { window.location.href = `/auth/login?next=${encodeURIComponent(location.pathname)}`; return; }
  setCurrentRoomId(roomId);
  root.innerHTML = '';
  root.appendChild(h('div', { class: 'home' }, h('p', {}, 'Rewinding the game…')));
  let doc: ReplayDoc;
  try {
    const res = await fetch(`/api/room/${roomId}/replay/${encodeURIComponent(gameId)}`);
    if (!res.ok) { const body = await res.json().catch(() => ({})) as { error?: string }; throw new Error(body.error ?? `HTTP ${res.status}`); }
    doc = await res.json() as ReplayDoc;
  } catch (err) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'home' },
      h('h2', {}, 'No replay here'),
      h('p', { class: 'home-subtitle' }, String(err instanceof Error ? err.message : err)),
      h('button', { onclick: () => navigate('/') }, 'Home'),
    ));
    return;
  }
  const sm = doc.summary;
  const g0 = createGame(sm.players.map((p) => ({ id: p.id, name: p.name, color: p.color, isNpc: p.isNpc, npcDifficulty: p.npcDifficulty })), mkRng(sm.seed), sm.config);
  const states = [structuredClone(g0)];
  const g = g0;
  for (const mv of doc.moves) {
    try {
      const a = mv.action;
      if (a.type === 'place_tile') placeTile(g, a.x, a.y, a.rot);
      else if (a.type === 'place_meeple') placeMeeple(g, a.kind, a.idx);
      else skipMeeple(g);
    } catch (err) {
      console.error('replay diverged at move', states.length, err);
      break;
    }
    states.push(structuredClone(g));
  }
  replay = { doc, states, step: 0, playing: false, timer: null, speed: 1 };
  setConnStatus('connected');
  setReplayStep(0);
}

export function replayRoomDoc(): RoomDoc {
  const r = replay!;
  const sm = r.doc.summary;
  return {
    schemaVersion: 2, phase: 'ended', hostId: null, game: r.states[r.step]!, config: sm.config, chat: [],
    players: sm.players.map((p) => ({ id: p.id, name: p.name, color: p.color, connected: true, isNpc: p.isNpc, npcDifficulty: p.npcDifficulty })),
    createdAt: sm.startedAt, lastActivityAt: sm.endedAt, seq: 0, games: [],
  };
}

/** Move the replay to `step` and rebuild the whole view (board, sidebar, controls). */
export function setReplayStep(step: number): void {
  if (!replay) return;
  applyReplayStep(step);
  renderRoom();
}

/** Move the replay to `step` without touching the DOM: swaps in the room document
 *  for that moment so anything that reads `room` (the board painter, the walkers)
 *  sees the new state. Callers decide how much of the page to refresh. */
function applyReplayStep(step: number): void {
  if (!replay) return;
  const last = replay.states.length - 1;
  replay.step = Math.max(0, Math.min(last, step));
  if (replay.step === last && replay.playing) replayPlay(false);
  walkCache.clear();
  setRoom(replayRoomDoc());
}

/** Scrubbing: the slider fires `input` on every pixel of a drag, and rebuilding the
 *  page for each one would tear the slider out from under the pointer (the drag
 *  dies after the first move) and repaint the whole sidebar dozens of times a
 *  second. So while the thumb is moving only the board and the little readouts
 *  are refreshed in place; the full rebuild waits for the pointer to let go. */
export function scrubReplay(step: number): void {
  if (!replay) return;
  if (replay.playing) replayPlay(false, false); // pause, but keep the slider under the pointer
  applyReplayStep(step);
  if (boardCanvasEl) drawBoard(boardCanvasEl);
  updateReplayReadouts();
}

/** Start or stop auto-play. `rerender` rebuilds the control bar so the play button
 *  reflects the new state; a scrub passes false and patches the button itself. */
export function replayPlay(on: boolean, rerender = true): void {
  if (!replay) return;
  replay.playing = on;
  if (replay.timer) { clearInterval(replay.timer); replay.timer = null; }
  if (on) {
    replay.timer = setInterval(() => {
      if (!replay) return;
      // A tile landing gets a beat; the meeple decision that follows goes by quickly.
      setReplayStep(replay.step + 1);
    }, 900 / replay.speed);
  }
  if (rerender) renderReplayBar();
}

export let replayBarEl: HTMLElement | null = null;
export function setReplayBarEl(v: HTMLElement | null): void { replayBarEl = v; }

/** What the current move is, in words, for the caption under the slider. */
function replayCaption(): string {
  const r = replay!;
  const sm = r.doc.summary;
  const mv = r.step > 0 ? r.doc.moves[r.step - 1] : null;
  const who = mv ? sm.players.find((p) => p.id === mv.playerId)?.name ?? '?' : null;
  const role: Record<MeepleKind, string> = { city: 'knight in the city', road: 'highwayman on the road', monastery: 'monk in the cloister', farm: 'farmer in the field' };
  return !mv ? 'The table is set.' : mv.action.type === 'place_tile' ? `${who} lays a tile` : mv.action.type === 'place_meeple' ? `${who} places a ${role[mv.action.kind]}` : `${who} keeps their meeples`;
}

/** The parts of the bar that change with every step, kept so a scrub can update them in place. */
let readouts: { slider: HTMLInputElement; step: HTMLElement; caption: HTMLElement; play: HTMLElement } | null = null;
function updateReplayReadouts(): void {
  if (!replay || !readouts || !readouts.slider.isConnected) return;
  const last = replay.states.length - 1;
  if (Number(readouts.slider.value) !== replay.step) readouts.slider.value = String(replay.step);
  readouts.step.textContent = `${replay.step} / ${last}`;
  readouts.caption.textContent = replayCaption();
  readouts.play.textContent = replay.playing ? '❚❚' : '▶';
  readouts.play.title = replay.playing ? 'Pause' : 'Play';
}

export function renderReplayBar(): void {
  if (!replay || !replayBarEl) return;
  const r = replay;
  const last = r.states.length - 1;
  const sm = r.doc.summary;
  const what = replayCaption();
  replayBarEl.innerHTML = '';
  const slider = h('input', {
    type: 'range', min: 0, max: last, value: r.step, class: 'replay-slider', 'aria-label': 'Replay position',
    // Dragging: cheap in-place updates. Letting go (or an arrow key): the full page catches up.
    oninput: (e: Event) => scrubReplay(Number((e.target as HTMLInputElement).value)),
    onchange: (e: Event) => { replayPlay(false); setReplayStep(Number((e.target as HTMLInputElement).value)); },
  }) as HTMLInputElement;
  const stepEl = h('span', { class: 'replay-step' }, `${r.step} / ${last}`);
  const captionEl = h('div', { class: 'replay-caption' }, what);
  const playEl = h('button', { class: 'small primary', title: r.playing ? 'Pause' : 'Play', onclick: () => { if (r.step >= last) setReplayStep(0); replayPlay(!r.playing); } }, r.playing ? '❚❚' : '▶');
  readouts = { slider, step: stepEl, caption: captionEl, play: playEl };
  const bar = replayBarEl;
  bar.appendChild(h('div', { class: 'replay-title' }, h('strong', {}, `🎞 Replay`), ` · game ${sm.no} in "${r.doc.roomId}" · ${new Date(sm.endedAt).toLocaleDateString()}`));
  bar.appendChild(h('div', { class: 'replay-controls' },
      h('button', { class: 'small', title: 'Start', onclick: () => { replayPlay(false); setReplayStep(0); } }, '⏮'),
      h('button', { class: 'small', title: 'Back', onclick: () => { replayPlay(false); setReplayStep(r.step - 1); } }, '◀'),
      playEl,
      h('button', { class: 'small', title: 'Forward', onclick: () => { replayPlay(false); setReplayStep(r.step + 1); } }, '▶|'),
      h('button', { class: 'small', title: 'End', onclick: () => { replayPlay(false); setReplayStep(last); } }, '⏭'),
      h('select', { class: 'small', onchange: (e: Event) => { r.speed = Number((e.target as HTMLSelectElement).value); if (r.playing) replayPlay(true); } },
        ...[0.5, 1, 2, 4].map((sp) => h('option', { value: sp, selected: sp === r.speed }, `${sp}×`))),
      stepEl,
    ));
  bar.appendChild(slider);
  bar.appendChild(captionEl);
  bar.appendChild(h('div', { style: 'display:flex;gap:0.5rem;justify-content:center' },
      h('button', { class: 'small', onclick: () => navigate(`/r/${r.doc.roomId}`) }, 'Back to the table'),
      h('button', { class: 'small', onclick: () => navigate('/') }, 'Home'),
    ));
}

/** Everything that should happen *because the world changed* (sounds, toasts) is
 *  derived here by diffing the previous room document against the new one — the
 *  server never sends events, only state, so this is the one place that notices
 *  "a tile landed", "someone scored", "it's your turn now". */
