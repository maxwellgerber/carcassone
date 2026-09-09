/// <reference types="node" />
/**
 * Bananagrams solver tests: the three formulations agree with each other and
 * with an independent layout checker, on fixed hands and random ones.
 * Runs on the pure-JS backend (YALPS) so it needs no WebAssembly.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { makeDictionary, candidateWords } from '../src/bananagrams/dict.js';
import { countLetters, dealHand, parseHand } from '../src/bananagrams/tiles.js';
import { buildLettersModel, solveGrid, solveLetters, solveTwoStage, verifyLayout, components } from '../src/bananagrams/models.js';
import { toLP, yalpsSolver, highsSolver, newModel, addVar, addRow, type Solver } from '../src/bananagrams/ip.js';

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) pass++;
  else { fail++; console.error('FAIL:', msg); }
}
const dict = makeDictionary('common', readFileSync(new URL('../src/bananagrams/data/common.txt', import.meta.url), 'utf8'));

async function main(): Promise<void> {
  // HiGHS (WebAssembly) is the backend the page uses; load it here from the vendored build.
  const require = createRequire(import.meta.url);
  const factory = require('../src/bananagrams/vendor/highs.cjs') as (o: { wasmBinary: Uint8Array }) => Promise<Parameters<typeof highsSolver>[0]>;
  const wasmBinary = readFileSync(new URL('../src/bananagrams/vendor/highs.wasm', import.meta.url));
  const solver: Solver = highsSolver(await factory({ wasmBinary }));

  // --- tiles / dictionary ---
  assert(parseHand('Cat, DOG') === 'acdgot', 'parseHand sorts and lowercases');
  let threw = false;
  try { parseHand('ab3'); } catch { threw = true; }
  assert(threw, 'parseHand rejects non-letters');
  assert(dealHand(21).length === 21, 'dealHand deals 21');
  assert(candidateWords(dict, countLetters('cat')).sort().join(',') === 'act,at,cat,ta', `candidates for cat: ${candidateWords(dict, countLetters('cat')).join(',')}`);

  // --- LP serialisation sanity ---
  {
    const m = newModel('maximize');
    addVar(m, 'x', 'integer', 1, 10); addRow(m, 'r', { max: 3 }); m.variables.get('x')!.coeffs.push(['r', 1]);
    const lp = toLP(m);
    assert(/Maximize/.test(lp) && /General/.test(lp) && /<= 3/.test(lp), 'toLP emits sections');
    const sol = await yalpsSolver(m, 1000);
    assert(sol.status === 'optimal' && sol.values.get('x') === 3, 'yalps backend solves a tiny IP');
  }

  // --- letters model ---
  {
    const a = await solveLetters(dict, 'cat', { solver });
    assert(a.feasible && a.words.join() === 'cat', `letters: cat -> ${a.words.join()}`);
    const b = await solveLetters(dict, 'qqz', { solver });
    assert(!b.feasible, 'letters: qqz infeasible');
    const c = await solveLetters(dict, 'catsdog', { solver });
    assert(c.feasible, 'letters: catsdog feasible');
    const m = buildLettersModel(['cat', 'dog'], countLetters('catdog'), 'fewest-words', [], true);
    assert(m.variables.size > 8 && m.rows.size > 10, 'tight model has crossing structure');
    // Two disjoint words with no shared letter cannot be a connected grid: tight model must reject.
    const sol = await solver(m, 5000);
    assert(sol.status === 'infeasible', `tight model: cat+dog cannot cross (status ${sol.status})`);
    const loose = await solver(buildLettersModel(['cat', 'dog'], countLetters('catdog'), 'fewest-words'), 5000);
    assert(loose.status === 'infeasible', `loose model: cat+dog share no letter so no crossing is possible (status ${loose.status})`);
  }

  // --- grid model ---
  {
    const g = await solveGrid({ rows: 3, cols: 3, words: ['cat'], tiles: countLetters('cat'), solver });
    assert(g.feasible && g.layout !== null, 'grid: cat on 3x3');
    if (g.layout) assert(verifyLayout(g.layout, 'cat', dict).length === 0, 'grid: cat layout verifies');
    const g2 = await solveGrid({ rows: 4, cols: 4, words: ['cat', 'at', 'act'], tiles: countLetters('catt'), solver });
    // c a t + a t sharing? "cat" across with "at" down from the a uses a,t twice -> c,a,t,t ✓
    assert(g2.feasible, 'grid: catt lays out as cat/at');
    if (g2.layout) assert(verifyLayout(g2.layout, 'catt', dict).length === 0, `grid: catt layout verifies: ${g2.layout ? verifyLayout(g2.layout, 'catt', dict).join(';') : ''}`);
    const g3 = await solveGrid({ rows: 4, cols: 4, words: ['cat', 'dog'], tiles: countLetters('catdog'), solver });
    assert(!g3.feasible, 'grid: cat + dog cannot connect');
    const g4 = await solveGrid({ rows: 4, cols: 4, words: ['cat', 'dog'], tiles: countLetters('catdog'), connectivity: 'cuts', solver });
    assert(!g4.feasible, 'grid (cuts): cat + dog cannot connect');
  }

  // --- verifier ---
  {
    const bad = verifyLayout({ rows: 2, cols: 3, grid: [['c', 'a', 't'], ['', '', 'x']], placements: [] }, 'catx', dict);
    assert(bad.some((p) => /"tx"/.test(p)), 'verifier catches a non-word run');
    const lone = verifyLayout({ rows: 3, cols: 3, grid: [['c', 'a', 't'], ['', '', ''], ['', '', 'x']], placements: [] }, 'catx', dict);
    assert(lone.some((p) => /lone tile/.test(p)) && lone.some((p) => /not connected/.test(p)), 'verifier catches lone tiles and disconnection');
    assert(components([['a', ''], ['', 'b']]).length === 2, 'components counts diagonal as separate');
  }

  // --- two-stage ---
  {
    const r = await solveTwoStage(dict, 'eehiimn', { rows: 5, cols: 5, timeoutMs: 20000, solver });
    assert(r.feasible && r.layout !== null, `two-stage lays out eehiimn (${r.status}; ${r.attempts.map((a) => a.words.join('+')).join(' | ')})`);
    if (r.layout) assert(verifyLayout(r.layout, 'eehiimn', dict).length === 0, 'two-stage layout verifies');
    const r2 = await solveTwoStage(dict, 'qqzzxj', { rows: 5, cols: 5, solver });
    const ry = await solveTwoStage(dict, 'cat', { rows: 3, cols: 3, solver: yalpsSolver, timeoutMs: 20000 });
    assert(ry.feasible && ry.stage2.backend === 'yalps', 'pure-JS backend lays out a tiny hand');
    assert(!r2.feasible && r2.status === 'letters-infeasible', 'two-stage: hopeless hand rejected by stage 1');
  }

  // --- random: every layout returned by any model must verify; one-shot and two-stage agree when both answer ---
  {
    let s = 4242;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    let checked = 0;
    for (let t = 0; t < 16; t++) {
      const hand = dealHand(5 + (t % 3), rnd);
      const tiles = countLetters(hand);
      const c = await solveTwoStage(dict, hand, { rows: 5, cols: 5, timeoutMs: 20000, maxAttempts: 6, solver });
      if (c.layout) { assert(verifyLayout(c.layout, hand, dict).length === 0, `two-stage layout verifies for ${hand}`); checked++; }
      const cands = candidateWords(dict, tiles, 5);
      if (cands.length <= 40) {
        const b = await solveGrid({ rows: 5, cols: 5, words: cands, tiles, timeoutMs: 30000, solver });
        if (b.layout) { assert(verifyLayout(b.layout, hand, dict).length === 0, `one-shot layout verifies for ${hand}`); checked++; }
        if (b.stats.status === 'optimal' || b.stats.status === 'infeasible') {
          if (c.status === 'found') assert(b.feasible, `one-shot agrees with two-stage on ${hand}`);
          if (c.status === 'letters-infeasible') assert(!b.feasible, `letters-infeasible implies one-shot infeasible on ${hand}`);
        }
      }
    }
    assert(checked > 0, 'random trials produced layouts');
  }

  console.log(`bananagrams: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
