// "Neon Grid": a rain-slick night city — asphalt fields with a faint cyan survey
// grid, cities as dense blocks of lit windows behind glowing walls, roads as dark
// lanes with a hot yellow centre line, and the cloister a floodlit shrine.
import { SIZE, ROAD_W, JUNCTION_R, layoutFor, seeded, scatterOpen, cityInteriorSpots, cityPath, strokeRoad, strokeWalls, hasJunction, shieldPath } from './geometry.js';
import type { Skin } from './types.js';

const ASPHALT = '#161a2b';
const GRID = 'rgba(64, 224, 255, 0.10)';
const BLOCK = '#2a2140';
const CYAN = '#3ff0ff';
const MAGENTA = '#ff4fd8';
const AMBER = '#ffd23f';
const LANE = '#0d1020';

function glow(ctx: CanvasRenderingContext2D, color: string, blur: number, fn: () => void): void {
  ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur; fn(); ctx.restore();
}

function ground(ctx: CanvasRenderingContext2D, rng: () => number): void {
  ctx.fillStyle = ASPHALT; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = GRID; ctx.lineWidth = 1;
  for (let v = 20; v < SIZE; v += 20) { ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, SIZE); ctx.moveTo(0, v); ctx.lineTo(SIZE, v); ctx.stroke(); }
  // Puddle sheen.
  for (let i = 0; i < 5; i++) {
    const g = ctx.createRadialGradient(rng() * SIZE, rng() * SIZE, 0, 100, 100, 90);
    g.addColorStop(0, 'rgba(255,79,216,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
  }
}

function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  glow(ctx, color, 10, () => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill(); });
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 9); ctx.stroke();
}

function vent(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number): void {
  ctx.fillStyle = '#20263a'; ctx.strokeStyle = 'rgba(64,224,255,0.35)'; ctx.lineWidth = 0.8;
  const w = 8 + rng() * 6, h = 5 + rng() * 4;
  ctx.beginPath(); ctx.rect(x - w / 2, y - h / 2, w, h); ctx.fill(); ctx.stroke();
  for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x - w / 2 + 1, y - h / 2 + (h * i) / 3); ctx.lineTo(x + w / 2 - 1, y - h / 2 + (h * i) / 3); ctx.stroke(); }
}

function tower(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rng: () => number): void {
  ctx.fillStyle = '#1b1530'; ctx.fillRect(x - w / 2 + 1.5, y - h / 2 + 1.5, w, h); // drop shadow
  ctx.fillStyle = '#332a4d'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.7; ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  const colors = [CYAN, MAGENTA, AMBER, '#ffffff'];
  for (let yy = y - h / 2 + 2.5; yy < y + h / 2 - 2; yy += 3.4) for (let xx = x - w / 2 + 2.2; xx < x + w / 2 - 1.5; xx += 3.2) {
    if (rng() < 0.42) continue;
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)]!;
    ctx.globalAlpha = 0.6 + rng() * 0.4; ctx.fillRect(xx, yy, 1.7, 2.2); ctx.globalAlpha = 1;
  }
  // Roof light.
  if (rng() < 0.5) glow(ctx, MAGENTA, 6, () => { ctx.fillStyle = MAGENTA; ctx.fillRect(x - 1, y - h / 2 - 2, 2, 2); });
}

function paint(ctx: CanvasRenderingContext2D, key: string): void {
  const L = layoutFor(key);
  const { t } = L;
  const rng = seeded('neon:' + key);
  ground(ctx, rng);

  for (const [x, y] of scatterOpen(ctx, L, rng, 4, 9)) vent(ctx, x, y, rng);
  for (const [x, y] of scatterOpen(ctx, L, rng, 5, 7)) lamp(ctx, x, y, rng() < 0.5 ? CYAN : AMBER);

  if (t.roadGroups.length) {
    strokeRoad(ctx, L.roads, ROAD_W + 2, 'rgba(63,240,255,0.35)');
    strokeRoad(ctx, L.roads, ROAD_W, LANE);
    glow(ctx, AMBER, 8, () => strokeRoad(ctx, L.roads, 1.8, AMBER, [9, 7]));
    strokeRoad(ctx, L.roads, 0.8, 'rgba(255,255,255,0.10)');
    if (hasJunction(t)) {
      // Plaza: a lit roundabout with a holo-sign in the middle.
      ctx.fillStyle = LANE; ctx.beginPath(); ctx.arc(100, 100, JUNCTION_R + 2, 0, Math.PI * 2); ctx.fill();
      glow(ctx, CYAN, 12, () => { ctx.strokeStyle = CYAN; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(100, 100, JUNCTION_R, 0, Math.PI * 2); ctx.stroke(); });
      glow(ctx, MAGENTA, 14, () => { ctx.strokeStyle = MAGENTA; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(100, 100, 9, 0, Math.PI * 2); ctx.stroke(); });
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(100, 100, 2.2, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; tower(ctx, 100 + Math.cos(a) * 42, 100 + Math.sin(a) * 42, 13, 13, rng); }
    }
  }

  t.cityGroups.forEach((_, gi) => {
    const city = cityPath(t, gi);
    ctx.fillStyle = BLOCK; ctx.fill(city);
    ctx.save(); ctx.clip(city);
    ctx.strokeStyle = 'rgba(255,79,216,0.12)'; ctx.lineWidth = 1;
    for (let v = 0; v < SIZE; v += 10) { ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, SIZE); ctx.moveTo(0, v); ctx.lineTo(SIZE, v); ctx.stroke(); }
    ctx.restore();
    for (const [x, y] of cityInteriorSpots(ctx, city, rng, 9, 8)) tower(ctx, x, y, 11 + rng() * 6, 11 + rng() * 7, rng);
  });
  strokeWalls(ctx, t, 5, 'rgba(63,240,255,0.22)');
  strokeWalls(ctx, t, 1.8, CYAN, [], { color: CYAN, blur: 10 });

  if (t.monastery) {
    // A floodlit shrine: stepped platform, pagoda roof, beam of light.
    const g = ctx.createRadialGradient(100, 100, 4, 100, 100, 56);
    g.addColorStop(0, 'rgba(255,210,63,0.30)'); g.addColorStop(1, 'rgba(255,210,63,0)');
    ctx.fillStyle = g; ctx.fillRect(40, 40, 120, 120);
    ctx.fillStyle = '#20263a'; ctx.fillRect(62, 118, 76, 8); ctx.fillRect(70, 110, 60, 8);
    ctx.fillStyle = '#2f2750'; ctx.fillRect(80, 84, 40, 28);
    glow(ctx, MAGENTA, 10, () => { ctx.strokeStyle = MAGENTA; ctx.lineWidth = 1.6; ctx.strokeRect(80, 84, 40, 28); });
    ctx.fillStyle = '#1b1530';
    ctx.beginPath(); ctx.moveTo(70, 84); ctx.lineTo(100, 66); ctx.lineTo(130, 84); ctx.closePath(); ctx.fill();
    glow(ctx, CYAN, 10, () => { ctx.strokeStyle = CYAN; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(70, 84); ctx.lineTo(100, 66); ctx.lineTo(130, 84); ctx.stroke(); });
    glow(ctx, AMBER, 14, () => { ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(100, 98, 4, 0, Math.PI * 2); ctx.fill(); });
    ctx.strokeStyle = 'rgba(255,210,63,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(100, 66); ctx.lineTo(100, 52); ctx.stroke();
  }

  if (t.shield) {
    const p = shieldPath(100, 100, 0.95);
    ctx.fillStyle = 'rgba(10,8,20,0.85)'; ctx.fill(p);
    glow(ctx, MAGENTA, 12, () => { ctx.strokeStyle = MAGENTA; ctx.lineWidth = 1.8; ctx.stroke(p); });
    glow(ctx, CYAN, 8, () => { ctx.strokeStyle = CYAN; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(100, 90); ctx.lineTo(108, 100); ctx.lineTo(100, 112); ctx.lineTo(92, 100); ctx.closePath(); ctx.stroke(); });
  }

  ctx.strokeStyle = 'rgba(63,240,255,0.18)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
}

/** The table is wet asphalt at night: a dot grid, faint scanlines, and a few
 *  neon reflections smeared across the puddles. */
function table(ctx: CanvasRenderingContext2D): void {
  const T = 400;
  const rng = seeded('neon:table');
  ctx.fillStyle = '#0a0c18'; ctx.fillRect(0, 0, T, T);
  for (let i = 0; i < 6; i++) {
    // Keep each puddle fully inside the repeat so its edge never gets clipped square.
    const r = 50 + rng() * 50, x = r + rng() * (T - 2 * r), y = r + rng() * (T - 2 * r);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = rng() < 0.5 ? '63,240,255' : '255,79,216';
    g.addColorStop(0, `rgba(${c},0.09)`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, T, T);
  }
  ctx.fillStyle = 'rgba(63,240,255,0.22)';
  for (let y = 10; y < T; y += 20) for (let x = 10; x < T; x += 20) { ctx.beginPath(); ctx.arc(x, y, 0.9, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = 'rgba(255,255,255,0.025)'; ctx.lineWidth = 1;
  for (let y = 0; y < T; y += 4) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(T, y + 0.5); ctx.stroke(); }
  // Reflections: short smeared neon streaks, vertical like lights on wet ground.
  for (let i = 0; i < 10; i++) {
    const x = 20 + rng() * (T - 40), y = 20 + rng() * (T - 60), len = 14 + rng() * 26;
    const c = ['#3ff0ff', '#ff4fd8', '#ffd23f'][Math.floor(rng() * 3)]!;
    const g = ctx.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.35; ctx.fillStyle = g; ctx.fillRect(x - 1, y, 2, len); ctx.globalAlpha = 1;
  }
}

export const neon: Skin = {
  id: 'neon',
  name: 'Neon Grid',
  blurb: 'A rain-slick night city: glowing walls, lit windows, hot yellow lanes.',
  ui: {
    '--bg': '#0d1020', '--panel': '#171b2e', '--ink': '#e8ecff', '--ink-soft': '#8f97c4',
    '--accent': '#3ff0ff', '--accent-2': '#ff4fd8', '--danger': '#ff6b6b', '--panel-border': '#3ff0ff',
    '--shadow': '0 4px 18px rgba(63, 240, 255, 0.12)',
  },
  board: ['#0a0c18', '#141a30'],
  paint,
  table,
};
