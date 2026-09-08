// Score evaluators on the alternative-move benchmark: at each root, which candidate
// does the evaluator pick, and how much continuation value does that leave on the
// table versus the best labelled candidate?
//
//     regret(root) = max_a Q(a) - Q(argmax_a V(s_a))
//
// Also reports pairwise ordering accuracy on pairs whose label gap is clearly non-zero,
// and a split-half reliability check of the labels themselves.
//
//   npx tsx research/regret.ts data/bench/*.json [--weights data/research/candidate.ts] [--alpha 0.5] [--records 'data/gen1/rec-*.json']
//
// With --records the roots are replayed and every candidate re-encoded with the CURRENT
// encoder (src/server/features.ts), so a net trained on a different encoding than the
// one stored in the benchmark can still be scored.
//
// Always reports the stored hand heuristic and the stored net (as of generation), the
// 50/50 blend of those, and — with --weights — the given net alone and blended.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Net } from '../src/server/net.js';
import * as E from '../src/shared/engine.js';
import { encode } from '../src/server/features.js';
import { DECK_SALT } from '../src/shared/rng.js';
import { completeActions, rootFromRecord, type Rec } from './continue.js';
import { globSync } from 'node:fs';

function arg(name: string, def: string): string { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : def; }
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1]!.startsWith('--')));
const weightsPath = arg('weights', '');
const alpha = Number(arg('alpha', '0.5'));

interface Cand { label: string; x: number[]; hand: number; net: number; q: number; se: number; per: number[] }
interface Root { game: number; stopAt: number; players: number; tilesLeft: number; me: number; candidates: Cand[] }
const roots: Root[] = [];
for (const f of files) roots.push(...(JSON.parse(readFileSync(f, 'utf8')) as { roots: Root[] }).roots);

// Optional re-encoding of every candidate with the live encoder.
const recordsGlob = arg('records', '');
if (recordsGlob) {
  const bySeed = new Map<number, Rec>();
  for (const f of globSync(recordsGlob)) for (const r of (JSON.parse(readFileSync(f, 'utf8')) as { games: Rec[] }).games) bySeed.set(r.seed, r);
  let missing = 0;
  for (const r of roots) {
    const rec = bySeed.get(r.game);
    if (!rec) { missing++; continue; }
    const root = rootFromRecord(rec, r.stopAt, DECK_SALT);
    const acts = new Map(completeActions(root).map((a) => [a.label, a.state]));
    for (const c of r.candidates) {
      const st = acts.get(c.label);
      if (!st) { missing++; continue; }
      c.x = Array.from(encode(st, r.me, E.deriveFeatures(st)));
    }
  }
  console.error(`re-encoded with the live encoder (${missing} candidates/roots not found)`);
}

let net: Net | null = null;
let netMode: { mode?: 'value' | 'residual'; alpha?: number } = {};
if (weightsPath) {
  const m = await import(pathToFileURL(weightsPath).href) as Record<string, { sizes: number[]; w: number[][]; b: number[][]; mode?: 'value' | 'residual'; alpha?: number }>;
  const w = m.WEIGHTS_CANDIDATE ?? m.WEIGHTS ?? m.WEIGHTS_REFERENCE;
  if (!w) throw new Error('no weights export found');
  net = Net.fromJSON(w); netMode = { mode: w.mode, alpha: w.alpha };
}

type Scorer = (c: Cand) => number;
const scorers: Record<string, Scorer> = {
  'hand': (c) => c.hand,
  'net@gen': (c) => c.net,
  'blend@gen': (c) => 0.5 * c.hand + 0.5 * c.net,
  'random': () => Math.random(),
};
if (net) {
  const n = net;
  if (netMode.mode === 'residual') {
    const a = netMode.alpha ?? 1;
    scorers[`residual:file(alpha=${a})`] = (c) => c.hand + a * n.predict(c.x) * 40;
    scorers['residual:file(alpha=0.5)'] = (c) => c.hand + 0.5 * n.predict(c.x) * 40;
  } else {
    scorers['net:file'] = (c) => n.predict(c.x) * 40;
    scorers[`blend:file(a=${alpha})`] = (c) => (1 - alpha) * c.hand + alpha * n.predict(c.x) * 40;
  }
}

// Label reliability: mean |Q_A - Q_B| between the two halves of each candidate's futures,
// relative to the spread of Q across candidates at the same root.
let relNum = 0, relDen = 0, relN = 0;
for (const r of roots) {
  const qs = r.candidates.map((c) => c.q);
  const spread = Math.max(...qs) - Math.min(...qs);
  for (const c of r.candidates) {
    const h = Math.floor(c.per.length / 2);
    if (h < 2) continue;
    const a = c.per.slice(0, h).reduce((s, v) => s + v, 0) / h, b = c.per.slice(h, 2 * h).reduce((s, v) => s + v, 0) / h;
    relNum += Math.abs(a - b); relDen += spread; relN++;
  }
}
console.log(`${roots.length} roots, ${roots.reduce((s, r) => s + r.candidates.length, 0)} candidates; label half-split disagreement ${(relNum / relN).toFixed(2)} pts vs root spread ${(relDen / relN).toFixed(2)} pts`);

const byPhase = (r: Root) => (r.tilesLeft > 48 ? 'early' : r.tilesLeft > 24 ? 'mid' : 'late');
console.log('evaluator            mean regret  median  >1pt&2SE   pairwise acc   early    mid    late');
for (const [name, score] of Object.entries(scorers)) {
  const regrets: number[] = [];
  let big = 0, pairsOk = 0, pairs = 0;
  const phase: Record<string, number[]> = { early: [], mid: [], late: [] };
  for (const r of roots) {
    const vals = r.candidates.map(score);
    let pick = 0; for (let i = 1; i < vals.length; i++) if (vals[i]! > vals[pick]!) pick = i;
    let best = 0; for (let i = 1; i < r.candidates.length; i++) if (r.candidates[i]!.q > r.candidates[best]!.q) best = i;
    const reg = r.candidates[best]!.q - r.candidates[pick]!.q;
    regrets.push(reg); phase[byPhase(r)]!.push(reg);
    const seBest = r.candidates[best]!.se, sePick = r.candidates[pick]!.se;
    if (reg > 1 && reg > 2 * Math.sqrt(seBest * seBest + sePick * sePick)) big++;
    for (let i = 0; i < r.candidates.length; i++) for (let j = i + 1; j < r.candidates.length; j++) {
      const a = r.candidates[i]!, b = r.candidates[j]!;
      const gap = a.q - b.q;
      if (Math.abs(gap) < 2 * Math.sqrt(a.se * a.se + b.se * b.se) || Math.abs(gap) < 0.5) continue; // label can't tell them apart
      pairs++;
      if (Math.sign(vals[i]! - vals[j]!) === Math.sign(gap)) pairsOk++;
    }
  }
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const sorted = [...regrets].sort((a, b) => a - b);
  console.log(`${name.padEnd(20)} ${mean(regrets).toFixed(3).padStart(10)}  ${sorted[Math.floor(sorted.length / 2)]!.toFixed(2).padStart(6)}  ${String(big).padStart(5)}/${roots.length}   ${(100 * pairsOk / Math.max(1, pairs)).toFixed(1).padStart(6)}% (${pairs})  ${mean(phase.early!).toFixed(2).padStart(5)}  ${mean(phase.mid!).toFixed(2).padStart(5)}  ${mean(phase.late!).toFixed(2).padStart(5)}`);
}
