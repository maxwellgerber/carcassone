// Procedural placeholder art in the "Verdigris Gearworks" palette: engraved-brass
// look with chamfered corners and thin dark contours. This is an interim renderer —
// the real deliverable is a hand-authored SVG per tile type (see
// docs/tile-geometry-contract.md), commissioned separately against this same
// edge/rotation contract so the swap is a drop-in replacement for `getTileCanvas`.
import { TILE_TYPES, rotateGroupSides, OPPOSITE } from '../shared/tiles.js';

const PALETTE = {
  fieldLight: '#7FA08F',
  fieldDark: '#4F6B60',
  fieldSpeck: '#3E5A50',
  road: '#B7A98C',
  roadEdge: '#8A7C64',
  roadLine: '#E7DCC0',
  city: '#3E6F63',
  cityDark: '#2C4F46',
  mortar: '#CDBE9E',
  chapelWall: '#D8CDB4',
  chapelRoof: '#6E5A3C',
  shieldGold: '#D4B85A',
  shieldGoldDark: '#9A8C3E',
  ink: '#1F2E2B',
};

function seededRng(seed: string) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const MID: Record<number, [number, number]> = { 0: [0.5, 0], 1: [1, 0.5], 2: [0.5, 1], 3: [0, 0.5] };
const CORNER: Record<string, [number, number]> = { NE: [1, 0], SE: [1, 1], SW: [0, 1], NW: [0, 0] };
function cornerBetween(a: number, b: number): [number, number] {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (lo === 0 && hi === 3) return CORNER.NW!;
  const map: Record<string, keyof typeof CORNER> = { '0,1': 'NE', '1,2': 'SE', '2,3': 'SW' };
  return CORNER[map[`${lo},${hi}`]!]!;
}
function px(pt: [number, number], size: number): [number, number] { return [pt[0] * size, pt[1] * size]; }

function paintField(ctx: CanvasRenderingContext2D, size: number, seed: string): void {
  const rng = seededRng(seed + ':field');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, PALETTE.fieldLight);
  g.addColorStop(1, PALETTE.fieldDark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = rng() * size, y = rng() * size;
    ctx.strokeStyle = PALETTE.fieldSpeck;
    ctx.globalAlpha = 0.25 + rng() * 0.25;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 6, y - rng() * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function strokePoly(ctx: CanvasRenderingContext2D, pts: [number, number][], size: number): void {
  ctx.beginPath();
  pts.forEach((p, i) => { const [x, y] = px(p, size); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
}

function drawRoadSegment(ctx: CanvasRenderingContext2D, size: number, sideA: number, sideB: number): void {
  const isOpposite = OPPOSITE[sideA as 0 | 1 | 2 | 3] === sideB;
  const p0 = px(MID[sideA]!, size);
  const p1 = px(MID[sideB]!, size);
  const ctrl = isOpposite ? [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2] as [number, number] : px(cornerBetween(sideA, sideB), size);
  const path = new Path2D();
  path.moveTo(p0[0], p0[1]);
  if (isOpposite) path.lineTo(p1[0], p1[1]); else path.quadraticCurveTo(ctrl[0], ctrl[1], p1[0], p1[1]);
  ctx.save();
  ctx.strokeStyle = PALETTE.roadEdge; ctx.lineWidth = size * 0.26; ctx.stroke(path);
  ctx.strokeStyle = PALETTE.road; ctx.lineWidth = size * 0.2; ctx.stroke(path);
  ctx.setLineDash([size * 0.045, size * 0.06]);
  ctx.strokeStyle = PALETTE.roadLine; ctx.lineWidth = size * 0.018; ctx.stroke(path);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawRoadStub(ctx: CanvasRenderingContext2D, size: number, side: number): void {
  const p0 = px(MID[side]!, size);
  const c: [number, number] = [size * 0.5, size * 0.5];
  const path = new Path2D();
  path.moveTo(p0[0], p0[1]); path.lineTo(c[0], c[1]);
  ctx.save();
  ctx.strokeStyle = PALETTE.roadEdge; ctx.lineWidth = size * 0.26; ctx.stroke(path);
  ctx.strokeStyle = PALETTE.road; ctx.lineWidth = size * 0.2; ctx.stroke(path);
  ctx.restore();
}

function drawJunctionHub(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.save();
  ctx.fillStyle = PALETTE.road;
  ctx.beginPath(); ctx.arc(size * 0.5, size * 0.5, size * 0.11, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PALETTE.roadEdge; ctx.lineWidth = size * 0.018; ctx.stroke();
  ctx.restore();
}

function petalPoints(side: number): [number, number][] {
  const margin = 0.16, depth = 0.46;
  const byN: [number, number][] = [[margin, 0], [1 - margin, 0], [1 - margin - 0.1, depth], [margin + 0.1, depth]];
  if (side === 0) return byN;
  if (side === 2) return byN.map(([x, y]) => [1 - x, 1 - y]);
  if (side === 1) return byN.map(([x, y]) => [1 - y, x]);
  return byN.map(([x, y]) => [y, 1 - x]);
}

export function drawShield(ctx: CanvasRenderingContext2D, size: number, at: [number, number]): void {
  const [cx, cy] = px(at, size);
  const w = size * 0.2, h = size * 0.24;
  ctx.save();
  ctx.translate(cx, cy);
  const shieldPath = () => {
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2, h * 0.05);
    ctx.quadraticCurveTo(w / 2, h / 2, 0, h / 2);
    ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h * 0.05);
    ctx.closePath();
  };
  shieldPath(); ctx.fillStyle = PALETTE.shieldGoldDark; ctx.fill();
  ctx.save(); ctx.scale(0.78, 0.78); shieldPath(); ctx.fillStyle = PALETTE.shieldGold; ctx.fill(); ctx.restore();
  ctx.strokeStyle = PALETTE.ink; ctx.globalAlpha = 0.5; ctx.lineWidth = size * 0.012; shieldPath(); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawCityGroup(ctx: CanvasRenderingContext2D, size: number, sides: number[], connected: boolean, shield: boolean): void {
  ctx.save();
  ctx.fillStyle = PALETTE.cityDark;
  for (const s of sides) { strokePoly(ctx, petalPoints(s), size); ctx.fill(); }
  if (connected) { ctx.beginPath(); ctx.arc(size * 0.5, size * 0.5, size * 0.30, 0, Math.PI * 2); ctx.fill(); }

  ctx.fillStyle = PALETTE.city;
  const inset = (pts: [number, number][]) => {
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return pts.map(([x, y]) => [x + (cx - x) * 0.12, y + (cy - y) * 0.12] as [number, number]);
  };
  for (const s of sides) { strokePoly(ctx, inset(petalPoints(s)), size); ctx.fill(); }
  if (connected) { ctx.beginPath(); ctx.arc(size * 0.5, size * 0.5, size * 0.25, 0, Math.PI * 2); ctx.fill(); }

  // engraved cross-hatch shading (Gearworks motif) clipped to the city shape
  ctx.save();
  ctx.beginPath();
  for (const s of sides) { const p = petalPoints(s); p.forEach(([x, y], i) => { const X = x * size, Y = y * size; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.closePath(); }
  if (connected) ctx.arc(size * 0.5, size * 0.5, size * 0.30, 0, Math.PI * 2);
  ctx.clip('evenodd');
  ctx.strokeStyle = PALETTE.mortar;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = Math.max(1, size * 0.01);
  for (let i = -size; i < size * 2; i += size * 0.09) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = Math.max(1, size * 0.02);
  for (const s of sides) { strokePoly(ctx, petalPoints(s), size); ctx.stroke(); }

  if (shield) drawShield(ctx, size, connected ? [0.5, 0.5] : centroid(petalPoints(sides[0]!)));
  ctx.restore();
}

function centroid(pts: [number, number][]): [number, number] {
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

function drawMonastery(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size * 0.5, cy = size * 0.54;
  ctx.save();
  ctx.fillStyle = PALETTE.city;
  ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.ellipse(cx, cy + size * 0.15, size * 0.24, size * 0.10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  const bw = size * 0.30, bh = size * 0.22;
  ctx.fillStyle = PALETTE.chapelWall;
  ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = size * 0.012; ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);
  ctx.fillStyle = PALETTE.ink; ctx.globalAlpha = 0.6;
  ctx.fillRect(cx - bw * 0.1, cy + bh * 0.02, bw * 0.2, bh * 0.48);
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.chapelRoof;
  ctx.beginPath();
  ctx.moveTo(cx - bw / 2 - size * 0.03, cy - bh / 2);
  ctx.lineTo(cx, cy - bh / 2 - size * 0.2);
  ctx.lineTo(cx + bw / 2 + size * 0.03, cy - bh / 2);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = size * 0.01; ctx.stroke();
  ctx.restore();
}

const tileCache = new Map<string, HTMLCanvasElement>();

export function getTileCanvas(tileKey: string, rot: number, size: number): HTMLCanvasElement {
  const k = `${tileKey}:${rot}:${size}`;
  const cached = tileCache.get(k);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const t = TILE_TYPES[tileKey]!;

  paintField(ctx, size, tileKey);

  t.roadGroups.forEach((grp) => {
    const abs = rotateGroupSides(grp, rot);
    if (abs.length === 2) drawRoadSegment(ctx, size, abs[0]!, abs[1]!); else drawRoadStub(ctx, size, abs[0]!);
  });
  if (t.roadGroups.length >= 3) drawJunctionHub(ctx, size);
  if (t.monastery) drawMonastery(ctx, size);
  t.cityGroups.forEach((grp) => {
    const abs = rotateGroupSides(grp, rot);
    drawCityGroup(ctx, size, abs, abs.length > 1, t.shield);
  });

  // chamfered-corner tile edge, Gearworks signature
  ctx.save();
  ctx.strokeStyle = 'rgba(31,46,43,0.4)';
  ctx.lineWidth = Math.max(1, size * 0.012);
  const c = size * 0.06;
  ctx.beginPath();
  ctx.moveTo(c, 0.5); ctx.lineTo(size - c, 0.5); ctx.lineTo(size - 0.5, c);
  ctx.lineTo(size - 0.5, size - c); ctx.lineTo(size - c, size - 0.5); ctx.lineTo(c, size - 0.5);
  ctx.lineTo(0.5, size - c); ctx.lineTo(0.5, c); ctx.closePath();
  ctx.stroke();
  ctx.restore();

  tileCache.set(k, canvas);
  return canvas;
}

export function getTileBackCanvas(size: number): HTMLCanvasElement {
  const k = `back:${size}`;
  const cached = tileCache.get(k);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#2C4A44'); g.addColorStop(1, '#1B2E2A');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(212,184,90,0.4)';
  ctx.lineWidth = size * 0.04;
  ctx.strokeRect(size * 0.12, size * 0.12, size * 0.76, size * 0.76);
  ctx.fillStyle = 'rgba(212,184,90,0.6)';
  ctx.font = `${size * 0.32}px "Space Grotesk", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('C', size / 2, size * 0.53);
  tileCache.set(k, canvas);
  return canvas;
}

const meepleCache = new Map<string, HTMLCanvasElement>();

export function getMeepleCanvas(color: string, size: number, lying: boolean): HTMLCanvasElement {
  const k = `${color}:${size}:${lying ? 1 : 0}`;
  const cached = meepleCache.get(k);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  if (lying) ctx.rotate(-Math.PI / 2);
  ctx.translate(-size / 2, -size / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(size * 0.5, size * 0.86, size * 0.28, size * 0.08, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, size * 0.03);
  const path = new Path2D(`
    M ${size * 0.5} ${size * 0.08}
    C ${size * 0.62} ${size * 0.08} ${size * 0.66} ${size * 0.22} ${size * 0.58} ${size * 0.30}
    L ${size * 0.74} ${size * 0.46}
    C ${size * 0.82} ${size * 0.5} ${size * 0.8} ${size * 0.6} ${size * 0.7} ${size * 0.6}
    L ${size * 0.62} ${size * 0.56}
    L ${size * 0.7} ${size * 0.86}
    C ${size * 0.72} ${size * 0.92} ${size * 0.66} ${size * 0.94} ${size * 0.6} ${size * 0.9}
    L ${size * 0.52} ${size * 0.68}
    L ${size * 0.48} ${size * 0.68}
    L ${size * 0.4} ${size * 0.9}
    C ${size * 0.34} ${size * 0.94} ${size * 0.28} ${size * 0.92} ${size * 0.3} ${size * 0.86}
    L ${size * 0.38} ${size * 0.56}
    L ${size * 0.3} ${size * 0.6}
    C ${size * 0.2} ${size * 0.6} ${size * 0.18} ${size * 0.5} ${size * 0.26} ${size * 0.46}
    L ${size * 0.42} ${size * 0.30}
    C ${size * 0.34} ${size * 0.22} ${size * 0.38} ${size * 0.08} ${size * 0.5} ${size * 0.08}
    Z
  `);
  ctx.fill(path);
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.stroke(path);
  ctx.restore();
  meepleCache.set(k, canvas);
  return canvas;
}

export { PALETTE };
