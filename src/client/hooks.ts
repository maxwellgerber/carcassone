import { TILE_TYPES } from '../shared/tiles.js';
import { getLegalPlacements } from '../shared/engine.js';
import { getTileCanvas, getMeepleCanvas, type MeepleLook } from './art.js';
import { ambientStatus, setAmbientOverride } from './ambient.js';
import { isMyTurn, room } from './room.js';
import { ghostTargets, pending, previewRot, skipPillRect } from './placement.js';
import { boardCanvasEl } from './board.js';
import { worldToScreen } from './camera.js';
import { meeplePose, walkPathFor } from './wander.js';
import { chats, meepleKey, pokes } from './life.js';

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
  poses: () => {
    const game = room?.game; if (!game || !boardCanvasEl) return [];
    const r = boardCanvasEl.getBoundingClientRect();
    const now = performance.now();
    return game.meeples.map((m) => {
      const tile = game.board[`${m.x},${m.y}`]; if (!tile) return null;
      const p = meeplePose(m, tile.tileKey, tile.rot, now);
      const [sx, sy] = worldToScreen(p.x, p.y, r.width, r.height);
      const wp = walkPathFor(m, tile.tileKey, tile.rot);
      return { key: meepleKey(m), kind: m.kind, x: p.x, y: p.y, sx: sx + r.left, sy: sy + r.top, route: wp.pts, loop: wp.loop };
    }).filter((p) => p !== null);
  },
  toScreen: (wx: number, wy: number) => {
    if (!boardCanvasEl) return [0, 0];
    const r = boardCanvasEl.getBoundingClientRect();
    const [sx, sy] = worldToScreen(wx, wy, r.width, r.height);
    return [sx + r.left, sy + r.top];
  },
  chats: () => chats.length,
  ambient: () => room?.game ? ambientStatus(room.game) : null,
  setAmbient: (o: Parameters<typeof setAmbientOverride>[0]) => setAmbientOverride(o),
  pokes: () => pokes.size,
  skipPill: () => {
    if (!boardCanvasEl) return null;
    const r = boardCanvasEl.getBoundingClientRect();
    const p = skipPillRect(r.width, r.height);
    return p ? { sx: r.left + p.x + p.w / 2, sy: r.top + p.y + p.h / 2 } : null;
  },
  previewRot: () => ((previewRot % 4) + 4) % 4,
  pending: () => pending,
  meeple: (color: string, size: number, look: MeepleLook) => getMeepleCanvas(color, size, look),
  tileTypes: () => TILE_TYPES,
  tileCanvas: (key: string, rot: number, size: number) => getTileCanvas(key, rot, size),
};
