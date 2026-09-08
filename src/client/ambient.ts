// The living board: light that turns with the game, weather that drifts across the
// table, birds passing over, smoke from the cloisters and fireflies after dark.
// Everything here is decoration — it reads state and draws, never the reverse —
// and it all rides the same 30 fps loop the wandering meeples use.
import { TILE_TYPES } from '../shared/tiles.js';
import { cityPath, cityInteriorSpots, hasJunction, monasteryCenter, seeded, shieldAnchor, type Pt } from './skins/geometry.js';
import type { GameState } from '../shared/types.js';

export interface AmbientView {
  ctx: CanvasRenderingContext2D;
  cw: number; ch: number;
  scale: number; // px per tile
  now: number;   // performance.now()
  game: GameState;
  toScreen: (wx: number, wy: number) => [number, number];
  bounds: { minX: number; minY: number; maxX: number; maxY: number }; // world tiles
  skinId: string;
}

type Weather = 'clear' | 'cloudy' | 'rain';
let weatherBlend = { from: 'clear' as Weather, to: 'clear' as Weather, at: 0 };

/** Screenshot/debug override: pin the hour and the weather. */
let override: { progress?: number; weather?: Weather } = {};
export function setAmbientOverride(o: { progress?: number; weather?: Weather }): void {
  override = o;
  if (o.weather) weatherBlend = { from: o.weather, to: o.weather, at: 0 }; // snap, no crossfade
}

// --- time of day -----------------------------------------------------------
/** 0 = dawn at the first tile, 1 = night at the last. */
export function dayProgress(game: GameState): number {
  if (override.progress !== undefined) return override.progress;
  const placed = Object.keys(game.board).length;
  const total = placed + game.deck.length + (game.currentTile ? 1 : 0);
  if (game.phase === 'gameover') return 1;
  return Math.min(1, Math.max(0, (placed - 1) / Math.max(1, total - 1)));
}
/** `night` ramps 0→1 over the last stretch of the game; `lamps` starts a little
 *  earlier, so the first windows light up while the sky is still dusky. */
interface Light { r: number; g: number; b: number; a: number; night: number; lamps: number }
function lighting(p: number): Light {
  // Keyframes through the day: [progress, r, g, b, alpha]
  const keys: [number, number, number, number, number][] = [
    [0.00, 255, 160, 110, 0.16], // dawn
    [0.12, 255, 220, 170, 0.05],
    [0.30, 255, 255, 255, 0.00], // full day
    [0.62, 255, 255, 255, 0.00],
    [0.78, 255, 190, 100, 0.14], // golden hour
    [0.88, 150, 90, 140, 0.22],  // dusk
    [1.00, 40, 55, 110, 0.30],   // night: a blue wash, but every tile still readable
  ];
  let i = 0; while (i < keys.length - 2 && keys[i + 1]![0] <= p) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  const t = Math.min(1, Math.max(0, (p - a[0]) / (b[0] - a[0])));
  const mix = (x: number, y: number) => x + (y - x) * t;
  return { r: mix(a[1], b[1]), g: mix(a[2], b[2]), b: mix(a[3], b[3]), a: mix(a[4], b[4]), night: Math.max(0, (p - 0.85) / 0.15), lamps: Math.max(0, Math.min(1, (p - 0.8) / 0.15)) };
}

// --- weather ---------------------------------------------------------------
function weatherFor(game: GameState): Weather {
  if (override.weather) return override.weather;
  // Changes every dozen tiles, from a hash of the game so every viewer agrees.
  const epoch = Math.floor(Object.keys(game.board).length / 12);
  const h = ((epoch * 2654435761) ^ (game.players.length * 40503) ^ (game.deck.length ? 0 : 7)) >>> 0;
  const r = (h % 1000) / 1000;
  return r < 0.55 ? 'clear' : r < 0.82 ? 'cloudy' : 'rain';
}
function weatherMix(game: GameState, now: number): { clouds: number; rain: number } {
  const w = weatherFor(game);
  if (w !== weatherBlend.to) weatherBlend = { from: weatherBlend.to, to: w, at: now };
  const t = Math.min(1, (now - weatherBlend.at) / 4000);
  const lvl = (x: Weather) => ({ clear: [0.35, 0], cloudy: [1, 0], rain: [1, 1] }[x] as [number, number]);
  const a = lvl(weatherBlend.from), b = lvl(weatherBlend.to);
  return { clouds: a[0] + (b[0] - a[0]) * t, rain: a[1] + (b[1] - a[1]) * t };
}

// --- birds -----------------------------------------------------------------
interface Flock { x: number; y: number; vx: number; vy: number; birds: { dx: number; dy: number; phase: number }[]; born: number }
let flock: Flock | null = null;
let nextFlockAt = 0;
function updateBirds(v: AmbientView, night: number): void {
  const { now, bounds } = v;
  if (!flock && now > nextFlockAt && night < 0.5) {
    const fromLeft = Math.random() < 0.5;
    const w = bounds.maxX - bounds.minX + 6;
    const n = 3 + Math.floor(Math.random() * 5);
    flock = {
      x: fromLeft ? bounds.minX - 3 : bounds.maxX + 3,
      y: bounds.minY - 1 + Math.random() * (bounds.maxY - bounds.minY + 2),
      vx: (fromLeft ? 1 : -1) * (0.55 + Math.random() * 0.3), vy: (Math.random() - 0.5) * 0.2,
      birds: Array.from({ length: n }, (_, i) => ({ dx: -Math.abs(i - (n - 1) / 2) * 0.22 * (fromLeft ? 1 : -1), dy: (i - (n - 1) / 2) * 0.16, phase: Math.random() * 6 })),
      born: now,
    };
    nextFlockAt = now + w * 1000 + 15000 + Math.random() * 30000;
  }
  if (!flock) return;
  const age = (now - flock.born) / 1000;
  const fx = flock.x + flock.vx * age, fy = flock.y + flock.vy * age;
  if (fx < bounds.minX - 4 || fx > bounds.maxX + 4) { flock = null; return; }
  const { ctx, scale } = v;
  ctx.save();
  ctx.strokeStyle = `rgba(25,30,28,${0.75 - night * 0.4})`; ctx.lineWidth = Math.max(1, scale * 0.02); ctx.lineCap = 'round';
  for (const b of flock.birds) {
    const [sx, sy] = v.toScreen(fx + b.dx, fy + b.dy);
    const flap = Math.sin(now / 90 + b.phase) * 0.5 + 0.5; // 0..1
    const span = scale * 0.11, lift = scale * (0.02 + 0.06 * flap);
    ctx.beginPath();
    ctx.moveTo(sx - span, sy + lift); ctx.quadraticCurveTo(sx - span * 0.4, sy - lift * 0.3, sx, sy);
    ctx.quadraticCurveTo(sx + span * 0.4, sy - lift * 0.3, sx + span, sy + lift);
    ctx.stroke();
  }
  ctx.restore();
}

// --- clouds ----------------------------------------------------------------
const CLOUDS = Array.from({ length: 4 }, (_, i) => ({ x0: i * 3.7 + 1.3, y0: (i * 2.9) % 5 - 1, w: 2.2 + (i % 3) * 0.9, h: 1.3 + (i % 2) * 0.6, speed: 0.06 + i * 0.012 }));
function drawCloudShadows(v: AmbientView, strength: number): void {
  if (strength <= 0.01) return;
  const { ctx, bounds, now, scale } = v;
  const span = bounds.maxX - bounds.minX + 8;
  const ySpan = bounds.maxY - bounds.minY + 6;
  ctx.save();
  for (const c of CLOUDS) {
    const x = bounds.minX - 4 + ((c.x0 + (now / 1000) * c.speed) % span);
    const y = bounds.minY - 3 + ((c.y0 + (now / 1000) * c.speed * 0.15) % ySpan + ySpan) % ySpan;
    const [sx, sy] = v.toScreen(x, y);
    const rx = c.w * scale, ry = c.h * scale;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
    g.addColorStop(0, `rgba(10,20,25,${0.16 * strength})`); g.addColorStop(0.6, `rgba(10,20,25,${0.09 * strength})`); g.addColorStop(1, 'rgba(10,20,25,0)');
    ctx.fillStyle = g;
    ctx.save(); ctx.translate(sx, sy); ctx.scale(1, ry / rx); ctx.translate(-sx, -sy);
    ctx.beginPath(); ctx.arc(sx, sy, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// --- rain ------------------------------------------------------------------
function drawRain(v: AmbientView, strength: number): void {
  if (strength <= 0.01) return;
  const { ctx, cw, ch, now, scale } = v;
  ctx.save();
  ctx.fillStyle = `rgba(90,110,130,${0.10 * strength})`; ctx.fillRect(0, 0, cw, ch);
  ctx.strokeStyle = `rgba(220,235,245,${0.35 * strength})`; ctx.lineWidth = 1;
  const n = Math.floor(120 * strength);
  const len = Math.max(6, scale * 0.16), t = now / 1000;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    // Each drop has a fixed lane and falls on its own loop; cheap and seamless.
    const lane = (i * 7919) % 1000 / 1000, ph = (i * 104729) % 1000 / 1000;
    const x = (lane * (cw + 80) - 40 + ((t * 40) % 40)) % (cw + 80) - 40;
    const y = ((ph + t * (0.9 + lane * 0.4)) % 1) * (ch + len) - len;
    ctx.moveTo(x, y); ctx.lineTo(x - len * 0.25, y + len);
  }
  ctx.stroke();
  ctx.restore();
}

// --- cloister smoke ----------------------------------------------------------
interface Puff { x: number; y: number; born: number; drift: number }
let puffs: Puff[] = [];
let lastPuffCheck = 0;
function chimneys(game: GameState): [number, number][] {
  const out: [number, number][] = [];
  for (const [k, t] of Object.entries(game.board)) {
    const spec = TILE_TYPES[t.tileKey]!;
    if (!spec.monastery) continue;
    const [x, y] = k.split(',').map(Number) as [number, number];
    const [cx, cy] = monasteryCenter(spec);
    // Rotate the canonical chimney spot (a little right of and above the centre) with the tile.
    let px = (cx + 22) / 200, py = (cy - 30) / 200;
    for (let i = 0; i < ((t.rot % 4) + 4) % 4; i++) { const nx = 1 - py, ny = px; px = nx; py = ny; }
    out.push([x + px, y + py]);
  }
  return out;
}
function updateSmoke(v: AmbientView, wind: number): void {
  const { ctx, now, scale, game } = v;
  if (now - lastPuffCheck > 350) {
    lastPuffCheck = now;
    for (const [x, y] of chimneys(game)) if (Math.random() < 0.55) puffs.push({ x, y, born: now, drift: (Math.random() - 0.5) * 0.02 });
    if (puffs.length > 120) puffs = puffs.slice(-120);
  }
  puffs = puffs.filter((p) => now - p.born < 4200);
  ctx.save();
  for (const p of puffs) {
    const age = (now - p.born) / 1000;
    const wx = p.x + (p.drift + wind * 0.03) * age + Math.sin(age * 2 + p.x) * 0.012;
    const wy = p.y - 0.06 * age;
    const [sx, sy] = v.toScreen(wx, wy);
    const r = scale * (0.018 + 0.02 * age);
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(225,225,220,${Math.max(0, 0.42 - age * 0.1)})`; ctx.fill();
  }
  ctx.restore();
}

// --- fireflies (night) -----------------------------------------------------
function drawFireflies(v: AmbientView, night: number): void {
  if (night <= 0.05) return;
  const { ctx, bounds, now, scale } = v;
  ctx.save();
  const n = 28;
  for (let i = 0; i < n; i++) {
    const s1 = (i * 7919) % 1000 / 1000, s2 = (i * 104729) % 1000 / 1000, s3 = (i * 1299709) % 1000 / 1000;
    const t = now / 1000;
    const x = bounds.minX + s1 * (bounds.maxX - bounds.minX + 1) + Math.sin(t * 0.5 + i) * 0.4;
    const y = bounds.minY + s2 * (bounds.maxY - bounds.minY + 1) + Math.cos(t * 0.4 + i * 1.7) * 0.3;
    const glow = Math.max(0, Math.sin(t * (1.5 + s3) + i * 2.1)) ** 3 * night;
    if (glow < 0.05) continue;
    const [sx, sy] = v.toScreen(x, y);
    const r = Math.max(2, scale * 0.03);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 3);
    g.addColorStop(0, `rgba(230,255,140,${0.9 * glow})`); g.addColorStop(0.4, `rgba(200,240,90,${0.35 * glow})`); g.addColorStop(1, 'rgba(200,240,90,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// --- night lights ------------------------------------------------------------
// Once the light goes, the board lights itself: windows in the city houses, torches
// at crossroads, city gates and keeps, a lantern by every cloister door. Positions
// are worked out once per tile type in tile-local coordinates and rotated into
// place per tile, so the lamps stay put from frame to frame.
type LampKind = 'window' | 'torch' | 'lantern';
interface Lamp { x: number; y: number; kind: LampKind; phase: number } // x,y in 0..1 tile units
const lampCache = new Map<string, Lamp[]>();
let probeCtx: CanvasRenderingContext2D | null = null;
function lampsFor(tileKey: string): Lamp[] {
  const hit = lampCache.get(tileKey);
  if (hit) return hit;
  const t = TILE_TYPES[tileKey]!;
  if (!probeCtx) probeCtx = document.createElement('canvas').getContext('2d')!;
  const ctx = probeCtx;
  const rng = seeded('lamps:' + tileKey);
  const out: Lamp[] = [];
  const push = (pt: Pt, kind: LampKind) => out.push({ x: pt[0] / 200, y: pt[1] / 200, kind, phase: rng() * Math.PI * 2 });
  const cities = t.cityGroups.map((_, gi) => cityPath(t, gi));
  // A handful of lit windows per city, scattered where the houses stand.
  cities.forEach((city) => { for (const p of cityInteriorSpots(ctx, city, rng, 4, 9)) push(p, 'window'); });
  // Torches where a road runs up to a city wall: walk each road in from its edge
  // and stop at the first step that is inside a city.
  const MID: Pt[] = [[100, 0], [200, 100], [100, 200], [0, 100]];
  for (const grp of t.roadGroups) {
    for (const side of grp) {
      const [ax, ay] = MID[side]!;
      const [bx, by] = grp.length === 2 ? MID[grp.find((s) => s !== side)!]! : [100, 100];
      let prev: Pt = [ax, ay];
      for (let k = 1; k <= 24; k++) {
        const f = k / 24;
        const cur: Pt = [ax + (bx - ax) * f, ay + (by - ay) * f];
        if (cities.some((c) => ctx.isPointInPath(c, cur[0], cur[1]))) {
          // Flank the gate: one torch either side of the road, just outside the wall.
          const dx = cur[0] - prev[0], dy = cur[1] - prev[1], len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len * 26, ny = dx / len * 26;
          push([prev[0] + nx, prev[1] + ny], 'torch'); push([prev[0] - nx, prev[1] - ny], 'torch');
          break;
        }
        prev = cur;
      }
    }
  }
  if (hasJunction(t)) push([100, 100], 'torch');
  if (t.shield) push(shieldAnchor(t), 'torch');
  if (t.monastery) { const [mx, my] = monasteryCenter(t); push([mx - 22, my + 34], 'lantern'); }
  lampCache.set(tileKey, out);
  return out;
}

/** Soft glow sprites, drawn once, so a frame full of lamps is just cheap blits. */
const glowSprites = new Map<LampKind, HTMLCanvasElement>();
function glowSprite(kind: LampKind): HTMLCanvasElement {
  const hit = glowSprites.get(kind);
  if (hit) return hit;
  const S = 96, c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  if (kind === 'torch') { g.addColorStop(0, 'rgba(255,225,150,0.95)'); g.addColorStop(0.12, 'rgba(255,170,60,0.7)'); g.addColorStop(0.45, 'rgba(255,120,30,0.18)'); g.addColorStop(1, 'rgba(255,100,20,0)'); }
  else if (kind === 'lantern') { g.addColorStop(0, 'rgba(255,235,180,0.9)'); g.addColorStop(0.2, 'rgba(255,200,110,0.5)'); g.addColorStop(1, 'rgba(255,190,100,0)'); }
  else { g.addColorStop(0, 'rgba(255,215,130,0.85)'); g.addColorStop(0.25, 'rgba(255,190,100,0.35)'); g.addColorStop(1, 'rgba(255,180,90,0)'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  glowSprites.set(kind, c);
  return c;
}

function drawNightLights(v: AmbientView, lamps: number): void {
  if (lamps <= 0.02) return;
  const { ctx, scale, game, now, cw, ch } = v;
  const radius: Record<LampKind, number> = { window: 0.11, torch: 0.26, lantern: 0.16 };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [k, tile] of Object.entries(game.board)) {
    const [tx, ty] = k.split(',').map(Number) as [number, number];
    const rot = ((tile.rot % 4) + 4) % 4;
    for (const lamp of lampsFor(tile.tileKey)) {
      let px = lamp.x, py = lamp.y;
      for (let i = 0; i < rot; i++) { const nx = 1 - py, ny = px; px = nx; py = ny; }
      const [sx, sy] = v.toScreen(tx + px, ty + py);
      const r = scale * radius[lamp.kind];
      if (sx < -r || sy < -r || sx > cw + r || sy > ch + r) continue;
      // Torches gutter; windows only breathe.
      const flicker = lamp.kind === 'torch'
        ? 0.78 + 0.22 * Math.sin(now / 90 + lamp.phase) * Math.sin(now / 37 + lamp.phase * 1.7)
        : 0.92 + 0.08 * Math.sin(now / 900 + lamp.phase);
      ctx.globalAlpha = lamps * flicker;
      ctx.drawImage(glowSprite(lamp.kind), sx - r, sy - r, r * 2, r * 2);
    }
  }
  ctx.restore();
}

/** Layers that sit on the table under the UI: cloud shadows, smoke, light. Call
 *  after tiles and meeples are drawn, before markers and tooltips. */
export function drawAmbientUnder(v: AmbientView): void {
  const light = lighting(dayProgress(v.game));
  const wx = weatherMix(v.game, v.now);
  drawCloudShadows(v, wx.clouds * (1 - light.night * 0.6));
  updateSmoke(v, 1);
  if (light.a > 0.005) {
    const { ctx, cw, ch } = v;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${Math.round(255 - (255 - light.r) * light.a * 2.2)},${Math.round(255 - (255 - light.g) * light.a * 2.2)},${Math.round(255 - (255 - light.b) * light.a * 2.2)})`;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }
  drawNightLights(v, light.lamps);
  drawFireflies(v, light.night);
}

/** Layers above everything: rain and birds. */
export function drawAmbientOver(v: AmbientView): void {
  const light = lighting(dayProgress(v.game));
  const wx = weatherMix(v.game, v.now);
  drawRain(v, wx.rain);
  updateBirds(v, light.night);
}

/** For the settings/debug hook: what the sky is doing right now. */
export function ambientStatus(game: GameState): { progress: number; weather: Weather; night: number; flock: boolean; puffs: number } {
  const p = dayProgress(game);
  return { progress: p, weather: weatherFor(game), night: lighting(p).night, flock: !!flock, puffs: puffs.length };
}
