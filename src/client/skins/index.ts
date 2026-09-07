// Skins: a complete look for the game — a tileset plus the matching UI palette and
// table colour. The original hand-illustrated "Verdigris Gearworks" set is the
// default; the others are painted procedurally on the canvas against the same
// edge contract, so any skin's tiles seam with any other's.
import type { Skin } from './types.js';
import { parchment } from './parchment.js';
import { neon } from './neon.js';
import { storybook } from './storybook.js';

export type { Skin } from './types.js';

/** Green baize with the workshop's engraved cross-hatch and a brass rivet at each
 *  corner of the repeat — the table the original tiles were drawn to sit on. */
function verdigrisTable(ctx: CanvasRenderingContext2D): void {
  const T = 400;
  ctx.fillStyle = '#4a6357'; ctx.fillRect(0, 0, T, T);
  ctx.strokeStyle = 'rgba(20,40,34,0.22)'; ctx.lineWidth = 1;
  for (let d = -T; d < T * 2; d += 10) { ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + T, T); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(160,200,180,0.08)';
  for (let d = -T; d < T * 2; d += 10) { ctx.beginPath(); ctx.moveTo(d + T, 0); ctx.lineTo(d, T); ctx.stroke(); }
  // A soft vignette per repeat gives the felt some nap without a visible seam.
  const g = ctx.createRadialGradient(200, 200, 40, 200, 200, 300);
  g.addColorStop(0, 'rgba(255,255,255,0.04)'); g.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, T, T);
  // Brass rivets on the 200-unit grid (tile corners), with a subtle engraved ring.
  for (const [x, y] of [[0, 0], [200, 0], [0, 200], [200, 200]] as [number, number][]) {
    for (const [dx, dy] of [[0, 0], [T, 0], [0, T], [T, T]] as [number, number][]) {
      const cx = x + dx, cy = y + dy;
      if (cx > T || cy > T) continue;
      ctx.beginPath(); ctx.arc(cx, cy, 5.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
      const b = ctx.createRadialGradient(cx - 1.5, cy - 1.5, 0.5, cx, cy, 4.5);
      b.addColorStop(0, '#f0d998'); b.addColorStop(0.6, '#b8923f'); b.addColorStop(1, '#6e5220');
      ctx.beginPath(); ctx.arc(cx, cy, 4.2, 0, Math.PI * 2); ctx.fillStyle = b; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(212,184,90,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
}

export const verdigris: Skin = {
  id: 'verdigris',
  name: 'Verdigris Gearworks',
  blurb: 'The original: patinated brass, cross-hatched shading, hand-drawn tiles.',
  ui: {},
  board: ['#5F7A6E', '#3E534A'],
  table: verdigrisTable,
};

export const SKINS: Skin[] = [verdigris, parchment, neon, storybook];

const PREF = 'carcassonne.skin';
let current: Skin = (() => {
  try { return SKINS.find((s) => s.id === localStorage.getItem(PREF)) ?? verdigris; } catch { return verdigris; }
})();

export function currentSkin(): Skin { return current; }

const listeners = new Set<(s: Skin) => void>();
export function onSkinChange(fn: (s: Skin) => void): void { listeners.add(fn); }

export function setSkin(id: string): void {
  const next = SKINS.find((s) => s.id === id);
  if (!next || next === current) return;
  current = next;
  try { localStorage.setItem(PREF, id); } catch { /* fine, just not remembered */ }
  applySkinToDocument();
  for (const fn of listeners) fn(next);
}

/** Push the skin's palette onto :root. The default skin clears the overrides so
 *  the stylesheet's own light/dark handling takes over again. */
export function applySkinToDocument(): void {
  const root = document.documentElement;
  const vars = ['--bg', '--panel', '--ink', '--ink-soft', '--accent', '--accent-2', '--danger', '--panel-border', '--shadow'];
  for (const v of vars) root.style.removeProperty(v);
  for (const [k, v] of Object.entries(current.ui)) root.style.setProperty(k, v);
  root.dataset.skin = current.id;
}
