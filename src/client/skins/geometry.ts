// Shared drawing geometry for the procedural tilesets. Everything here follows the
// same edge contract as the hand-drawn SVG art (docs/tile-geometry-contract.md):
// a 200×200 canonical tile, city petals spanning 16%–84% of their edge, roads
// occupying the middle 20% — so a tile painted by any skin seams correctly with
// its neighbours, and with the original SVG set, at every edge.
import { TILE_TYPES } from '../../shared/tiles.js';
import type { TileType } from '../../shared/types.js';

export const SIZE = 200;
export const ROAD_W = 40;
export const HUB_R = 60;
export const JUNCTION_R = 24;

export type Pt = [number, number];

/** Small deterministic PRNG so every copy of a tile type decorates identically. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = h >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
}

/** A city petal on one side. `insetLeft`/`insetRight` control how far each inner
 *  corner is pulled toward the middle: petals on adjacent sides touch at the tile
 *  corner with the default taper, so a petal facing a *rival* city on the next side
 *  is tapered harder there, leaving a clear strip of field between the two. */
export function petalPoints(side: number, insetLeft = 20, insetRight = 20): Pt[] {
  const m = 32, d = 92;
  const byN: Pt[] = [[m, 0], [SIZE - m, 0], [SIZE - m - insetRight, d], [m + insetLeft, d]];
  if (side === 0) return byN;
  if (side === 2) return byN.map(([x, y]) => [SIZE - x, SIZE - y]);
  if (side === 1) return byN.map(([x, y]) => [SIZE - y, x]);
  return byN.map(([x, y]) => [y, SIZE - x]);
}

const RIVAL_INSET = 62;
/** Petal for `side` within its city group, tapered away from any rival city group
 *  on a neighbouring side. Neighbour (side+1) is on the petal's "right" end. */
function groupPetal(t: TileType, gi: number, side: number): Pt[] {
  const groupOf = (s: number) => t.cityGroups.findIndex((g) => g.includes(s));
  const right = (side + 1) % 4, left = (side + 3) % 4;
  const rivalRight = groupOf(right) !== -1 && groupOf(right) !== gi;
  const rivalLeft = groupOf(left) !== -1 && groupOf(left) !== gi;
  return petalPoints(side, rivalLeft ? RIVAL_INSET : 20, rivalRight ? RIVAL_INSET : 20);
}

const MID: Pt[] = [[100, 0], [200, 100], [100, 200], [0, 100]];
const CORNERS: Record<string, Pt> = { '0,1': [200, 0], '1,2': [200, 200], '2,3': [0, 200], '0,3': [0, 0] };

/** One city region (petals plus the central hub when the petals connect) as a single
 *  path, so a fill or clip covers the union exactly once. */
export function cityPath(t: TileType, gi: number): Path2D {
  const p = new Path2D();
  const grp = t.cityGroups[gi]!;
  for (const side of grp) {
    const pts = groupPetal(t, gi, side);
    p.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i]![0], pts[i]![1]);
    p.closePath();
  }
  const corner = cornerKeep(grp);
  if (corner) {
    // Two petals meeting at a corner: join them with a keep tucked into that corner
    // rather than a hub at the tile centre, so a road bending around the other
    // corners visibly goes *past* the city instead of vanishing underneath it.
    const { cx, cy, r, wedge } = corner;
    p.moveTo(wedge[0]![0], wedge[0]![1]);
    for (let i = 1; i < wedge.length; i++) p.lineTo(wedge[i]![0], wedge[i]![1]);
    p.closePath();
    p.moveTo(cx + r, cy); p.arc(cx, cy, r, 0, Math.PI * 2);
  } else if (grp.length > 1) {
    p.moveTo(160, 100); p.arc(100, 100, HUB_R, 0, Math.PI * 2);
  }
  return p;
}

/** For a connected pair of adjacent petals, the keep that joins them: a round
 *  tower centred 55% of the way from the shared corner toward the tile centre,
 *  plus a wedge filling the corner between the two petal edges. */
function cornerKeep(grp: number[]): { cx: number; cy: number; r: number; wedge: Pt[] } | null {
  if (grp.length !== 2) return null;
  const [a, b] = [...grp].sort((x, y) => x - y) as [number, number];
  const key = `${a},${b}`;
  const corner = CORNERS[key];
  if (!corner) return null; // opposite sides: no shared corner
  const [kx, ky] = corner;
  const cx = kx + (100 - kx) * 0.55, cy = ky + (100 - ky) * 0.55;
  const nearest = (side: number): Pt => petalPoints(side).reduce((best, pt) => (Math.hypot(pt[0] - kx, pt[1] - ky) < Math.hypot(best[0] - kx, best[1] - ky) ? pt : best));
  // Same (clockwise) winding as the petals, so the union fills without holes.
  return { cx, cy, r: 38, wedge: [corner, nearest(b), [cx, cy], nearest(a)] };
}

/** Where a shield (or any "centre of the city" ornament) belongs on this tile. */
export function shieldAnchor(t: TileType): Pt {
  for (const grp of t.cityGroups) { const k = cornerKeep(grp); if (k) return [k.cx, k.cy]; }
  return [100, 100];
}

export function allCitiesPath(t: TileType): Path2D {
  const p = new Path2D();
  t.cityGroups.forEach((_, gi) => p.addPath(cityPath(t, gi)));
  return p;
}

/** Centre line of one road segment. */
export function roadPath(t: TileType, gi: number): Path2D {
  const grp = t.roadGroups[gi]!;
  const p = new Path2D();
  const [ax, ay] = MID[grp[0]!]!;
  p.moveTo(ax, ay);
  if (grp.length === 2) {
    const b = grp[1]!;
    const [bx, by] = MID[b]!;
    if ((grp[0]! + 2) % 4 === b) p.lineTo(bx, by);
    else {
      const [cx, cy] = CORNERS[[grp[0]!, b].sort((x, y) => x - y).join(',')]!;
      // Quarter circle around the corner: matches the hand-drawn bends exactly.
      const r = 100;
      const startAngle = Math.atan2(ay - cy, ax - cx), endAngle = Math.atan2(by - cy, bx - cx);
      let delta = endAngle - startAngle;
      if (delta > Math.PI) delta -= Math.PI * 2; if (delta < -Math.PI) delta += Math.PI * 2;
      p.arc(cx, cy, r, startAngle, endAngle, delta < 0);
    }
  } else {
    p.lineTo(100, 100);
  }
  return p;
}

export function allRoadsPath(t: TileType): Path2D {
  const p = new Path2D();
  t.roadGroups.forEach((_, gi) => p.addPath(roadPath(t, gi)));
  return p;
}

export function hasJunction(t: TileType): boolean { return t.roadGroups.length >= 3; }

export interface Layout {
  t: TileType;
  cities: Path2D;
  roads: Path2D;
  /** True when (x,y) is clear of every city, road, monastery footprint and junction. */
  isOpenField(ctx: CanvasRenderingContext2D, x: number, y: number, pad?: number): boolean;
}

export function layoutFor(key: string): Layout {
  const t = TILE_TYPES[key]!;
  const cities = allCitiesPath(t);
  const roads = allRoadsPath(t);
  return {
    t, cities, roads,
    isOpenField(ctx, x, y, pad = 8) {
      if (x < pad || y < pad || x > SIZE - pad || y > SIZE - pad) return false;
      const probe: Pt[] = [[x, y], [x - pad, y], [x + pad, y], [x, y - pad], [x, y + pad]];
      ctx.save();
      ctx.lineWidth = ROAD_W + pad * 2;
      const bad = probe.some(([px, py]) => ctx.isPointInPath(cities, px, py) || (t.roadGroups.length > 0 && ctx.isPointInStroke(roads, px, py)));
      ctx.restore();
      if (bad) return false;
      if (t.monastery && Math.abs(x - 100) < 44 + pad && Math.abs(y - 100) < 34 + pad) return false;
      if (hasJunction(t) && Math.hypot(x - 100, y - 100) < JUNCTION_R + 18 + pad) return false;
      return true;
    },
  };
}

/** Scatter n candidate points and keep those on open field, deterministically. */
export function scatterOpen(ctx: CanvasRenderingContext2D, L: Layout, rng: () => number, n: number, pad = 8): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n * 4 && out.length < n; i++) {
    const x = 10 + rng() * 180, y = 10 + rng() * 180;
    if (!L.isOpenField(ctx, x, y, pad)) continue;
    if (out.some(([ox, oy]) => Math.hypot(ox - x, oy - y) < pad * 2)) continue;
    out.push([x, y]);
  }
  return out;
}

/** Positions inside a city region for buildings of the given half-size. */
export function cityInteriorSpots(ctx: CanvasRenderingContext2D, city: Path2D, rng: () => number, n: number, half: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n * 8 && out.length < n; i++) {
    const x = 8 + rng() * 184, y = 8 + rng() * 184;
    const corners: Pt[] = [[x - half, y - half], [x + half, y - half], [x - half, y + half], [x + half, y + half]];
    if (!corners.every(([cx, cy]) => ctx.isPointInPath(city, cx, cy))) continue;
    if (out.some(([ox, oy]) => Math.abs(ox - x) < half * 2.3 && Math.abs(oy - y) < half * 2.3)) continue;
    out.push([x, y]);
  }
  return out;
}

export function strokeRoad(ctx: CanvasRenderingContext2D, roads: Path2D, width: number, style: string, dash: number[] = []): void {
  ctx.save();
  ctx.lineWidth = width; ctx.strokeStyle = style; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  ctx.setLineDash(dash);
  ctx.stroke(roads);
  ctx.restore();
}

/** Stroke the outer boundary of every city region — and only the outer boundary:
 *  a connected city is the union of several shapes, and stroking each shape would
 *  draw their shared edges through the middle of the city. The wall is drawn at
 *  double width on a scratch layer, the city interior is erased from it, and what
 *  remains is a band of `width` hugging the outside of the union. Nothing lands on
 *  the tile's own edge, so two halves of one city never show a seam. */
export function strokeWalls(ctx: CanvasRenderingContext2D, t: TileType, width: number, style: string, dash: number[] = [], shadow?: { color: string; blur: number }): void {
  if (t.cityGroups.length === 0) return;
  const layer = document.createElement('canvas');
  layer.width = ctx.canvas.width; layer.height = ctx.canvas.height;
  const c2 = layer.getContext('2d')!;
  c2.setTransform(ctx.getTransform());
  c2.lineWidth = width * 2; c2.strokeStyle = style; c2.lineJoin = 'round'; c2.setLineDash(dash);
  t.cityGroups.forEach((_, gi) => c2.stroke(cityPath(t, gi)));
  c2.globalCompositeOperation = 'destination-out';
  c2.fillStyle = '#000';
  t.cityGroups.forEach((_, gi) => c2.fill(cityPath(t, gi)));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (shadow) { ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur; }
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function shieldPath(cx: number, cy: number, s = 1): Path2D {
  const p = new Path2D();
  p.moveTo(cx - 14 * s, cy - 16 * s); p.lineTo(cx + 14 * s, cy - 16 * s); p.lineTo(cx + 14 * s, cy + 3 * s);
  p.quadraticCurveTo(cx + 13 * s, cy + 14 * s, cx, cy + 21 * s);
  p.quadraticCurveTo(cx - 13 * s, cy + 14 * s, cx - 14 * s, cy + 3 * s);
  p.closePath();
  return p;
}
