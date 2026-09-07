// "Storybook Meadow": a picture-book countryside — bright pastel grass dotted with
// flowers, pink castle walls with round blue-roofed towers, caramel roads with
// white cobbles, and a gingerbread chapel with an icing roof.
import { SIZE, ROAD_W, JUNCTION_R, layoutFor, seeded, scatterOpen, cityInteriorSpots, cityPath, strokeRoad, strokeWalls, hasJunction, roundRect, shieldPath, shieldAnchor } from './geometry.js';
import type { Skin } from './types.js';

const GRASS = '#a9dd7a';
const GRASS_DARK = '#8cc95f';
const WALL = '#f2a4c0';
const WALL_DARK = '#d4779a';
const ROOF = '#5ea8e8';
const ROOF_DARK = '#3d7fc0';
const ROAD = '#e8b96f';
const ROAD_EDGE = '#c9934a';
const OUTLINE = '#5a3d4a';

function meadow(ctx: CanvasRenderingContext2D, rng: () => number): void {
  ctx.fillStyle = GRASS; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = GRASS_DARK;
  for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.ellipse(rng() * SIZE, rng() * SIZE, 18 + rng() * 22, 9 + rng() * 10, 0, 0, Math.PI * 2); ctx.globalAlpha = 0.35; ctx.fill(); }
  ctx.globalAlpha = 1;
}

function flower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) { const a = (i * Math.PI * 2) / 5; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 1.6, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#fff3a8'; ctx.beginPath(); ctx.arc(x, y, 1.3, 0, Math.PI * 2); ctx.fill();
}

function puffTree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = 'rgba(60,90,40,0.18)'; ctx.beginPath(); ctx.ellipse(x + 1, y + r + 2, r * 1.1, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a5a3a'; ctx.fillRect(x - 1.2, y, 2.4, r + 2);
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.1;
  for (const [dx, dy, rr, col] of [[0, -2, r, '#4faa62'], [-r * 0.55, 0, r * 0.75, '#5fbf72'], [r * 0.55, 0, r * 0.75, '#5fbf72'], [0, -r * 0.9, r * 0.7, '#7bd68a']] as [number, number, number, string][]) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + dx, y + dy, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

function towerHouse(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, h: number): void {
  ctx.fillStyle = 'rgba(60,30,50,0.2)'; ctx.beginPath(); ctx.ellipse(x + 2, y + h / 2 + 2, r * 1.2, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fbe3ec'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.2;
  roundRect(ctx, x - r, y - h / 2, r * 2, h, 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = ROOF; ctx.beginPath(); ctx.moveTo(x - r - 2, y - h / 2); ctx.lineTo(x, y - h / 2 - r * 1.5); ctx.lineTo(x + r + 2, y - h / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = ROOF_DARK; ctx.beginPath(); ctx.moveTo(x, y - h / 2 - r * 1.5); ctx.lineTo(x + r + 2, y - h / 2); ctx.lineTo(x + 1, y - h / 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd35e'; roundRect(ctx, x - 1.6, y - 1, 3.2, 4, 1.4); ctx.fill();
  ctx.fillStyle = '#ff6f91'; ctx.beginPath(); ctx.moveTo(x, y - h / 2 - r * 1.5); ctx.lineTo(x + 5, y - h / 2 - r * 1.5 - 2); ctx.lineTo(x, y - h / 2 - r * 1.5 - 4.5); ctx.closePath(); ctx.fill();
}

function cottage(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#fff5e6'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.2;
  roundRect(ctx, x - 7, y - 3, 14, 10, 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e07a5f'; ctx.beginPath(); ctx.moveTo(x - 9, y - 3); ctx.lineTo(x, y - 11); ctx.lineTo(x + 9, y - 3); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#7dc4ff'; ctx.fillRect(x - 4.5, y - 0.5, 3, 3); ctx.fillRect(x + 1.5, y - 0.5, 3, 3);
  ctx.fillStyle = '#8a5a3a'; ctx.fillRect(x - 1.5, y + 2.5, 3, 4.5);
}

function paint(ctx: CanvasRenderingContext2D, key: string): void {
  const L = layoutFor(key);
  const { t } = L;
  const rng = seeded('storybook:' + key);
  meadow(ctx, rng);

  const petals = ['#ff8fb1', '#ffffff', '#ffd35e', '#c79bff'];
  for (const [x, y] of scatterOpen(ctx, L, rng, 14, 4)) flower(ctx, x, y, petals[Math.floor(rng() * petals.length)]!);
  for (const [x, y] of scatterOpen(ctx, L, rng, 4, 9)) puffTree(ctx, x, y, 5 + rng() * 3);

  if (t.roadGroups.length) {
    strokeRoad(ctx, L.roads, ROAD_W + 2.4, OUTLINE);
    strokeRoad(ctx, L.roads, ROAD_W, ROAD_EDGE);
    strokeRoad(ctx, L.roads, ROAD_W - 6, ROAD);
    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.setLineDash([3, 10]); ctx.lineCap = 'round';
    ctx.stroke(L.roads); ctx.lineDashOffset = 6.5; ctx.translate(0, 0); ctx.stroke(L.roads); ctx.restore();
    if (hasJunction(t)) {
      ctx.fillStyle = ROAD; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(100, 100, JUNCTION_R + 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // A wishing well with a little red roof, cottages around the green.
      ctx.fillStyle = '#9db8c9'; ctx.beginPath(); ctx.arc(100, 103, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3d6f8f'; ctx.beginPath(); ctx.arc(100, 103, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8a5a3a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(94, 103); ctx.lineTo(94, 92); ctx.moveTo(106, 103); ctx.lineTo(106, 92); ctx.stroke();
      ctx.fillStyle = '#e07a5f'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(90, 93); ctx.lineTo(100, 85); ctx.lineTo(110, 93); ctx.closePath(); ctx.fill(); ctx.stroke();
      for (const [sx, sy] of [[62, 62], [138, 62], [62, 138], [138, 138]] as [number, number][]) {
        if (L.isOpenField(ctx, sx, sy, 6)) cottage(ctx, sx, sy);
      }
    }
  }

  t.cityGroups.forEach((_, gi) => {
    const city = cityPath(t, gi);
    ctx.fillStyle = '#f7c9d9'; ctx.fill(city);
    ctx.save(); ctx.clip(city);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let yy = 4; yy < SIZE; yy += 9) for (let xx = (yy / 9) % 2 ? 0 : 7; xx < SIZE; xx += 14) { roundRect(ctx, xx, yy, 11, 5.5, 2); ctx.fill(); }
    ctx.restore();
    for (const [x, y] of cityInteriorSpots(ctx, city, rng, 6, 9)) towerHouse(ctx, x, y, 5 + rng() * 2, 11 + rng() * 5);
  });
  strokeWalls(ctx, t, 7, WALL);
  strokeWalls(ctx, t, 7, WALL_DARK, [6, 6]);
  strokeWalls(ctx, t, 1.4, OUTLINE);

  if (t.monastery) {
    // Gingerbread chapel with an icing roof and a candy-cane spire.
    ctx.fillStyle = 'rgba(60,30,50,0.18)'; ctx.beginPath(); ctx.ellipse(102, 130, 40, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b8743f'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.4;
    roundRect(ctx, 66, 92, 68, 36, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath(); ctx.moveTo(62, 94); ctx.lineTo(100, 66); ctx.lineTo(138, 94);
    for (let x = 138; x > 62; x -= 10) ctx.arc(x - 5, 94, 5, 0, Math.PI, false);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#7dc4ff'; roundRect(ctx, 74, 102, 9, 12, 4); ctx.fill(); ctx.stroke(); roundRect(ctx, 117, 102, 9, 12, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e07a5f'; roundRect(ctx, 92, 106, 16, 22, 8); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#ff6f91'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(100, 66); ctx.lineTo(100, 50); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(100, 66); ctx.lineTo(100, 50); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffd35e'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(100, 48, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 6; i++) { ctx.fillStyle = ['#ff6f91', '#7dc4ff', '#ffd35e'][i % 3]!; ctx.beginPath(); ctx.arc(72 + i * 11, 122, 2, 0, Math.PI * 2); ctx.fill(); }
  }

  if (t.shield) {
    const [ax, ay] = shieldAnchor(t);
    ctx.save(); ctx.translate(ax - 100, ay - 100);
    const p = shieldPath(100, 100, 0.95);
    ctx.fillStyle = '#ffd35e'; ctx.fill(p);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.6; ctx.stroke(p);
    ctx.fillStyle = '#ff6f91';
    ctx.beginPath(); ctx.moveTo(100, 111); ctx.bezierCurveTo(88, 100, 92, 88, 100, 95); ctx.bezierCurveTo(108, 88, 112, 100, 100, 111); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(90,61,74,0.35)'; ctx.lineWidth = 1.2; ctx.strokeRect(0.6, 0.6, SIZE - 1.2, SIZE - 1.2);
}

/** The table is the sea: rolling wave bands, whitecaps, a fish or two and a little
 *  sailboat. Everything repeats every 400 units with no visible join. */
function table(ctx: CanvasRenderingContext2D): void {
  const T = 600;
  const rng = seeded('storybook:table');
  const g = ctx.createLinearGradient(0, 0, 0, T);
  g.addColorStop(0, '#6cc3ec'); g.addColorStop(0.5, '#5fb6e4'); g.addColorStop(1, '#6cc3ec');
  ctx.fillStyle = g; ctx.fillRect(0, 0, T, T);
  // Wave bands: sine rows whose period divides 400 so the left and right edges meet.
  for (let row = 0; row < 24; row++) {
    const y0 = row * 25 + 12, amp = 3.5, period = 100, phase = row * 1.3;
    ctx.beginPath();
    for (let x = 0; x <= T; x += 4) ctx.lineTo(x, y0 + Math.sin((x / period) * Math.PI * 2 + phase) * amp);
    ctx.strokeStyle = row % 2 ? 'rgba(255,255,255,0.28)' : 'rgba(30,90,150,0.18)'; ctx.lineWidth = row % 2 ? 2 : 1.4; ctx.lineCap = 'round';
    ctx.stroke();
  }
  // Whitecaps: little foam arcs, kept away from the edges so the tile stays seamless.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2.2;
  for (let i = 0; i < 22; i++) {
    const x = 20 + rng() * (T - 40), y = 20 + rng() * (T - 40), r = 5 + rng() * 5;
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + r * 1.6, y + 2, r * 0.7, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  }
  // Fish.
  const fish = (x: number, y: number, s: number, flip: boolean, color: string) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(flip ? -s : s, s);
    ctx.fillStyle = color; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1 / s;
    ctx.beginPath(); ctx.ellipse(0, 0, 8, 4.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-13, -4.5); ctx.lineTo(-13, 4.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(4, -1, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = OUTLINE; ctx.beginPath(); ctx.arc(4.4, -1, 0.7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  fish(90, 300, 1.1, false, '#ff9f4a'); fish(310, 120, 0.9, true, '#ffd35e'); fish(230, 540, 0.8, false, '#ff8fb1'); fish(520, 380, 1, true, '#c79bff');
  // A sailboat.
  ctx.save(); ctx.translate(430, 230);
  ctx.fillStyle = '#e07a5f'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(18, 0); ctx.lineTo(13, 8); ctx.lineTo(-13, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#8a5a3a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -28); ctx.stroke();
  ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(1, -27); ctx.lineTo(17, -4); ctx.lineTo(1, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ff6f91'; ctx.beginPath(); ctx.moveTo(-1, -26); ctx.lineTo(-12, -6); ctx.lineTo(-1, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-24, 10); ctx.quadraticCurveTo(-10, 14, 0, 11); ctx.stroke();
  ctx.restore();
  // A friendly whale spouting in the corner region (well inside the tile).
  ctx.save(); ctx.translate(110, 110);
  ctx.fillStyle = '#4e7fc9'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(0, 0, 22, 11, 0, Math.PI, Math.PI * 2); ctx.lineTo(22, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20, -2); ctx.quadraticCurveTo(30, -12, 34, -3); ctx.quadraticCurveTo(30, 2, 20, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-10, -4, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = OUTLINE; ctx.beginPath(); ctx.arc(-9.6, -4, 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-4, -11); ctx.quadraticCurveTo(-8, -22, -14, -24); ctx.moveTo(-4, -11); ctx.quadraticCurveTo(0, -22, 6, -24); ctx.moveTo(-4, -11); ctx.lineTo(-4, -26); ctx.stroke();
  ctx.restore();
}

export const storybook: Skin = {
  id: 'storybook',
  name: 'Storybook Meadow',
  blurb: 'A picture-book countryside: pink castles, caramel roads, flowers everywhere.',
  ui: {
    '--bg': '#fff4e6', '--panel': '#fffaf3', '--ink': '#4a2e3a', '--ink-soft': '#8a6a78',
    '--accent': '#3d9be9', '--accent-2': '#f2a4c0', '--danger': '#e0563f', '--panel-border': '#5a3d4a',
    '--shadow': '0 4px 14px rgba(90, 61, 74, 0.18)',
  },
  board: ['#7fc9e8', '#5aa9d4'],
  paint,
  table,
  tableSize: 600,
};
