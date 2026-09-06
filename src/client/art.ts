// Tile art: each of the 22 canonical tile types is a hand-authored SVG (see
// docs/tile-geometry-contract.md) in the "Verdigris Gearworks" style, drawn once
// in canonical (unrotated) orientation. Rotation to any of the 4 orientations is
// done via canvas transform at draw time — the SVGs are never re-authored per
// rotation, which is exactly what keeps every tile's edges aligned regardless of
// which artist (or agent) drew which tile: the underlying geometry is locked, only
// the decoration varies.
import monastery_plain from './tiles/monastery_plain.svg';
import monastery_road from './tiles/monastery_road.svg';
import city_cap from './tiles/city_cap.svg';
import city_cap_road_straight from './tiles/city_cap_road_straight.svg';
import city_cap_road_curve_a from './tiles/city_cap_road_curve_a.svg';
import city_cap_road_curve_b from './tiles/city_cap_road_curve_b.svg';
import city_cap_3way from './tiles/city_cap_3way.svg';
import city_opposite_shield from './tiles/city_opposite_shield.svg';
import city_opposite from './tiles/city_opposite.svg';
import city_opposite_separate from './tiles/city_opposite_separate.svg';
import city_adjacent_separate from './tiles/city_adjacent_separate.svg';
import city_adjacent_shield from './tiles/city_adjacent_shield.svg';
import city_adjacent from './tiles/city_adjacent.svg';
import city_adjacent_road from './tiles/city_adjacent_road.svg';
import city_three_shield from './tiles/city_three_shield.svg';
import city_three from './tiles/city_three.svg';
import city_three_road from './tiles/city_three_road.svg';
import city_four_shield from './tiles/city_four_shield.svg';
import road_straight from './tiles/road_straight.svg';
import road_curve from './tiles/road_curve.svg';
import road_fork from './tiles/road_fork.svg';
import road_cross from './tiles/road_cross.svg';

const TILE_SVG: Record<string, string> = {
  monastery_plain, monastery_road, city_cap, city_cap_road_straight, city_cap_road_curve_a,
  city_cap_road_curve_b, city_cap_3way, city_opposite_shield, city_opposite, city_opposite_separate,
  city_adjacent_separate, city_adjacent_shield, city_adjacent, city_adjacent_road,
  city_three_shield, city_three, city_three_road, city_four_shield,
  road_straight, road_curve, road_fork, road_cross,
};

const tileImages = new Map<string, HTMLImageElement>();

/** Decode every tile SVG into an Image up front. 22 small inline data: URIs decode
 *  in well under a frame — call this once at boot, before the first board render,
 *  rather than lazily (an <img> with a data: URI is technically async to decode,
 *  and the board draw path is synchronous). */
export function preloadTileArt(): Promise<void> {
  const loads = Object.entries(TILE_SVG).map(([key, svg]) => new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => { tileImages.set(key, img); resolve(); };
    img.onerror = () => reject(new Error(`Failed to decode tile art for "${key}"`));
    img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }));
  return Promise.all(loads).then(() => undefined);
}

const tileCanvasCache = new Map<string, HTMLCanvasElement>();

export function getTileCanvas(tileKey: string, rot: number, size: number): HTMLCanvasElement {
  const k = `${tileKey}:${rot}:${size}`;
  const cached = tileCanvasCache.get(k);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = tileImages.get(tileKey);
  if (img) {
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate((((rot % 4) + 4) % 4) * (Math.PI / 2));
    ctx.translate(-size / 2, -size / 2);
    ctx.drawImage(img, 0, 0, size, size);
    ctx.restore();
  } else {
    // Should be unreachable once preloadTileArt() has resolved; fail loud rather
    // than silently drawing nothing if a tile key is ever missing art.
    ctx.fillStyle = '#c04040';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#fff';
    ctx.font = `${size * 0.12}px sans-serif`;
    ctx.fillText(`missing art: ${tileKey}`, 4, size / 2);
  }
  tileCanvasCache.set(k, canvas);
  return canvas;
}

// ---------------------------------------------------------------------------
// Tile back (deck stack / face-down preview) and meeples remain procedural —
// simple enough that hand-authored SVG wasn't worth commissioning separately.
// ---------------------------------------------------------------------------
const miscCache = new Map<string, HTMLCanvasElement>();

export function getTileBackCanvas(size: number): HTMLCanvasElement {
  const k = `back:${size}`;
  const cached = miscCache.get(k);
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
  miscCache.set(k, canvas);
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
