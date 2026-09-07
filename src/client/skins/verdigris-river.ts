// The Verdigris Gearworks set is hand-drawn SVG, but the River tiles were not part
// of the original commission. This painter draws them in the same palette and
// conventions (patinated brass grass, cross-hatched teal cities, gravel roads,
// timber-framed houses) so they sit beside the SVG tiles without looking foreign.
import { SIZE, ROAD_W, JUNCTION_R, layoutFor, seeded, scatterOpen, cityInteriorSpots, cityPath, strokeRoad, strokeWalls, hasJunction, drawRiver, monasteryCenter } from './geometry.js';

const GRASS = '#93a889';
const ROAD = '#d4be8e';
const ROAD_EDGE = '#776b4e';
const CITY = '#2f6f68';
const CITY_LINE = '#214e48';
const WALL = '#b4bd94';

function tree(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#62785e'; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.ellipse(2, 5, 7, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = '#645e43'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, 9); ctx.stroke();
  ctx.fillStyle = '#6d8d6d'; ctx.strokeStyle = '#49684f'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.bezierCurveTo(-9, -4, -9, 4, -3, 5); ctx.bezierCurveTo(0, 9, 8, 4, 6, -1); ctx.bezierCurveTo(6, -5, 3, -8, 0, -9); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#bdc49c'; ctx.beginPath(); ctx.moveTo(-2, -6); ctx.quadraticCurveTo(-7, -1, -4, 2); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.stroke();
  ctx.restore();
}

function house(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rot: number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.lineJoin = 'round';
  ctx.fillStyle = '#224e48'; ctx.globalAlpha = 0.4; ctx.fillRect(-w / 2 + 2, -h / 2 + 3, w, h); ctx.globalAlpha = 1;
  ctx.fillStyle = '#af8961'; ctx.strokeStyle = '#274a43'; ctx.lineWidth = 1.1; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = '#d0ad77'; ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(0, -h / 2 + 3); ctx.lineTo(0, h / 2 - 3); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#94714f'; ctx.beginPath(); ctx.moveTo(w / 2, -h / 2); ctx.lineTo(0, -h / 2 + 3); ctx.lineTo(0, h / 2 - 3); ctx.lineTo(w / 2, h / 2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#ead3a0'; ctx.beginPath(); ctx.moveTo(0, -h / 2 + 3); ctx.lineTo(0, h / 2 - 3); ctx.stroke();
  ctx.fillStyle = '#ded4b2'; ctx.strokeStyle = '#334e45'; ctx.lineWidth = 0.6; ctx.fillRect(w / 2 - 4, -h / 2 + 3, 3, 4); ctx.strokeRect(w / 2 - 4, -h / 2 + 3, 3, 4);
  ctx.restore();
}

function cloister(ctx: CanvasRenderingContext2D): void {
  ctx.save(); ctx.lineJoin = 'round';
  ctx.fillStyle = '#d8cdb4'; ctx.strokeStyle = '#4b5947'; ctx.lineWidth = 1.5; ctx.fillRect(70, 80, 60, 44); ctx.strokeRect(70, 80, 60, 44);
  ctx.fillStyle = '#acb894'; ctx.strokeStyle = '#8d967a'; ctx.lineWidth = 1; ctx.fillRect(74, 84, 52, 36); ctx.strokeRect(74, 84, 52, 36);
  ctx.fillStyle = '#6f916c'; ctx.fillRect(83, 88, 34, 25);
  ctx.fillStyle = '#a0b88c'; ctx.fillRect(86, 91, 28, 19);
  ctx.strokeStyle = '#d8cba4'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(100, 91); ctx.lineTo(100, 110); ctx.moveTo(86, 101); ctx.lineTo(114, 101); ctx.stroke();
  ctx.fillStyle = '#508278'; ctx.strokeStyle = '#d4c59c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(100, 101, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#547d70'; ctx.strokeStyle = '#304e43'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(68, 78); ctx.lineTo(132, 78); ctx.lineTo(125, 87); ctx.lineTo(75, 87); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e0d1aa'; ctx.strokeStyle = '#4b5947'; ctx.fillRect(91, 96, 18, 28); ctx.strokeRect(91, 96, 18, 28);
  ctx.fillStyle = '#517e70'; ctx.strokeStyle = '#304e43'; ctx.beginPath(); ctx.moveTo(89, 96); ctx.lineTo(100, 82); ctx.lineTo(111, 96); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#8b744c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(100, 82); ctx.lineTo(100, 75); ctx.moveTo(97, 78); ctx.lineTo(103, 78); ctx.stroke();
  ctx.fillStyle = '#3c5242'; ctx.beginPath(); ctx.moveTo(97, 123); ctx.lineTo(97, 114); ctx.arc(100, 114, 3, Math.PI, 0); ctx.lineTo(103, 123); ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function paintVerdigris(ctx: CanvasRenderingContext2D, key: string): void {
  const L = layoutFor(key);
  const { t } = L;
  const rng = seeded('verdigris:' + key);
  ctx.fillStyle = GRASS; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = 'rgba(79,113,93,0.5)'; ctx.lineWidth = 0.55;
  for (let y = 0; y < SIZE; y += 24) for (let x = 0; x < SIZE; x += 24) {
    ctx.beginPath(); ctx.moveTo(x + 3, y + 18); ctx.lineTo(x + 6, y + 15); ctx.moveTo(x + 5, y + 19); ctx.lineTo(x + 8, y + 16); ctx.moveTo(x + 17, y + 6); ctx.lineTo(x + 19, y + 4); ctx.stroke();
    ctx.fillStyle = 'rgba(223,218,181,0.65)'; ctx.beginPath(); ctx.arc(x + 16, y + 19, 0.6, 0, Math.PI * 2); ctx.fill();
  }
  for (const [x, y] of scatterOpen(ctx, L, rng, 9, 8)) tree(ctx, x, y);

  if (t.roadGroups.length) {
    strokeRoad(ctx, L.roads, ROAD_W, ROAD);
    strokeRoad(ctx, L.roads, ROAD_W + 3, ROAD_EDGE);
    strokeRoad(ctx, L.roads, ROAD_W - 3, ROAD);
    strokeRoad(ctx, L.roads, ROAD_W - 6, 'rgba(242,220,168,0.9)', [1, 1000]);
    ctx.save(); ctx.lineWidth = ROAD_W - 8; ctx.strokeStyle = 'rgba(135,116,85,0.5)'; ctx.setLineDash([1.2, 15]); ctx.stroke(L.roads); ctx.restore();
    if (hasJunction(t)) { ctx.fillStyle = ROAD; ctx.strokeStyle = ROAD_EDGE; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(100, 100, JUNCTION_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }

  drawRiver(ctx, t, { water: '#5f8f97', deep: '#4c7c86', bank: '#7f7a5a', foam: 'rgba(214,231,226,0.7)', bridgeDeck: ROAD, bridgeRail: ROAD_EDGE }, rng);

  t.cityGroups.forEach((_, gi) => {
    const city = cityPath(t, gi);
    ctx.fillStyle = CITY; ctx.fill(city);
    ctx.save(); ctx.clip(city);
    ctx.strokeStyle = CITY_LINE; ctx.lineWidth = 0.55; ctx.globalAlpha = 0.5;
    for (let y = 0; y < SIZE; y += 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(SIZE, y); ctx.stroke(); }
    for (let y = 0; y < SIZE; y += 16) for (let x = (y / 16) % 2 ? 0 : 12; x < SIZE; x += 24) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 8); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.restore();
    for (const [x, y] of cityInteriorSpots(ctx, city, rng, 6, 11)) house(ctx, x, y, 17 + rng() * 4, 22 + rng() * 5, (rng() - 0.5) * 0.15);
  });
  strokeWalls(ctx, t, 2.2, WALL, [5, 3]);
  strokeWalls(ctx, t, 1, CITY_LINE);

  if (t.monastery) { const [mx, my] = monasteryCenter(t); ctx.save(); ctx.translate(mx - 100, my - 100); cloister(ctx); ctx.restore(); }
}
