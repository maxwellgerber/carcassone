import type { RoomDoc } from '../shared/room-types.js';
import { room } from './room.js';

export let camera = { x: 0.5, y: 0.5, scale: 90 };
export let userAdjustedCamera = false;
export function setUserAdjustedCamera(v: typeof userAdjustedCamera): void { userAdjustedCamera = v; }
export let hovered: { x: number; y: number } | null = null;
export function setHovered(v: { x: number; y: number } | null): void { hovered = v; }
export function boardBounds(board: RoomDoc['game'] extends null ? never : NonNullable<RoomDoc['game']>['board']) {
  const keys = Object.keys(board);
  if (keys.length === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of keys) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function fitCamera(canvasW: number, canvasH: number): void {
  if (!room?.game) return;
  const b = boardBounds(room.game.board);
  const w = b.maxX - b.minX + 3, hh = b.maxY - b.minY + 3;
  const scale = Math.max(30, Math.min(140, Math.min(canvasW / w, canvasH / hh)));
  camera = { x: (b.minX + b.maxX + 1) / 2, y: (b.minY + b.maxY + 1) / 2, scale };
}

export function worldToScreen(wx: number, wy: number, cw: number, ch: number): [number, number] {
  return [cw / 2 + (wx - camera.x) * camera.scale, ch / 2 + (wy - camera.y) * camera.scale];
}
export function screenToWorld(sx: number, sy: number, cw: number, ch: number): [number, number] {
  return [(sx - cw / 2) / camera.scale + camera.x, (sy - ch / 2) / camera.scale + camera.y];
}
