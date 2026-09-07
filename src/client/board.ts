import { getLegalPlacements, PLAYER_COLORS } from '../shared/engine.js';
import type { ScoreEvent } from '../shared/types.js';
import { getTileCanvas, getMeepleCanvas, type MeepleLook } from './art.js';
import { currentSkin, onSkinChange } from './skins/index.js';
import { drawAmbientUnder, drawAmbientOver, type AmbientView } from './ambient.js';
import { isMyTurn, room } from './room.js';
import { ghostTargets, hoveredGhost, pending, pendingPoints, previewRot, selectedGhost, skipHovered, skipPillRect } from './placement.js';
import { coarsePointer, kindNoun, roundRect } from './ui.js';
import { boardBounds, camera, hovered, worldToScreen, setUserAdjustedCamera } from './camera.js';
import { animateMeeples, showOwners } from './prefs.js';
import { meeplePose } from './wander.js';
import { POKE_MS, chats, drawBubble, maybeStartChats, meepleKey, pokes } from './life.js';

export const TILE_ART_SIZE = 128;
export let boardCanvasEl: HTMLCanvasElement | null = null;
export function setBoardCanvasEl(v: HTMLCanvasElement | null): void { boardCanvasEl = v; }
export let boardWrapEl: HTMLElement | null = null;
export function setBoardWrapEl(v: HTMLElement | null): void { boardWrapEl = v; }
export let particles: { x: number; y: number; vx: number; vy: number; color: string; size: number; rot: number; vr: number; life: number }[] = [];
export function setParticles(v: { x: number; y: number; vx: number; vy: number; color: string; size: number; rot: number; vr: number; life: number }[]): void { particles = v; }
export function zoomBy(factor: number): void {
  if (!boardCanvasEl) return;
  setUserAdjustedCamera(true);
  camera.scale = Math.max(28, Math.min(220, camera.scale * factor));
  drawBoard(boardCanvasEl);
}
export function resizeBoardCanvas(canvas: HTMLCanvasElement, wrap: HTMLElement): { w: number; h: number } {
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(200, rect.width * dpr);
  canvas.height = Math.max(200, rect.height * dpr);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: rect.width, h: rect.height };
}

export let tablePatternCache: { skinId: string; pattern: CanvasPattern } | null = null;
onSkinChange(() => { tablePatternCache = null; });
export function tablePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
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

export let scoreSpotlight: { tiles: Set<string>; fed: Set<string>; color: string; pinned: boolean } | null = null;
export function setScoreSpotlight(ev: ScoreEvent | null, pinned = false): void {
  if (!ev) { scoreSpotlight = null; }
  else {
    const color = room?.game?.players[ev.players[0] ?? -1]?.color ?? '#D4B85A';
    scoreSpotlight = { tiles: new Set(ev.tiles), fed: new Set(ev.fedTiles ?? []), color, pinned };
  }
  if (boardCanvasEl) drawBoard(boardCanvasEl);
}
/** Outline the outer boundary of a set of cells (edges with no lit neighbour). */
export function strokeCellGroup(ctx: CanvasRenderingContext2D, cells: Set<string>, cw: number, ch: number): void {
  const s = camera.scale;
  ctx.beginPath();
  for (const k of cells) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    const [sx, sy] = worldToScreen(x, y, cw, ch);
    if (!cells.has(`${x},${y - 1}`)) { ctx.moveTo(sx, sy); ctx.lineTo(sx + s, sy); }
    if (!cells.has(`${x + 1},${y}`)) { ctx.moveTo(sx + s, sy); ctx.lineTo(sx + s, sy + s); }
    if (!cells.has(`${x},${y + 1}`)) { ctx.moveTo(sx, sy + s); ctx.lineTo(sx + s, sy + s); }
    if (!cells.has(`${x - 1},${y}`)) { ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + s); }
  }
  ctx.stroke();
}

export function drawBoard(canvas: HTMLCanvasElement): void {
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
  if (scoreSpotlight) {
    // Dim everything that didn't score, then trace the scored feature in the scorer's colour.
    const s = camera.scale;
    const lit = new Set([...scoreSpotlight.tiles, ...scoreSpotlight.fed]);
    ctx.save();
    ctx.fillStyle = 'rgba(20, 30, 28, 0.5)';
    for (const k of Object.keys(board)) {
      if (lit.has(k)) continue;
      const [x, y] = k.split(',').map(Number) as [number, number];
      const [sx, sy] = worldToScreen(x, y, cw, ch);
      ctx.fillRect(sx, sy, s, s);
    }
    if (scoreSpotlight.fed.size) {
      ctx.strokeStyle = 'rgba(245,248,246,0.9)'; ctx.lineWidth = 2.5; ctx.setLineDash([7, 5]);
      strokeCellGroup(ctx, scoreSpotlight.fed, cw, ch);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = scoreSpotlight.color; ctx.lineWidth = 4;
    ctx.shadowColor = scoreSpotlight.color; ctx.shadowBlur = 12;
    ctx.lineJoin = 'round';
    strokeCellGroup(ctx, scoreSpotlight.tiles, cw, ch);
    ctx.restore();
  }

  const now = performance.now();
  const drawn: { key: string; kind: string; x: number; y: number; sx: number; sy: number }[] = [];
  for (const m of game.meeples) {
    const tile = board[`${m.x},${m.y}`];
    if (!tile) continue;
    const pose = meeplePose(m, tile.tileKey, tile.rot, now);
    const [sx, sy0] = worldToScreen(pose.x, pose.y, cw, ch);
    let sy = sy0;
    const size = camera.scale * 0.34;
    const player = game.players[m.playerIdx]!;
    const img = getMeepleCanvas(player.color, size, m.kind as MeepleLook);
    const mk = meepleKey(m);
    const poked = pokes.get(mk);
    let sq = 1;
    if (poked !== undefined && now - poked < POKE_MS) {
      // A startled hop: up and down on a sine, with a little squash on landing.
      const u = (now - poked) / POKE_MS;
      sy -= Math.sin(u * Math.PI) * size * 0.45;
      sq = u > 0.85 ? 1 - (1 - (u - 0.85) / 0.15) * 0.15 : 1;
    }
    drawn.push({ key: mk, kind: m.kind, x: pose.x, y: pose.y, sx, sy });
    ctx.save(); ctx.translate(sx, sy); ctx.scale(pose.flip ? -1 : 1, sq);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  if (animateMeeples && drawn.length > 1) maybeStartChats(drawn, now);
  for (const c of chats) {
    if (c.end <= now) continue;
    const size = camera.scale * 0.34;
    const A = drawn.find((d) => d.key === c.a), B = drawn.find((d) => d.key === c.b);
    if (A && now - c.start < (c.b ? 1800 : c.end - c.start)) drawBubble(ctx, c.textA, A.sx, A.sy, size);
    if (B && now - c.start >= 1100) drawBubble(ctx, c.textB, B.sx, B.sy, size);
  }
  // The living board: cloud shadows, cloister smoke, the light of the hour.
  const ambient: AmbientView | null = animateMeeples ? {
    ctx, cw, ch, scale: camera.scale, now, game,
    toScreen: (wx, wy) => worldToScreen(wx, wy, cw, ch),
    bounds: boardBounds(board), skinId: currentSkin().id,
  } : null;
  if (ambient) drawAmbientUnder(ambient);

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
    const pill = skipPillRect(cw, ch);
    if (pill) {
      // "Skip" lives right under the tile so the whole decision happens in one place.
      const hover = skipHovered;
      ctx.save();
      roundRect(ctx, pill.x, pill.y, pill.w, pill.h, pill.h / 2);
      ctx.fillStyle = hover ? 'rgba(245,248,246,0.98)' : 'rgba(245,248,246,0.86)';
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 6; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = hover ? 'rgba(31,46,43,0.9)' : 'rgba(31,46,43,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#1F2E2B'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.max(12, Math.min(16, pill.h * 0.5))}px "Space Grotesk", sans-serif`;
      ctx.fillText('✕ Skip', pill.x + pill.w / 2, pill.y + pill.h / 2 + 0.5);
      ctx.restore();
    }
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

  if (ambient) drawAmbientOver(ambient);
  drawParticles(ctx, cw, ch);
}

export function spawnConfetti(cw: number, _ch: number): void {
  for (let i = 0; i < 140; i++) {
    particles.push({
      x: Math.random() * cw, y: -20 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length]!, size: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, life: 260 + Math.random() * 120,
    });
  }
}
export function drawParticles(ctx: CanvasRenderingContext2D, cw: number, ch: number): void {
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
