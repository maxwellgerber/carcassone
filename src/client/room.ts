import type { RoomDoc } from '../shared/room-types.js';
import { h, toast } from './dom.js';
import { sfxTilePlaced, sfxMeeplePlaced, sfxScore, sfxYourTurn, sfxGameOver } from './audio.js';
import { me, refreshMe } from './session.js';
import { root } from './router.js';
import { setPreviewRot, clearPending } from './placement.js';
import { replay, setReplay } from './replay.js';
import { renderLobby } from './lobby.js';
import { paintMeepleSwatches } from './ui.js';
import { setBoardCanvasEl, setBoardWrapEl, setParticles } from './board.js';
import { setHovered, setUserAdjustedCamera } from './camera.js';
import { renderGame, setEndModalDismissed } from './game-view.js';
import { rememberWalkers, walkCache } from './wander.js';

export let socket: WebSocket | null = null;
export let room: RoomDoc | null = null;
export function setRoom(v: RoomDoc | null): void { room = v; }
export let connStatus: 'connecting' | 'connected' | 'disconnected' | 'unauthorized' = 'connecting';
export function setConnStatus(v: 'connecting' | 'connected' | 'disconnected' | 'unauthorized'): void { connStatus = v; }
export let currentRoomId: string | null = null;
export function setCurrentRoomId(v: string | null): void { currentRoomId = v; }
export function teardownRoom(): void {
  if (socket) { try { socket.close(); } catch { /* ignore */ } socket = null; }
  if (replay?.timer) clearInterval(replay.timer);
  setReplay(null);
  room = null; currentRoomId = null; connStatus = 'connecting';
  setBoardCanvasEl(null); setBoardWrapEl(null); setHovered(null);
  setUserAdjustedCamera(false);
  setParticles([]);
}

export async function mountRoom(roomId: string): Promise<void> {
  await refreshMe();
  if (!me.signedIn) { window.location.href = `/auth/login?next=${encodeURIComponent(location.pathname)}`; return; }
  currentRoomId = roomId;
  connectSocket(roomId);
  renderRoom();
}

export function connectSocket(roomId: string): void {
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
      if (room.game && (room.game.currentTile !== prev?.game?.currentTile || room.game.turnNumber !== prev?.game?.turnNumber)) { setPreviewRot(0); clearPending(); }
      if (room.phase === 'lobby' || (prev?.phase !== 'playing' && room.phase === 'playing')) { setEndModalDismissed(false); }
      // Walk routes span whole features, so any new tile can extend them.
      if (Object.keys(room.game?.board ?? {}).length !== Object.keys(prev?.game?.board ?? {}).length) {
        // Note where everyone stands (against the old board) before the routes are rebuilt.
        const cur = room; room = prev; try { rememberWalkers(); } finally { room = cur; }
        walkCache.clear();
      }
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

export function send(obj: Record<string, unknown>): void { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj)); }

export let awaitingMeepleDecision = false; // set when we place a tile, cleared on the next sync
export function setAwaitingMeepleDecision(v: typeof awaitingMeepleDecision): void { awaitingMeepleDecision = v; }
export function reactToSync(prev: RoomDoc | null, next: RoomDoc): void {
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

export function renderRoom(): void {
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

export function isMyTurn(): boolean {
  if (!room?.game || room.game.phase === 'gameover') return false;
  return room.game.players[room.game.currentPlayer]?.id === me.sub;
}
