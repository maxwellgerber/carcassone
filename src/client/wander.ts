import { TILE_TYPES } from '../shared/tiles.js';
import type { RoomDoc } from '../shared/room-types.js';
import type { MeepleKind } from '../shared/types.js';
import { room } from './room.js';
import { boardCanvasEl, drawBoard } from './board.js';
import { dragState } from './game-view.js';
import { animateMeeples } from './prefs.js';
import { meepleAnchor } from './spots.js';
import { meepleKey } from './life.js';

export interface WalkPath {
  pts: [number, number][]; cum: number[]; length: number; loop: boolean; speed: number; phase: number;
  /** Gait: walk for `walkSec`, rest for `restSec`, repeat — seeded per meeple so the crowd never marches in step. */
  walkSec: number; restSec: number; bobRate: number;
  /** Progress anchor: at wall-clock `t0` (ms) the walker was `d0` along the cycle
   *  (0..length for loops, 0..2*length for out-and-back). New routes inherit the
   *  spot the meeple was standing on, so a tile landing never makes it jump. */
  t0: number; d0: number;
}
/** Where each walker stood when its route was last thrown away, keyed like walkCache. */
export const carryOver = new Map<string, { x: number; y: number; forward: boolean }>();
/** Seconds this walker has actually spent walking (rests dropped) by wall-clock `nowMs`. */
export function walkedSeconds(wp: { walkSec: number; restSec: number; phase: number }, nowMs: number): { walked: number; walking: boolean } {
  const cycle = wp.walkSec + wp.restSec;
  const elapsed = nowMs / 1000 + wp.phase * cycle * 3;
  const full = Math.floor(elapsed / cycle), rem = elapsed - full * cycle;
  return { walked: full * wp.walkSec + Math.min(rem, wp.walkSec), walking: rem < wp.walkSec };
}
/** Distance along a polyline of the point nearest to (x, y). */
export function nearestAlong(pts: [number, number][], cum: number[], x: number, y: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
    const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L)) : 0;
    const dd = Math.hypot(x - (ax + vx * t), y - (ay + vy * t));
    if (dd < bestD) { bestD = dd; best = cum[i - 1]! + (cum[i]! - cum[i - 1]!) * t; }
  }
  return best;
}
/** Remember where every walker is right now, so rebuilt routes can resume there. */
export function rememberWalkers(): void {
  const game = room?.game; if (!game) return;
  const now = performance.now();
  for (const m of game.meeples) {
    const tile = game.board[`${m.x},${m.y}`]; if (!tile) continue;
    const k = meepleKey(m);
    if (!walkCache.has(k)) continue;
    const p = meeplePose(m, tile.tileKey, tile.rot, now);
    carryOver.set(k, { x: p.x, y: p.y + p.bob, forward: p.forward });
  }
}
export const walkCache = new Map<string, WalkPath>();

export function rotatePt([x, y]: [number, number], rot: number): [number, number] {
  let px = x, py = y;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) { const nx = 1 - py, ny = px; px = nx; py = ny; }
  return [px, py];
}

/** Untrimmed road centreline for one road group, tile-local and rotated: runs from
 *  the group's first absolute side to its second side (or the tile centre). */
export function roadPolylineRaw(tileKey: string, rot: number, idx: number): [number, number][] {
  const grp = TILE_TYPES[tileKey]!.roadGroups[idx]!;
  const MID: [number, number][] = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
  const pts: [number, number][] = [];
  const a = grp[0]!;
  if (grp.length === 2) {
    const b = grp[1]!;
    if ((a + 2) % 4 === b) { pts.push(MID[a]!, MID[b]!); }
    else {
      // Quarter circle around the shared corner, matching how every skin draws bends.
      const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
      const corner: [number, number] = lo === 0 && hi === 3 ? [0, 0] : lo === 0 ? [1, 0] : lo === 1 ? [1, 1] : [0, 1];
      const [ax, ay] = MID[a]!, [bx, by] = MID[b]!;
      const a0 = Math.atan2(ay - corner[1], ax - corner[0]), a1 = Math.atan2(by - corner[1], bx - corner[0]);
      let d = a1 - a0; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      for (let i = 0; i <= 12; i++) { const t = a0 + (d * i) / 12; pts.push([corner[0] + Math.cos(t) * 0.5, corner[1] + Math.sin(t) * 0.5]); }
    }
  } else {
    pts.push(MID[a]!, [0.5, 0.5]);
  }
  return pts.map((p) => rotatePt(p, rot));
}

export const shrinkPt = (p: [number, number], q: [number, number], k: number): [number, number] => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
export type ClientBoard = NonNullable<RoomDoc['game']>['board'];
export const SIDE_MID: [number, number][] = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
export const SIDE_OPP = [2, 3, 0, 1];
export const SIDE_D = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function roadGroupAt(board: ClientBoard, x: number, y: number, absSide: number): number {
  const t = board[`${x},${y}`]; if (!t) return -1;
  return TILE_TYPES[t.tileKey]!.roadGroups.findIndex((grp) => grp.some((sd) => (sd + t.rot) % 4 === absSide));
}
export function roadSidesAbs(board: ClientBoard, x: number, y: number, g: number): number[] {
  const t = board[`${x},${y}`]!;
  return TILE_TYPES[t.tileKey]!.roadGroups[g]!.map((sd) => (sd + t.rot) % 4);
}
export interface RoadStep { x: number; y: number; g: number; entry: number | null; exit: number | null }
/** Follow a road from one tile's group out through `exit`, tile by tile, until it ends
 *  (open edge or a junction/village centre) or loops back to where it began. */
export function roadChain(board: ClientBoard, x: number, y: number, g: number, exit: number): { steps: RoadStep[]; loop: boolean } {
  const sides0 = roadSidesAbs(board, x, y, g);
  const steps: RoadStep[] = [{ x, y, g, entry: sides0.find((sd) => sd !== exit) ?? null, exit }];
  let cx = x, cy = y, cexit = exit;
  for (let guard = 0; guard < 200; guard++) {
    const nx = cx + SIDE_D[cexit]![0]!, ny = cy + SIDE_D[cexit]![1]!;
    const ng = roadGroupAt(board, nx, ny, SIDE_OPP[cexit]!);
    if (ng < 0) return { steps, loop: false };
    if (nx === x && ny === y && ng === g) return { steps, loop: true };
    const entry = SIDE_OPP[cexit]!;
    const nsides = roadSidesAbs(board, nx, ny, ng);
    const other = nsides.find((sd) => sd !== entry);
    steps.push({ x: nx, y: ny, g: ng, entry, exit: other ?? null });
    if (other === undefined) return { steps, loop: false };
    cx = nx; cy = ny; cexit = other;
  }
  return { steps, loop: false };
}
/** The whole road this meeple stands on, as one world-space polyline. */
export function roadRoute(board: ClientBoard, x: number, y: number, g: number): { pts: [number, number][]; loop: boolean } {
  const sides = roadSidesAbs(board, x, y, g);
  const back = roadChain(board, x, y, g, sides[0]!);
  let steps: RoadStep[]; let loop = false;
  if (back.loop) { steps = back.steps; loop = true; }
  else {
    const far = back.steps[back.steps.length - 1]!;
    // Turn around at the far end and walk the road forward through the start tile.
    const fwdExit = far.entry;
    if (fwdExit === null) steps = [far]; // a one-tile road stub ending in its own centre
    else steps = roadChain(board, far.x, far.y, far.g, fwdExit).steps;
  }
  const pts: [number, number][] = [];
  for (const st of steps) {
    const t = board[`${st.x},${st.y}`]!;
    let seg = roadPolylineRaw(t.tileKey, t.rot, st.g);
    const absFirst = roadSidesAbs(board, st.x, st.y, st.g)[0]!;
    // Raw runs first-side -> second-side/centre; flip it so we enter through `entry`.
    const enterAtFirst = st.entry === absFirst || (st.entry === null && absFirst !== st.exit);
    if (!enterAtFirst) seg = [...seg].reverse();
    for (const p of seg) {
      const w: [number, number] = [st.x + p[0], st.y + p[1]];
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(last[0] - w[0], last[1] - w[1]) > 1e-4) pts.push(w);
    }
  }
  if (!loop && pts.length >= 2) {
    const first = steps[0]!, last = steps[steps.length - 1]!;
    pts[0] = shrinkPt(pts[0]!, pts[1]!, first.entry === null ? 0.35 : 0.18);
    const n = pts.length - 1;
    pts[n] = shrinkPt(pts[n]!, pts[n - 1]!, last.exit === null ? 0.35 : 0.18);
  }
  return { pts, loop };
}

export function cityGroupAt(board: ClientBoard, x: number, y: number, absSide: number): number {
  const t = board[`${x},${y}`]; if (!t) return -1;
  return TILE_TYPES[t.tileKey]!.cityGroups.findIndex((grp) => grp.some((sd) => (sd + t.rot) % 4 === absSide));
}
/** A stroll through every tile of the city: a depth-first tour that crosses walls at
 *  the shared edges and comes back the way it went, so it closes into a loop. */
export function cityTour(board: ClientBoard, x: number, y: number, g: number): [number, number][] {
  const anchor = (tx: number, ty: number, tg: number): [number, number] => {
    const t = board[`${tx},${ty}`]!;
    const [ax, ay] = meepleAnchor(t.tileKey, t.rot, 'city', tg);
    return [tx + ax, ty + ay];
  };
  const seen = new Set<string>();
  const pts: [number, number][] = [anchor(x, y, g)];
  const visit = (tx: number, ty: number, tg: number): void => {
    seen.add(`${tx},${ty}|${tg}`);
    const t = board[`${tx},${ty}`]!;
    for (const sd of TILE_TYPES[t.tileKey]!.cityGroups[tg]!) {
      const abs = (sd + t.rot) % 4;
      const nx = tx + SIDE_D[abs]![0]!, ny = ty + SIDE_D[abs]![1]!;
      const ng = cityGroupAt(board, nx, ny, SIDE_OPP[abs]!);
      if (ng < 0 || seen.has(`${nx},${ny}|${ng}`)) continue;
      const gate: [number, number] = [tx + SIDE_MID[abs]![0]!, ty + SIDE_MID[abs]![1]!];
      pts.push(gate, anchor(nx, ny, ng));
      visit(nx, ny, ng);
      pts.push(gate, anchor(tx, ty, tg));
    }
  };
  visit(x, y, g);
  return pts;
}

export function walkPathFor(m: { x: number; y: number; kind: MeepleKind; idx: number; playerIdx: number }, tileKey: string, rot: number): WalkPath {
  const key = `${m.x},${m.y}|${m.kind}|${m.idx}|${m.playerIdx}`;
  const hit = walkCache.get(key);
  if (hit) return hit;
  const [ax, ay] = meepleAnchor(tileKey, rot, m.kind, m.idx);
  const seed = ((m.x * 73856093) ^ (m.y * 19349663) ^ (m.idx * 83492791) ^ (m.playerIdx * 2654435761)) >>> 0;
  const phase = (seed % 1000) / 1000;
  // A few more seeded dice so each meeple has its own pace, stride and habit of dawdling.
  const dice = (n: number) => (((seed >>> (n * 5)) ^ (seed * (n + 3))) >>> 0) % 1000 / 1000;
  const pace = 0.7 + dice(1) * 0.7;          // 0.7x .. 1.4x speed
  const walkSec = 3 + dice(2) * 7;           // walk 3 .. 10 s
  const restSec = 1 + dice(3) * 3.5;         // then stand 1 .. 4.5 s
  const bobRate = 120 + dice(4) * 60;        // stride period
  const board = room?.game?.board ?? {};
  let pts: [number, number][] = [];
  let loop = true, speed = 0.05; // tile units per second
  if (m.kind === 'road') { const r = roadRoute(board, m.x, m.y, m.idx); pts = r.pts; loop = r.loop; speed = 0.07; }
  else if (m.kind === 'city') {
    const tour = cityTour(board, m.x, m.y, m.idx);
    if (tour.length > 1) { pts = tour; speed = 0.065; }
    else { for (let i = 0; i <= 16; i++) { const t = (i / 16) * Math.PI * 2; pts.push([m.x + ax + Math.cos(t) * 0.075, m.y + ay + Math.sin(t) * 0.045]); } speed = 0.045; }
  }
  else if (m.kind === 'monastery') { const r = TILE_TYPES[tileKey]!.river ? 0.13 : 0.2; for (let i = 0; i <= 20; i++) { const t = (i / 20) * Math.PI * 2; pts.push([m.x + ax + Math.cos(t) * r, m.y + ay + 0.03 + Math.sin(t) * r * 0.8]); } speed = 0.06; }
  else { pts = [[m.x + ax, m.y + ay]]; speed = 0; }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const length = cum[cum.length - 1]!;
  const t0 = performance.now();
  let d0 = phase * length * 2;
  const prev = carryOver.get(key);
  if (prev && pts.length > 1) {
    // Resume from the spot the walker was standing on, heading the same way.
    const d = nearestAlong(pts, cum, prev.x, prev.y);
    d0 = loop || prev.forward ? d : length * 2 - d;
    carryOver.delete(key);
  }
  const wp: WalkPath = { pts, cum, length, loop, speed: speed * pace, phase, walkSec, restSec, bobRate, t0, d0 };
  walkCache.set(key, wp);
  return wp;
}

/** Where a meeple is right now, in world (tile-grid) units, plus which way it faces. */
export function meeplePose(m: { x: number; y: number; kind: MeepleKind; idx: number; playerIdx: number }, tileKey: string, rot: number, now: number): { x: number; y: number; flip: boolean; bob: number; forward: boolean } {
  const wp = walkPathFor(m, tileKey, rot);
  if (!animateMeeples || wp.length === 0 || wp.speed === 0) {
    const p = wp.pts[0]!;
    const rock = animateMeeples && m.kind === 'farm' ? Math.sin(now / 900 + wp.phase * 6) * 0.004 : 0;
    return { x: p[0], y: p[1] + rock, flip: false, bob: 0, forward: true };
  }
  // Time actually spent walking since the route was built: the gait cycle drops the
  // rests, so the meeple stops on the path for a moment and then carries on.
  const { walked, walking } = walkedSeconds(wp, now);
  const t = (walked - walkedSeconds(wp, wp.t0).walked) * wp.speed + wp.d0;
  let d: number, forward = true;
  if (wp.loop) d = t % wp.length;
  else { const cycle = t % (wp.length * 2); if (cycle <= wp.length) d = cycle; else { d = wp.length * 2 - cycle; forward = false; } }
  let i = 1; while (i < wp.cum.length - 1 && wp.cum[i]! < d) i++;
  const seg0 = wp.cum[i - 1]!, seg1 = wp.cum[i]!;
  const k = seg1 > seg0 ? (d - seg0) / (seg1 - seg0) : 0;
  const p = wp.pts[i - 1]!, q = wp.pts[i]!;
  const dx = (q[0] - p[0]) * (forward ? 1 : -1);
  const bob = walking ? Math.abs(Math.sin(now / wp.bobRate + wp.phase * 10)) * 0.012 : 0;
  return { x: p[0] + (q[0] - p[0]) * k, y: p[1] + (q[1] - p[1]) * k - bob, flip: dx < -0.0005, bob, forward };
}

export let boardAnimFrame: number | null = null;
export let lastAnimDraw = 0;
/** Keep the board alive at ~30fps while a game is on screen and animation is on. */
export function ensureBoardAnimation(): void {
  if (boardAnimFrame !== null) return;
  const step = (ts: number) => {
    boardAnimFrame = null;
    if (!boardCanvasEl || !room?.game || !animateMeeples) return;
    if (ts - lastAnimDraw >= 33 && !dragState) { lastAnimDraw = ts; drawBoard(boardCanvasEl); }
    boardAnimFrame = requestAnimationFrame(step);
  };
  boardAnimFrame = requestAnimationFrame(step);
}
