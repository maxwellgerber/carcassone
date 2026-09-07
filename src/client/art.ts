// Tile art: each of the 24 canonical tile types is a hand-authored SVG (see
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

// The two shield-bearing road variants (base-game types O and S) share every line
// of their art with the unshielded tile except the shield itself, so rather than
// keep two more 50–250 KB SVGs in sync by hand, the shield is composited on here —
// the same group the hand-drawn shield tiles use, at the same spot.
const SHIELD_SVG = `<g transform="translate(100 100)">
<path d="M-14,-16 L14,-16 V3 Q13,14 0,21 Q-13,14 -14,3Z" fill="#294940" opacity=".55" transform="translate(2 3)"/>
<path d="M-14,-16 L14,-16 V3 Q13,14 0,21 Q-13,14 -14,3Z" fill="#d4b16c" stroke="#243f36" stroke-width="1.8"/>
<path d="M-10,-12 H10 V3 Q9,10 0,16 Q-9,10 -10,3Z" fill="#326b61" stroke="#f0d998" stroke-width="1"/>
<path d="M0,-8 L3,-2 L8,0 L3,3 L0,10 L-3,3 L-8,0 L-3,-2Z" fill="#edd293"/>
<circle cx="0" cy="0" r="2" fill="#b47d45"/>
</g>`;
function withShield(svg: string, title: string): string {
  const retitled = svg.replace(/<title>[^<]*<\/title>/, `<title>${title} — Verdigris Atlas</title>`);
  const end = retitled.lastIndexOf('</g></svg>');
  if (end === -1) throw new Error('tile SVG does not end with the expected </g></svg>');
  return retitled.slice(0, end) + SHIELD_SVG + '</g></svg>';
}
const city_adjacent_shield_road = withShield(city_adjacent_road, 'Grand Walled Corner');
const city_three_shield_road = withShield(city_three_road, 'Fortress Gate');

const TILE_SVG: Record<string, string> = {
  monastery_plain, monastery_road, city_cap, city_cap_road_straight, city_cap_road_curve_a,
  city_cap_road_curve_b, city_cap_3way, city_opposite_shield, city_opposite, city_opposite_separate,
  city_adjacent_separate, city_adjacent_shield, city_adjacent, city_adjacent_road, city_adjacent_shield_road,
  city_three_shield, city_three, city_three_road, city_three_shield_road, city_four_shield,
  road_straight, road_curve, road_fork, road_cross,
};

import { SKINS, currentSkin, onSkinChange } from './skins/index.js';

const tileImages = new Map<string, HTMLImageElement>();

/** Decode every tile SVG into an Image up front. 24 small inline data: URIs decode
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

onSkinChange(() => tileCanvasCache.clear());

/** Canonical (unrotated) art for a tile in the active skin: the SVG image for the
 *  hand-drawn set, or a freshly painted canvas for a procedural skin. */
const canonicalCache = new Map<string, HTMLCanvasElement>();
function canonicalArt(tileKey: string, size: number): CanvasImageSource | null {
  const skin = currentSkin();
  if (!skin.paint) return tileImages.get(tileKey) ?? null;
  const k = `${skin.id}:${tileKey}:${size}`;
  const cached = canonicalCache.get(k);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.save(); ctx.scale(size / 200, size / 200);
  ctx.beginPath(); ctx.rect(0, 0, 200, 200); ctx.clip();
  skin.paint(ctx, tileKey);
  ctx.restore();
  canonicalCache.set(k, canvas);
  return canvas;
}

/** A tile drawn in a specific skin (for previews in the skin picker). */
export function getTileCanvasIn(skinId: string, tileKey: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const skin = SKINS.find((s) => s.id === skinId);
  if (skin?.paint) { ctx.save(); ctx.scale(size / 200, size / 200); skin.paint(ctx, tileKey); ctx.restore(); }
  else { const img = tileImages.get(tileKey); if (img) ctx.drawImage(img, 0, 0, size, size); }
  return canvas;
}

export function getTileCanvas(tileKey: string, rot: number, size: number): HTMLCanvasElement {
  const k = `${currentSkin().id}:${tileKey}:${rot}:${size}`;
  const cached = tileCanvasCache.get(k);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = canonicalArt(tileKey, size);
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

export type MeepleLook = 'plain' | 'city' | 'road' | 'monastery' | 'farm';

/** A meeple in a player's colour. `look` dresses it for its job: the knight gets a
 *  helmet and shield, the highwayman a bandanna and a sack of loot, the monk a
 *  hood and a rope belt, the farmer lies down in the field with a straw hat and a
 *  rake. `plain` is the bare token used for reserves and swatches. */
export function getMeepleCanvas(color: string, size: number, look: MeepleLook | boolean = 'plain'): HTMLCanvasElement {
  const kind: MeepleLook = look === true ? 'farm' : look === false ? 'plain' : look;
  const k = `${color}:${size}:${kind}`;
  const cached = meepleCache.get(k);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const u = size / 100; // draw in a 100-unit space
  ctx.save();
  ctx.translate(size / 2, size / 2);
  if (kind === 'farm') ctx.rotate(-Math.PI / 2);
  ctx.translate(-size / 2, -size / 2);
  ctx.scale(u, u);
  ctx.lineJoin = 'round';

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(50, 86, 28, 8, 0, 0, Math.PI * 2); ctx.fill();

  // The classic silhouette
  const body = new Path2D(`M50,8 C62,8 66,22 58,30 L74,46 C82,50 80,60 70,60 L62,56 L70,86 C72,92 66,94 60,90 L52,68 L48,68 L40,90 C34,94 28,92 30,86 L38,56 L30,60 C20,60 18,50 26,46 L42,30 C34,22 38,8 50,8 Z`);
  ctx.fillStyle = color; ctx.fill(body);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2; ctx.stroke(body);
  // A soft highlight so the token reads as a solid little figure.
  ctx.save(); ctx.clip(body);
  const hl = ctx.createLinearGradient(30, 10, 70, 90);
  hl.addColorStop(0, 'rgba(255,255,255,0.28)'); hl.addColorStop(0.5, 'rgba(255,255,255,0)'); hl.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = hl; ctx.fillRect(0, 0, 100, 100);
  ctx.restore();

  const ink = 'rgba(30,25,20,0.85)';
  if (kind === 'city') {
    // Helmet with a nose guard and a plume, and a small kite shield on the arm.
    ctx.fillStyle = '#d7dbe0'; ctx.strokeStyle = ink; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(38, 20); ctx.quadraticCurveTo(50, 2, 62, 20); ctx.lineTo(62, 24); ctx.lineTo(38, 24); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(50, 24); ctx.lineTo(50, 31); ctx.stroke();
    ctx.fillStyle = '#c8433a'; ctx.beginPath(); ctx.moveTo(50, 6); ctx.quadraticCurveTo(62, -2, 68, 8); ctx.quadraticCurveTo(60, 6, 54, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8c766';
    ctx.beginPath(); ctx.moveTo(18, 48); ctx.lineTo(34, 48); ctx.lineTo(34, 62); ctx.quadraticCurveTo(26, 72, 18, 62); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#8a3a2a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(26, 50); ctx.lineTo(26, 64); ctx.moveTo(20, 56); ctx.lineTo(32, 56); ctx.stroke();
  } else if (kind === 'road') {
    // Bandanna over the face, a headscarf knot, and a sack of loot over the shoulder.
    ctx.fillStyle = '#b8342c'; ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(37, 22); ctx.lineTo(63, 22); ctx.quadraticCurveTo(58, 34, 50, 34); ctx.quadraticCurveTo(42, 34, 37, 22); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(63, 22); ctx.lineTo(70, 16); ctx.lineTo(68, 24); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#a8845a';
    ctx.beginPath(); ctx.ellipse(74, 40, 10, 12, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#5a3d20'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(66, 30); ctx.lineTo(56, 22); ctx.stroke();
    ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(69, 31); ctx.lineTo(75, 33); ctx.stroke();
  } else if (kind === 'monastery') {
    // A hood drawn up, a rope belt, and a small cross.
    ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(34, 30); ctx.quadraticCurveTo(38, 4, 50, 4); ctx.quadraticCurveTo(62, 4, 66, 30); ctx.quadraticCurveTo(58, 24, 50, 24); ctx.quadraticCurveTo(42, 24, 34, 30); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#d9c48a'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(38, 60); ctx.quadraticCurveTo(50, 66, 62, 60); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(52, 62); ctx.lineTo(54, 74); ctx.stroke();
    ctx.strokeStyle = '#f2e6c4'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(50, 40); ctx.lineTo(50, 54); ctx.moveTo(45, 45); ctx.lineTo(55, 45); ctx.stroke();
  } else if (kind === 'farm') {
    // Straw hat and a rake held along the body (the figure lies down in the field).
    ctx.fillStyle = '#e2c46a'; ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(50, 14, 22, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(38, 14); ctx.quadraticCurveTo(50, -6, 62, 14); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(78, 30); ctx.lineTo(78, 92); ctx.stroke();
    ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(70, 30); ctx.lineTo(86, 30); ctx.stroke();
    for (let x = 70; x <= 86; x += 4) { ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, 22); ctx.stroke(); }
    ctx.strokeStyle = ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(69, 21); ctx.lineTo(87, 21); ctx.lineTo(87, 31); ctx.lineTo(69, 31); ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
  meepleCache.set(k, canvas);
  return canvas;
}
