// Regenerates the STRUCTURAL geometry for each canonical tile type as a base SVG,
// using the exact same edge/rotation math as the shipped engine
// (src/shared/tiles.ts). Re-run this whenever tiles.ts's tile set changes (e.g. a
// future expansion) to get fresh skeletons to hand an artist — city/road/border
// shapes carry data-structural="true" and must keep their exact `d` attribute so
// every tile's edges still connect regardless of who decorates it; everything
// else is free-form. See docs/tile-geometry-contract.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { TILE_TYPES } from '../src/shared/tiles.js';

const SIZE = 200;
const OUT_DIR = new URL('../scratch-art/base/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

type Pt = [number, number];
const s = (v: number) => +(v * SIZE).toFixed(2);

function petalPoints(side: number): Pt[] {
  const margin = 0.16, depth = 0.46;
  const byN: Pt[] = [[margin, 0], [1 - margin, 0], [1 - margin - 0.1, depth], [margin + 0.1, depth]];
  if (side === 0) return byN;
  if (side === 2) return byN.map(([x, y]) => [1 - x, 1 - y]);
  if (side === 1) return byN.map(([x, y]) => [1 - y, x]);
  return byN.map(([x, y]) => [y, 1 - x]);
}
function pathFromPoints(pts: Pt[]): string {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${s(x)},${s(y)}`).join(' ') + ' Z';
}
const MID: Record<number, Pt> = { 0: [0.5, 0], 1: [1, 0.5], 2: [0.5, 1], 3: [0, 0.5] };
const CORNER: Record<string, Pt> = { NE: [1, 0], SE: [1, 1], SW: [0, 1], NW: [0, 0] };
function cornerBetween(a: number, b: number): Pt {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (lo === 0 && hi === 3) return CORNER.NW!;
  const map: Record<string, keyof typeof CORNER> = { '0,1': 'NE', '1,2': 'SE', '2,3': 'SW' };
  return CORNER[map[`${lo},${hi}`]!]!;
}
const OPPOSITE = [2, 3, 0, 1];

function roadPathD(sideA: number, sideB: number): string {
  const isOpposite = OPPOSITE[sideA] === sideB;
  const [p0x, p0y] = MID[sideA]!;
  const [p1x, p1y] = MID[sideB]!;
  if (isOpposite) return `M${s(p0x)},${s(p0y)} L${s(p1x)},${s(p1y)}`;
  const [cx, cy] = cornerBetween(sideA, sideB);
  return `M${s(p0x)},${s(p0y)} Q${s(cx)},${s(cy)} ${s(p1x)},${s(p1y)}`;
}
function roadStubD(side: number): string {
  const [px, py] = MID[side]!;
  return `M${s(px)},${s(py)} L${s(0.5)},${s(0.5)}`;
}

function buildSvg(key: string): string {
  const t = TILE_TYPES[key]!;
  const parts: string[] = [];
  parts.push(`<rect data-structural="true" data-role="field-base" x="0" y="0" width="${SIZE}" height="${SIZE}" fill="#7FA08F" />`);

  // Roads (under cities)
  t.roadGroups.forEach((grp, gi) => {
    const d = grp.length === 2 ? roadPathD(grp[0]!, grp[1]!) : roadStubD(grp[0]!);
    parts.push(`<path data-structural="true" data-role="road" data-group="${gi}" d="${d}" fill="none" stroke="#B7A98C" stroke-width="${s(0.2)}" stroke-linecap="butt" />`);
  });
  if (t.roadGroups.length >= 3) {
    parts.push(`<circle data-structural="true" data-role="junction-hub" cx="${s(0.5)}" cy="${s(0.5)}" r="${s(0.11)}" fill="#B7A98C" />`);
  }

  if (t.monastery) {
    parts.push(`<rect data-structural="true" data-role="monastery-footprint" x="${s(0.35)}" y="${s(0.4)}" width="${s(0.3)}" height="${s(0.22)}" fill="#D8CDB4" />`);
  }

  // Cities
  t.cityGroups.forEach((grp, gi) => {
    const connected = grp.length > 1;
    const petals = grp.map((side) => pathFromPoints(petalPoints(side))).join(' ');
    parts.push(`<path data-structural="true" data-role="city" data-group="${gi}" data-connected="${connected}" d="${petals}" fill="#3E6F63" />`);
    if (connected) {
      parts.push(`<circle data-structural="true" data-role="city-hub" data-group="${gi}" cx="${s(0.5)}" cy="${s(0.5)}" r="${s(0.30)}" fill="#3E6F63" />`);
    }
  });
  if (t.shield) {
    const at: Pt = t.cityGroups.some((g) => g.length > 1) ? [0.5, 0.5] : (() => {
      const g0 = t.cityGroups[0]!;
      const pts = petalPoints(g0[0]!);
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      return [cx, cy] as Pt;
    })();
    parts.push(`<circle data-structural="true" data-role="shield-anchor" cx="${s(at[0])}" cy="${s(at[1])}" r="${s(0.02)}" fill="none" />`);
  }

  parts.push(`<rect data-structural="true" data-role="tile-border" x="0.5" y="0.5" width="${SIZE - 1}" height="${SIZE - 1}" fill="none" stroke="#1F2E2B" stroke-width="1.5" />`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">\n  ${parts.join('\n  ')}\n</svg>\n`;
}

for (const key of Object.keys(TILE_TYPES)) {
  writeFileSync(new URL(`${key}.svg`, OUT_DIR), buildSvg(key));
}
console.log(`Generated ${Object.keys(TILE_TYPES).length} base SVGs into scratch-art/base/`);
