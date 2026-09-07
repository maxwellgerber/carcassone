// "Parchment Atlas": an old cartographer's survey — foxed cream paper, sepia ink
// linework, cross-hatched city blocks, dotted roads, a compass rose on the cloister.
import { SIZE, ROAD_W, JUNCTION_R, layoutFor, seeded, scatterOpen, cityInteriorSpots, cityPath, strokeRoad, strokeWalls, hasJunction, roundRect, shieldPath, shieldAnchor, drawRiver, monasteryCenter } from './geometry.js';
import type { Skin } from './types.js';

const INK = '#4a3524';
const INK_SOFT = 'rgba(74,53,36,0.55)';
const PAPER = '#ecdfbf';
const PAPER_DARK = '#d9c79c';
const CITY = '#cdb88a';
const ROAD = '#e6d7b3';

function paperTexture(ctx: CanvasRenderingContext2D, rng: () => number): void {
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, SIZE, SIZE);
  // Foxing and fibres.
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(150,110,60,${0.04 + rng() * 0.07})`;
    ctx.beginPath(); ctx.ellipse(rng() * SIZE, rng() * SIZE, 3 + rng() * 9, 2 + rng() * 5, rng() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(120,90,50,0.10)'; ctx.lineWidth = 0.6;
  for (let i = 0; i < 40; i++) { const x = rng() * SIZE, y = rng() * SIZE; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 6); ctx.stroke(); }
}

function hatch(ctx: CanvasRenderingContext2D, clip: Path2D, spacing: number, angle: number, style: string, width = 0.8): void {
  ctx.save(); ctx.clip(clip);
  ctx.strokeStyle = style; ctx.lineWidth = width;
  ctx.translate(100, 100); ctx.rotate(angle);
  for (let d = -300; d <= 300; d += spacing) { ctx.beginPath(); ctx.moveTo(d, -300); ctx.lineTo(d, 300); ctx.stroke(); }
  ctx.restore();
}

function inkHouse(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rng: () => number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate((rng() - 0.5) * 0.12);
  ctx.fillStyle = '#e9dcbb'; ctx.strokeStyle = INK; ctx.lineWidth = 1.1; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.rect(-w / 2, -h / 2 + 4, w, h - 4); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-w / 2 - 1.5, -h / 2 + 4); ctx.lineTo(0, -h / 2 - 3); ctx.lineTo(w / 2 + 1.5, -h / 2 + 4); ctx.closePath();
  ctx.fillStyle = '#c8b087'; ctx.fill(); ctx.stroke();
  ctx.strokeStyle = INK_SOFT; ctx.lineWidth = 0.7;
  for (let i = -w / 2 + 3; i < w / 2 - 2; i += 3.2) { ctx.beginPath(); ctx.moveTo(i, -h / 2 + 6); ctx.lineTo(i, h / 2 - 2); ctx.stroke(); }
  ctx.fillStyle = INK; ctx.fillRect(-1.2, h / 2 - 5, 2.4, 3.5);
  ctx.restore();
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.fillStyle = 'rgba(120,130,80,0.25)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y + r); ctx.lineTo(x, y + r + 3); ctx.stroke();
  ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.2, r * 0.5, Math.PI * 0.9, Math.PI * 1.9); ctx.stroke();
}

function hills(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.strokeStyle = INK_SOFT; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x, y - w * 0.7, x + w, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w * 0.3, y - w * 0.25); ctx.quadraticCurveTo(x + w * 0.6, y - w * 0.45, x + w * 1.4, y); ctx.stroke();
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x - w * 0.5 + i * 3, y - 2 - i * 2); ctx.lineTo(x - w * 0.5 + i * 3 + 4, y - 6 - i * 2); ctx.stroke(); }
}

function compassRose(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.fillStyle = '#efe4c6';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, len = i % 2 === 0 ? r * 0.95 : r * 0.55;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.lineTo(Math.cos(a + 0.35) * len * 0.3, Math.sin(a + 0.35) * len * 0.3); ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? INK : '#b0412e'; ctx.fill();
  }
  ctx.fillStyle = INK; ctx.font = `bold ${r * 0.5}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, -r * 1.3);
  ctx.restore();
}

function paint(ctx: CanvasRenderingContext2D, key: string): void {
  const L = layoutFor(key);
  const { t } = L;
  const rng = seeded('parchment:' + key);
  paperTexture(ctx, rng);

  // Field decoration: hill hatching and little inked trees.
  for (const [x, y] of scatterOpen(ctx, L, rng, 3, 16)) hills(ctx, x, y, 12 + rng() * 6);
  for (const [x, y] of scatterOpen(ctx, L, rng, 7, 7)) tree(ctx, x, y, 3 + rng() * 2.5);

  // Roads: a pale band with a double ink edge and a dotted centre line.
  if (t.roadGroups.length) {
    strokeRoad(ctx, L.roads, ROAD_W + 1.6, INK); // ink outline, under the band
    strokeRoad(ctx, L.roads, ROAD_W - 1.6, ROAD);
    strokeRoad(ctx, L.roads, 1.1, INK_SOFT, [3, 4]); // dotted centre line
    if (hasJunction(t)) {
      ctx.fillStyle = ROAD; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(100, 100, JUNCTION_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Village: a ring of tiny houses around a market cross.
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * Math.PI * 2) / 5; inkHouse(ctx, 100 + Math.cos(a) * 34, 100 + Math.sin(a) * 34, 11, 11, rng); }
      ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(100, 108); ctx.lineTo(100, 90); ctx.moveTo(95, 95); ctx.lineTo(105, 95); ctx.stroke();
    }
  }

  // Cities: hatched blocks with an inked crenellated wall.
  drawRiver(ctx, t, { water: '#cfd6c6', deep: '#c2ccbf', bank: '#a9a184', foam: 'rgba(74,53,36,0.45)', bridgeDeck: '#e6d7b3', bridgeRail: INK }, rng);

  t.cityGroups.forEach((_, gi) => {
    const city = cityPath(t, gi);
    ctx.fillStyle = CITY; ctx.fill(city);
    hatch(ctx, city, 4.5, Math.PI / 4, 'rgba(74,53,36,0.28)');
    hatch(ctx, city, 9, -Math.PI / 4, 'rgba(74,53,36,0.16)');
    for (const [x, y] of cityInteriorSpots(ctx, city, rng, 7, 9)) inkHouse(ctx, x, y, 12 + rng() * 6, 12 + rng() * 5, rng);
  });
  strokeWalls(ctx, t, 3.2, PAPER_DARK);
  strokeWalls(ctx, t, 1.6, INK);
  strokeWalls(ctx, t, 1.1, INK, [3, 3]); // battlements

  if (t.monastery) {
    const [mx, my] = monasteryCenter(t); ctx.save(); ctx.translate(mx - 100, my - 100);
    compassRose(ctx, 100, 100, 26);
    // The chapel itself, small, to the south of the rose.
    ctx.save(); ctx.translate(100, 152);
    ctx.fillStyle = '#e9dcbb'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(-18, -10, 36, 18); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-20, -10); ctx.lineTo(0, -22); ctx.lineTo(20, -10); ctx.closePath(); ctx.fillStyle = '#c8b087'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(0, -30); ctx.moveTo(-3, -27); ctx.lineTo(3, -27); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  if (t.shield) {
    const [ax, ay] = shieldAnchor(t);
    ctx.save(); ctx.translate(ax - 100, ay - 100);
    const p = shieldPath(100, 100, 0.9);
    ctx.fillStyle = '#b0412e'; ctx.fill(p);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke(p);
    ctx.strokeStyle = '#efe4c6'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(100, 89); ctx.lineTo(100, 113); ctx.moveTo(90, 98); ctx.lineTo(110, 98); ctx.stroke();
    ctx.restore();
  }

  // Cartouche-style corner marks and a thin ink border.
  ctx.strokeStyle = INK_SOFT; ctx.lineWidth = 1;
  roundRect(ctx, 1, 1, SIZE - 2, SIZE - 2, 0); ctx.stroke();
}

/** The table is the uncharted sea around the survey: pale wash, inked wave ticks,
 *  rhumb lines, and a sea serpent where the cartographer ran out of coastline. */
function table(ctx: CanvasRenderingContext2D): void {
  const T = 400;
  const rng = seeded('parchment:table');
  ctx.fillStyle = '#d6cfae'; ctx.fillRect(0, 0, T, T);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(140,100,50,${0.03 + rng() * 0.05})`;
    ctx.beginPath(); ctx.ellipse(rng() * T, rng() * T, 4 + rng() * 14, 3 + rng() * 7, rng() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  // Rhumb lines radiating from a point well inside the tile — they run off the edges,
  // but faintly enough that the repeat reads as texture rather than a grid.
  ctx.strokeStyle = 'rgba(74,53,36,0.10)'; ctx.lineWidth = 0.8;
  for (let i = 0; i < 16; i++) { const a = (i * Math.PI) / 8; ctx.beginPath(); ctx.moveTo(200, 200); ctx.lineTo(200 + Math.cos(a) * 320, 200 + Math.sin(a) * 320); ctx.stroke(); }
  // Wave ticks in staggered rows: the cartographer's shorthand for open water.
  ctx.strokeStyle = 'rgba(74,53,36,0.45)'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
  for (let row = 0; row < 20; row++) for (let col = 0; col < 10; col++) {
    const x = col * 40 + (row % 2 ? 20 : 0) + 8, y = row * 20 + 10;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 4, y - 3, x + 8, y); ctx.quadraticCurveTo(x + 12, y + 3, x + 16, y); ctx.stroke();
  }
  // Sea serpent: three humps and a head, in ink.
  ctx.save(); ctx.translate(120, 300);
  ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.fillStyle = '#c9b98d'; ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(i * 34, 0, 15, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-18, 0); ctx.quadraticCurveTo(-30, -8, -34, -22); ctx.quadraticCurveTo(-26, -34, -14, -28); ctx.quadraticCurveTo(-10, -18, -18, -2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(-27, -27, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-34, -22); ctx.lineTo(-44, -20); ctx.stroke();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(i * 34 + k * 6, -14 + Math.abs(k) * 3); ctx.lineTo(i * 34 + k * 6, -20 + Math.abs(k) * 3); ctx.stroke(); }
  ctx.restore();
  // A tiny galleon, sails full.
  ctx.save(); ctx.translate(290, 130);
  ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.fillStyle = '#e4d8b6';
  ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(16, 0); ctx.lineTo(11, 7); ctx.lineTo(-11, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-6, -22); ctx.moveTo(6, 0); ctx.lineTo(6, -18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-6, -20); ctx.quadraticCurveTo(-16, -12, -6, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, -16); ctx.quadraticCurveTo(15, -10, 6, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

export const parchment: Skin = {
  id: 'parchment',
  name: 'Parchment Atlas',
  blurb: 'A surveyor’s map: sepia ink on foxed paper, hatched cities, dotted roads.',
  ui: {
    '--bg': '#efe5cc', '--panel': '#f8f1de', '--ink': '#3d2c1e', '--ink-soft': '#7a6650',
    '--accent': '#8c3b2a', '--accent-2': '#b08a3c', '--danger': '#9a2f1f', '--panel-border': '#5a4331',
    '--shadow': '0 4px 14px rgba(70, 50, 30, 0.22)',
  },
  board: ['#c9b48e', '#a48c62'],
  paint,
  table,
};
