import { TILE_TYPES } from '../shared/tiles.js';
import { getLegalPlacements, getMeepleOptions, placeMeeple, placeTile, skipMeeple } from '../shared/engine.js';
import type { MeepleKind } from '../shared/types.js';
import { h, toast } from './dom.js';
import { isMyTurn, room, send, setAwaitingMeepleDecision } from './room.js';
import { coarsePointer, kindNoun, paintMeepleSwatches } from './ui.js';
import { boardCanvasEl, drawBoard } from './board.js';
import { camera, worldToScreen } from './camera.js';
import { animateMeeples } from './prefs.js';
import { meepleSpots, type MeepleSpot } from './spots.js';

export let previewRot = 0;
export function setPreviewRot(v: typeof previewRot): void { previewRot = v; }

export let hoveredGhost: MeepleSpot | null = null;
export function setHoveredGhost(v: MeepleSpot | null): void { hoveredGhost = v; }
export let skipHovered = false;
export function setSkipHovered(v: typeof skipHovered): void { skipHovered = v; }
/** Touch flow: the zone tapped once (shown as a full meeple); a second tap places. */
export let selectedGhost: MeepleSpot | null = null;
export function setSelectedGhost(v: MeepleSpot | null): void { selectedGhost = v; }
export let ghostAnimFrame: number | null = null;
/** A tile set down but not yet confirmed: the player can still rotate or move it. */
export let pending: { x: number; y: number; rot: number } | null = null;
export function clearPending(): void { pending = null; }
export function legalRotsAt(x: number, y: number): number[] {
  if (!room?.game) return [];
  return getLegalPlacements(room.game).filter((p) => p.x === x && p.y === y).map((p) => p.rot);
}
export function setPending(x: number, y: number): boolean {
  const rots = legalRotsAt(x, y);
  if (!rots.length) return false;
  const pr = ((previewRot % 4) + 4) % 4;
  pending = { x, y, rot: rots.includes(pr) ? pr : rots[0]! };
  previewRot = pending.rot;
  renderPlacementBar();
  if (boardCanvasEl) drawBoard(boardCanvasEl);
  return true;
}
export function rotatePending(): void {
  if (!pending) { previewRot = (previewRot + 1) % 4; if (boardCanvasEl) drawBoard(boardCanvasEl); return; }
  const rots = legalRotsAt(pending.x, pending.y);
  if (rots.length <= 1) { toast('Only one way this tile fits here'); return; }
  const i = rots.indexOf(pending.rot);
  pending.rot = rots[(i + 1) % rots.length]!;
  previewRot = pending.rot;
  renderPlacementBar();
  if (boardCanvasEl) drawBoard(boardCanvasEl);
}
export function confirmPending(): void {
  if (!pending) return;
  setAwaitingMeepleDecision(true);
  send({ type: 'place_tile', x: pending.x, y: pending.y, rot: pending.rot });
  pending = null;
  renderPlacementBar();
}
export function cancelPending(): void { pending = null; renderPlacementBar(); if (boardCanvasEl) drawBoard(boardCanvasEl); }

/** The bar above the board during tile placement: a hint before the tile is set
 *  down, and Rotate / Place / Cancel once it is. Rebuilt in place so the board
 *  itself doesn't have to re-render. */
export let placementBarEl: HTMLElement | null = null;
export function setPlacementBarEl(v: HTMLElement | null): void { placementBarEl = v; }
export function renderPlacementBar(): void {
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

export let meepleBarEl: HTMLElement | null = null;
export function setMeepleBarEl(v: HTMLElement | null): void { meepleBarEl = v; }
export function renderMeepleBar(): void {
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

export function ensureGhostAnimation(): void {
  if (ghostAnimFrame !== null) return;
  const step = () => {
    ghostAnimFrame = null;
    if (!boardCanvasEl || !room?.game || !isMyTurn() || !(room.game.phase === 'placeMeeple' || (room.game.phase === 'placeTile' && pending))) return;
    if (!animateMeeples) drawBoard(boardCanvasEl); // otherwise the board loop already repaints
    ghostAnimFrame = requestAnimationFrame(step);
  };
  ghostAnimFrame = requestAnimationFrame(step);
}

/** The on-tile "Skip" pill during a meeple decision: sits just under the glowing tile. */
export function skipPillRect(cw: number, ch: number): { x: number; y: number; w: number; h: number } | null {
  const game = room?.game;
  if (!game || !isMyTurn() || game.phase !== 'placeMeeple' || !game.lastPlaced) return null;
  const [tx, ty] = worldToScreen(game.lastPlaced.x, game.lastPlaced.y, cw, ch);
  const s = camera.scale;
  const w = Math.max(64, s * 0.62), hgt = Math.max(24, s * 0.24);
  return { x: tx + s / 2 - w / 2, y: ty + s + 6, w, h: hgt };
}
export function skipPillAt(clientX: number, clientY: number, canvasEl: HTMLCanvasElement): boolean {
  const rect = canvasEl.getBoundingClientRect();
  const r = skipPillRect(rect.width, rect.height);
  if (!r) return false;
  const px = clientX - rect.left, py = clientY - rect.top;
  return px >= r.x - 4 && px <= r.x + r.w + 4 && py >= r.y - 4 && py <= r.y + r.h + 4;
}

export function ghostAt(clientX: number, clientY: number, canvasEl: HTMLCanvasElement): MeepleSpot | null {
  const rect = canvasEl.getBoundingClientRect();
  const px = clientX - rect.left, py = clientY - rect.top;
  let best: { spot: MeepleSpot; d: number } | null = null;
  for (const g of ghostTargets(rect.width, rect.height)) {
    const d = Math.hypot(g.sx - px, g.sy - py);
    if (d <= Math.max(20, g.size * 0.6) && (!best || d < best.d)) best = { spot: g.spot, d };
  }
  return best?.spot ?? null;
}

export function ghostTargets(cw: number, ch: number): { spot: MeepleSpot; sx: number; sy: number; size: number; label: string; instant: number }[] {
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
export let instantCache: { turn: number; values: Map<string, number> } | null = null;
export function instantPoints(kind: MeepleKind, idx: number): number {
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
export let pendingPointsCache: { key: string; value: number } | null = null;
export function pendingPoints(): number {
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
    // Count only what this tile completes. If it is the last tile the engine also
    // runs end-of-game scoring, and that pile of points isn't "for placing this tile".
    const before = game.scoreEvents?.length ?? 0;
    gained = (trial.scoreEvents ?? []).slice(0, (trial.scoreEvents?.length ?? 0) - before)
      .filter((ev) => !ev.final && ev.players.includes(me))
      .reduce((sum, ev) => sum + ev.points, 0);
  } catch { gained = 0; }
  pendingPointsCache = { key, value: gained };
  return gained;
}
