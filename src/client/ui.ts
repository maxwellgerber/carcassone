import type { MeepleKind } from '../shared/types.js';
import { getMeepleCanvas } from './art.js';
import { h } from './dom.js';

export function paintMeepleSwatches(container: HTMLElement): void {
  container.querySelectorAll<HTMLCanvasElement>('canvas.meeple-swatch[data-color]').forEach((cv) => {
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(getMeepleCanvas(cv.getAttribute('data-color')!, cv.width, false), 0, 0);
  });
}

export const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** The player's unplaced meeples, drawn as a stack: solid ones are in hand, faint
 *  outlines are out on the board earning their keep. */
export function reserveStack(color: string, inHand: number, total: number): HTMLElement {
  const size = 30, step = 16;
  const cv = h('canvas', { width: step * (total - 1) + size + 6, height: size + 8 }) as HTMLCanvasElement;
  const ctx = cv.getContext('2d')!;
  for (let i = 0; i < total; i++) {
    const x = 3 + i * step, y = 4 + (i % 2) * 3;
    ctx.globalAlpha = i < inHand ? 1 : 0.22;
    ctx.drawImage(getMeepleCanvas(color, size, false), x, y, size, size);
  }
  ctx.globalAlpha = 1;
  return h('div', { class: 'meeple-reserve', title: `${inHand} of ${total} meeples in reserve` },
    cv,
    h('span', { class: 'meeple-reserve-count' }, `${inHand}`, h('small', {}, ` / ${total}`)),
  );
}

export function kindNoun(kind: MeepleKind): string {
  return { city: 'claim this city', road: 'claim this road', monastery: 'claim this cloister', farm: 'claim this field' }[kind];
}

/** Keep the board repainting while ghost meeples are on it so they can pulse; stops
 *  itself the moment there is nothing left to animate. */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
