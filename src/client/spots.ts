import { TILE_TYPES, rotateGroupSides, rotateSlot } from '../shared/tiles.js';
import type { MeepleKind } from '../shared/types.js';
import { monasteryCenter } from './skins/geometry.js';

export interface MeepleSpot { kind: MeepleKind; idx: number; x: number; y: number }

export function rawMeepleAnchor(tileKey: string, rot: number, kind: string, idx: number): [number, number] {
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

export const meepleSpotCache = new Map<string, MeepleSpot[]>();
/** Every place a meeple can stand on this tile (one per feature), spread apart so two
 *  never sit on top of each other. Used both for drawing placed meeples and for the
 *  click-to-place ghosts, so what you click is exactly where the meeple will appear. */
export function meepleSpots(tileKey: string, rot: number): MeepleSpot[] {
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

export function meepleAnchor(tileKey: string, rot: number, kind: string, idx: number): [number, number] {
  const s = meepleSpots(tileKey, rot).find((sp) => sp.kind === kind && sp.idx === idx);
  return s ? [s.x, s.y] : [0.5, 0.5];
}

/** Ghost meeples the current player can click, in screen space. */
