// Skins: a complete look for the game — a tileset plus the matching UI palette and
// table colour. The original hand-illustrated "Verdigris Gearworks" set is the
// default; the others are painted procedurally on the canvas against the same
// edge contract, so any skin's tiles seam with any other's.
import type { Skin } from './types.js';
import { parchment } from './parchment.js';
import { neon } from './neon.js';
import { storybook } from './storybook.js';

export type { Skin } from './types.js';

export const verdigris: Skin = {
  id: 'verdigris',
  name: 'Verdigris Gearworks',
  blurb: 'The original: patinated brass, cross-hatched shading, hand-drawn tiles.',
  ui: {},
  board: ['#5F7A6E', '#3E534A'],
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
