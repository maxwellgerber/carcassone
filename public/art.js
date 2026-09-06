// Procedural, hand-illustrated-feel art for every tile, meeple, and decorative
// flourish in the game. Everything is drawn with Canvas 2D paths — no external
// image assets, so the game never depends on anything fetching correctly.
import { TILE_TYPES } from './shared/tiles.js';
import { rotateEdges, rotateGroupSides, OPPOSITE, SIDES } from './shared/tiles.js';

function seededRng(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PALETTE = {
  grassLight: '#8fae5c',
  grassMid: '#79995078',
  grassDark: '#5d7d3f',
  grassSpeck: '#4f6f36',
  road: '#d8bd85',
  roadEdge: '#a9895a',
  roadLine: '#f2e3bb',
  cobble: '#c2a06a',
  city: '#c96a4c',
  cityDark: '#a1503a',
  cityLight: '#e2916f',
  cityRoof: '#8c3d2c',
  mortar: '#e8c9a0',
  stone: '#9c9384',
  stoneDark: '#726b5f',
  chapelWall: '#e7dcc2',
  chapelRoof: '#7a4e3a',
  shieldGold: '#e8b84b',
  shieldGoldDark: '#b8862a',
  ink: '#3a2c1e',
}

const MID = { N: [0.5, 0], E: [1, 0.5], S: [0.5, 1], W: [0, 0.5] };
const CORNER = { NE: [1, 0], SE: [1, 1], SW: [0, 1], NW: [0, 0] };
const ADJ_CORNER = { '0,1': 'NE', '1,2': 'SE', '2,3': 'SW', '3,0': 'NW' };

function cornerBetween(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (lo === 0 && hi === 3) return CORNER.NW; // W-N wrap
  return CORNER[ADJ_CORNER[`${lo},${hi}`]];
}

function px(pt, size) { return [pt[0] * size, pt[1] * size]; }

// ---- textures --------------------------------------------------------------
function paintGrass(ctx, size, seed) {
  const rng = seededRng(seed + ':grass');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, PALETTE.grassLight);
  g.addColorStop(1, PALETTE.grassDark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const x = rng() * size, y = rng() * size;
    const l = 2 + rng() * 4;
    const ang = rng() * Math.PI * 2;
    ctx.strokeStyle = rng() > 0.5 ? PALETTE.grassSpeck : '#a9c377';
    ctx.globalAlpha = 0.35 + rng() * 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * l, y - Math.abs(Math.sin(ang) * l));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function strokePoly(ctx, pts, size) {
  ctx.beginPath();
  pts.forEach((p, i) => { const [x, y] = px(p, size); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.closePath();
}

// ---- roads -------------------------------------------------------------
function drawRoadSegment(ctx, size, sideA, sideB, seed) {
  const isOpposite = OPPOSITE[sideA] === sideB;
  const p0 = px(MID[SIDES[sideA]], size);
  const p1 = px(MID[SIDES[sideB]], size);
  const ctrl = isOpposite ? [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2] : px(cornerBetween(sideA, sideB), size);
  const path = new Path2D();
  path.moveTo(p0[0], p0[1]);
  if (isOpposite) path.lineTo(p1[0], p1[1]);
  else path.quadraticCurveTo(ctrl[0], ctrl[1], p1[0], p1[1]);

  ctx.save();
  ctx.strokeStyle = PALETTE.roadEdge;
  ctx.lineWidth = size * 0.26;
  ctx.lineCap = 'butt';
  ctx.stroke(path);
  ctx.strokeStyle = PALETTE.road;
  ctx.lineWidth = size * 0.2;
  ctx.stroke(path);
  ctx.setLineDash([size * 0.045, size * 0.06]);
  ctx.strokeStyle = PALETTE.roadLine;
  ctx.lineWidth = size * 0.02;
  ctx.stroke(path);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawRoadStub(ctx, size, side, seed) {
  const p0 = px(MID[SIDES[side]], size);
  const c = [size * 0.5, size * 0.5];
  const path = new Path2D();
  path.moveTo(p0[0], p0[1]);
  path.lineTo(c[0], c[1]);
  ctx.save();
  ctx.strokeStyle = PALETTE.roadEdge;
  ctx.lineWidth = size * 0.26;
  ctx.stroke(path);
  ctx.strokeStyle = PALETTE.road;
  ctx.lineWidth = size * 0.2;
  ctx.stroke(path);
  ctx.restore();
}

function drawJunctionHub(ctx, size) {
  ctx.save();
  ctx.fillStyle = PALETTE.road;
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, size * 0.115, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.roadEdge;
  ctx.lineWidth = size * 0.018;
  ctx.stroke();
  ctx.restore();
}

// ---- city ----------------------------------------------------------------
function petalPoints(side) {
  const margin = 0.16;
  const depth = 0.46;
  const byN = [[margin, 0], [1 - margin, 0], [1 - margin - 0.1, depth], [margin + 0.1, depth]];
  const rot = (pt) => pt;
  if (side === 0) return byN;
  if (side === 2) return byN.map(([x, y]) => [1 - x, 1 - y]);
  if (side === 1) return byN.map(([x, y]) => [1 - y, x]);
  if (side === 3) return byN.map(([x, y]) => [y, 1 - x]);
  return byN;
}

function drawCityGroup(ctx, size, sides, connected, seed, shield) {
  ctx.save();
  ctx.fillStyle = PALETTE.cityDark;
  for (const s of sides) strokePoly(ctx, petalPoints(s).map(([x, y]) => [x, y]), size), ctx.fill();
  if (connected) {
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.5, size * 0.30, 0, Math.PI * 2);
    ctx.fill();
  }
  // lighter brick fill inset
  ctx.fillStyle = PALETTE.city;
  const inset = (pts) => pts.map(([x, y]) => {
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return [x + (cx - x) * 0.12, y + (cy - y) * 0.12];
  });
  for (const s of sides) { strokePoly(ctx, inset(petalPoints(s)), size); ctx.fill(); }
  if (connected) { ctx.beginPath(); ctx.arc(size * 0.5, size * 0.5, size * 0.25, 0, Math.PI * 2); ctx.fill(); }

  // brick texture: clip to the combined shape, then draw brick courses over the whole tile.
  ctx.save();
  ctx.beginPath();
  for (const s of sides) { const p = petalPoints(s); p.forEach(([x, y], i) => { const X = x * size, Y = y * size; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.closePath(); }
  if (connected) ctx.arc(size * 0.5, size * 0.5, size * 0.30, 0, Math.PI * 2);
  ctx.clip('evenodd');
  ctx.strokeStyle = PALETTE.mortar;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, size * 0.014);
  const rows = 7;
  for (let r = 0; r <= rows; r++) {
    const y = (r / rows) * size;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
    const off = (r % 2) * (size / 10);
    for (let x = off; x < size; x += size / 5) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + size / rows); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // outline
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = Math.max(1, size * 0.018);
  ctx.globalAlpha = 0.55;
  for (const s of sides) { strokePoly(ctx, petalPoints(s), size); ctx.stroke(); }
  ctx.globalAlpha = 1;

  // crenellations along the outer edge
  for (const s of sides) {
    ctx.fillStyle = PALETTE.cityDark;
    const teeth = 4;
    for (let i = 0; i < teeth; i++) {
      if (i % 2 === 0) continue;
      const t0 = 0.16 + (i / teeth) * 0.68, t1 = 0.16 + ((i + 1) / teeth) * 0.68;
      const a = lerpEdge(s, t0), b = lerpEdge(s, t1);
      const inward = inwardVec(s, size * 0.07);
      ctx.beginPath();
      const A = px(a, size), B = px(b, size);
      ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
      ctx.lineTo(B[0] + inward[0], B[1] + inward[1]);
      ctx.lineTo(A[0] + inward[0], A[1] + inward[1]);
      ctx.closePath(); ctx.fill();
    }
  }

  if (shield) drawShield(ctx, size, connected ? [0.5, 0.5] : addPts(petalPoints(sides[0])[0], petalPoints(sides[0])[1], petalPoints(sides[0])[2], petalPoints(sides[0])[3]));
  ctx.restore();
}

function addPts(...pts) {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return [cx, cy];
}

function lerpEdge(side, t) {
  if (side === 0) return [t, 0];
  if (side === 2) return [1 - t, 1];
  if (side === 1) return [1, t];
  return [0, 1 - t];
}
function inwardVec(side, mag) {
  if (side === 0) return [0, mag];
  if (side === 2) return [0, -mag];
  if (side === 1) return [-mag, 0];
  return [mag, 0];
}

export function drawShield(ctx, size, at) {
  const [cx, cy] = px(at, size);
  const w = size * 0.2, h = size * 0.24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  ctx.lineTo(w / 2, h * 0.05);
  ctx.quadraticCurveTo(w / 2, h / 2, 0, h / 2);
  ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h * 0.05);
  ctx.closePath();
  ctx.fillStyle = PALETTE.shieldGoldDark;
  ctx.fill();
  ctx.save();
  ctx.scale(0.78, 0.78);
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  ctx.lineTo(w / 2, h * 0.05);
  ctx.quadraticCurveTo(w / 2, h / 2, 0, h / 2);
  ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h * 0.05);
  ctx.closePath();
  ctx.fillStyle = PALETTE.shieldGold;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = PALETTE.ink;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = size * 0.012;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.ink;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.22); ctx.lineTo(w * 0.16, h * 0.05); ctx.lineTo(-w * 0.16, h * 0.05);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---- monastery -------------------------------------------------------------
function drawMonastery(ctx, size) {
  const cx = size * 0.5, cy = size * 0.54;
  ctx.save();
  // stone apron
  ctx.fillStyle = PALETTE.stone;
  ctx.beginPath(); ctx.ellipse(cx, cy + size * 0.15, size * 0.24, size * 0.10, 0, 0, Math.PI * 2); ctx.fill();
  // chapel body
  const bw = size * 0.30, bh = size * 0.22;
  ctx.fillStyle = PALETTE.chapelWall;
  ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
  ctx.strokeStyle = PALETTE.stoneDark; ctx.lineWidth = size * 0.012; ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);
  // door
  ctx.fillStyle = PALETTE.stoneDark;
  ctx.fillRect(cx - bw * 0.1, cy + bh * 0.02, bw * 0.2, bh * 0.48);
  // roof
  ctx.fillStyle = PALETTE.chapelRoof;
  ctx.beginPath();
  ctx.moveTo(cx - bw / 2 - size * 0.03, cy - bh / 2);
  ctx.lineTo(cx, cy - bh / 2 - size * 0.2);
  ctx.lineTo(cx + bw / 2 + size * 0.03, cy - bh / 2);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = PALETTE.ink; ctx.globalAlpha = 0.4; ctx.lineWidth = size * 0.01; ctx.stroke();
  ctx.globalAlpha = 1;
  // cross
  ctx.strokeStyle = PALETTE.chapelRoof; ctx.lineWidth = size * 0.018;
  ctx.beginPath();
  ctx.moveTo(cx, cy - bh / 2 - size * 0.2); ctx.lineTo(cx, cy - bh / 2 - size * 0.29);
  ctx.moveTo(cx - size * 0.025, cy - bh / 2 - size * 0.255); ctx.lineTo(cx + size * 0.025, cy - bh / 2 - size * 0.255);
  ctx.stroke();
  ctx.restore();
}

// ---- full tile -------------------------------------------------------------
const tileCache = new Map();

export function getTileCanvas(tileKey, rot, size) {
  const k = `${tileKey}:${rot}:${size}`;
  if (tileCache.has(k)) return tileCache.get(k);
  const canvas = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const t = TILE_TYPES[tileKey];
  const edges = rotateEdges(t.edges, rot);

  paintGrass(ctx, size, tileKey);

  // roads first (under city, over grass)
  t.roadGroups.forEach((grp) => {
    const abs = rotateGroupSides(grp, rot);
    if (abs.length === 2) drawRoadSegment(ctx, size, abs[0], abs[1], tileKey);
    else drawRoadStub(ctx, size, abs[0], tileKey);
  });
  if (t.roadGroups.length >= 3) drawJunctionHub(ctx, size);

  if (t.monastery) drawMonastery(ctx, size);

  t.cityGroups.forEach((grp) => {
    const abs = rotateGroupSides(grp, rot);
    drawCityGroup(ctx, size, abs, abs.length > 1, tileKey, t.shield);
  });

  // tile edge outline
  ctx.strokeStyle = 'rgba(58,44,30,0.35)';
  ctx.lineWidth = Math.max(1, size * 0.012);
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

  tileCache.set(k, canvas);
  return canvas;
}

export function getTileBackCanvas(size) {
  const k = `back:${size}`;
  if (tileCache.has(k)) return tileCache.get(k);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#7a4e3a'); g.addColorStop(1, '#5a3826');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,235,200,0.35)';
  ctx.lineWidth = size * 0.05;
  ctx.strokeRect(size * 0.12, size * 0.12, size * 0.76, size * 0.76);
  ctx.fillStyle = 'rgba(255,235,200,0.5)';
  ctx.font = `${size * 0.34}px Cinzel, serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('C', size / 2, size * 0.53);
  tileCache.set(k, canvas);
  return canvas;
}

// ---- meeples ----------------------------------------------------------------
const meepleCache = new Map();

export function getMeepleCanvas(color, size, lying) {
  const k = `${color}:${size}:${lying ? 1 : 0}`;
  if (meepleCache.has(k)) return meepleCache.get(k);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d');
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
