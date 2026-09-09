/**
 * Three ways to answer "can I dump my hand?" in Bananagrams with integer programming.
 *
 *  A. Letters only — choose words whose letters add up to the tiles (plus crossings).
 *     Tiny model, fast, but only a necessary condition: it never places anything.
 *  B. One-shot grid — choose word placements on an R×C grid directly. Complete and
 *     correct, but the model grows with (words × cells × 2) columns.
 *  C. Two-stage — solve A, then try to lay out exactly those words with a small grid
 *     model; if that fails, forbid that word set in A and repeat.
 */
import { type IPModel, type IPSolution, type Solver, addRow as ipRow, addVar, coef, newModel, yalpsSolver } from './ip.js';
import { type Dictionary, candidateWords } from './dict.js';
import { type Counts, countLetters, totalOf } from './tiles.js';
export type { Solver } from './ip.js';

export interface Stats {
  /** Columns in the model (decision variables). */
  variables: number;
  /** Rows in the model (constraints). */
  constraints: number;
  /** Wall-clock milliseconds spent inside the solver. */
  solveMs: number;
  /** Solver calls made. */
  solves: number;
  status: IPSolution['status'] | 'exhausted';
  backend: IPSolution['backend'] | null;
}

export interface Placement {
  word: string;
  r: number;
  c: number;
  dir: 'across' | 'down';
}

export interface Layout {
  rows: number;
  cols: number;
  /** grid[r][c] is a letter or '' for empty. */
  grid: string[][];
  placements: Placement[];
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// --- Model A: letters only -------------------------------------------------------------

export interface LettersResult {
  feasible: boolean;
  /** Chosen words (each at most once). */
  words: string[];
  /** Crossings assumed per letter. */
  crossings: Map<string, number>;
  stats: Stats;
  /** A readable description of the model, for the page. */
  model: LettersModelInfo;
}

export interface LettersModelInfo {
  candidates: string[];
  letters: string[];
  tiles: Counts;
}

export type LettersObjective = 'fewest-words' | 'most-words';

/**
 * Build the letter-count model.
 *   x_w ∈ {0,1}   use word w
 *   o_ℓ ∈ ℤ≥0    crossings on letter ℓ (a tile shared by an across and a down word)
 *   for each letter ℓ:  Σ_w count_ℓ(w)·x_w − o_ℓ = tiles_ℓ      (words spell the tiles, sharing crossings)
 *   Σ_ℓ o_ℓ ≥ Σ_w x_w − 1                                         (k connected words need ≥ k−1 crossings)
 *   plus "no-good" rows forbidding word sets already shown unlayable.
 */
export function buildLettersModel(candidates: readonly string[], tiles: Counts, objective: LettersObjective, forbidden: readonly (readonly string[])[] = [], tight = false): IPModel {
  const m = newModel(objective === 'fewest-words' ? 'minimize' : 'maximize');
  const letters = [...tiles.keys()];
  for (const ch of letters) ipRow(m, `L:${ch}`, { equal: tiles.get(ch)! });
  ipRow(m, 'tree', { max: 1 }); // Σx − Σo ≤ 1
  candidates.forEach((w, i) => {
    const v = addVar(m, `w${i}`, 'binary', 1);
    v.coeffs.push(['tree', 1]);
    for (const [ch, n] of countLetters(w)) v.coeffs.push([`L:${ch}`, n]);
  });
  for (const ch of letters) {
    const v = addVar(m, `o${ch}`, 'integer', 0, tiles.get(ch)!); // a letter cannot cross more times than there are tiles of it
    v.coeffs.push([`L:${ch}`, -1], ['tree', -1]);
  }
  if (tight) {
    // Which word crosses on which letter. c_{w,ℓ} = crossings word w takes on letter ℓ.
    //   Σ_w c_{w,ℓ} = 2·o_ℓ            every crossing on ℓ belongs to two words
    //   c_{w,ℓ} ≤ count_ℓ(w)·x_w       only on letters the word has, only if chosen
    //   Σ_ℓ c_{w,ℓ} ≥ x_w − single     a chosen word crosses at least once, unless it is the only word
    //   Σ_w x_w ≤ 1 + N·(1 − single)
    const single = addVar(m, 'single', 'binary');
    ipRow(m, 'single', { max: 1 }); // Σx − N(1−single) ≤ 1  ⇔  Σx + N·single ≤ 1 + N
    single.coeffs.push(['single', candidates.length]);
    for (const ch of letters) {
      ipRow(m, `pair:${ch}`, { equal: 0 }); // Σ_w c_{w,ℓ} − 2 o_ℓ = 0
      coef(m, `o${ch}`, `pair:${ch}`, -2);
    }
    candidates.forEach((w, i) => {
      coef(m, `w${i}`, 'single', 1);
      ipRow(m, `cross:${i}`, { max: 0 }); // x_w − single − Σ_ℓ c ≤ 0
      coef(m, `w${i}`, `cross:${i}`, 1);
      single.coeffs.push([`cross:${i}`, -1]);
      for (const [ch, n] of countLetters(w)) {
        const c = addVar(m, `c${i}_${ch}`, 'integer', 0, n);
        c.coeffs.push([`pair:${ch}`, 1], [`cross:${i}`, -1], [`cap:${i}:${ch}`, 1]);
        ipRow(m, `cap:${i}:${ch}`, { max: 0 }); // c − n·x ≤ 0
        coef(m, `w${i}`, `cap:${i}:${ch}`, -n);
      }
    });
  }
  m.rows.set('single', { max: 1 + candidates.length });
  forbidden.forEach((set, k) => {
    ipRow(m, `ng${k}`, { max: set.length - 1 });
    for (const w of set) {
      const i = candidates.indexOf(w);
      if (i >= 0) coef(m, `w${i}`, `ng${k}`, 1);
    }
  });
  return m;
}

export interface LettersOptions {
  objective?: LettersObjective;
  forbidden?: readonly (readonly string[])[];
  maxLen?: number;
  timeoutMs?: number;
  solver?: Solver;
  /** Add the per-word crossing structure (default false: it rarely prevents a failed attempt and costs solve time). */
  tight?: boolean;
}

export async function solveLetters(dict: Dictionary, hand: string, opts: LettersOptions = {}): Promise<LettersResult> {
  const tiles = countLetters(hand);
  const candidates = candidateWords(dict, tiles, opts.maxLen ?? Infinity);
  const forbidden = opts.forbidden ?? [];
  const model = buildLettersModel(candidates, tiles, opts.objective ?? 'fewest-words', forbidden, opts.tight ?? false);
  const t0 = now();
  const sol = await (opts.solver ?? yalpsSolver)(model, opts.timeoutMs ?? 20000);
  const solveMs = now() - t0;
  const words: string[] = [];
  const crossings = new Map<string, number>();
  const feasible = sol.status === 'optimal' || (sol.status === 'timedout' && sol.values.size > 0);
  if (feasible) {
    for (const [name, v] of sol.values) {
      if (v < 0.5) continue;
      if (name.startsWith('w')) words.push(candidates[Number(name.slice(1))]!);
      else if (name.startsWith('o')) crossings.set(name.slice(1), Math.round(v));
    }
  }
  return {
    feasible,
    words,
    crossings,
    stats: { variables: model.variables.size, constraints: model.rows.size, solveMs, solves: 1, status: sol.status, backend: sol.backend },
    model: { candidates, letters: [...tiles.keys()], tiles },
  };
}

// --- Grid model (used by B and by stage 2 of C) ------------------------------------------------

export interface GridOptions {
  rows: number;
  cols: number;
  /** Words allowed on the grid. */
  words: readonly string[];
  /** Tiles that must all be placed. */
  tiles: Counts;
  /** When set, each word in `words` must be placed exactly this many times (stage 2). Otherwise any subset. */
  exactCounts?: Map<string, number>;
  /** How to enforce that the grid is one connected piece: an exact single-commodity
   *  flow (default) or lazy cuts added after each disconnected solution. */
  connectivity?: 'flow' | 'cuts';
  /** Maximum connectivity-cut rounds (cuts mode). */
  maxRounds?: number;
  /** Solver timeout per round, ms. */
  timeoutMs?: number;
  /** Return the model dimensions without solving (for size estimates). */
  dryRun?: boolean;
  solver?: Solver;
}

export interface GridResult {
  feasible: boolean;
  layout: Layout | null;
  stats: Stats;
  /** Connectivity cuts added, one entry per round: the size of the stranded component. */
  cuts: number[];
  /** Model shape, for the explainer. */
  shape: GridShape;
}

export interface GridShape {
  placements: number;
  cellLetterVars: number;
  rows: { name: string; count: number }[];
}

export interface PlacementVar extends Placement {
  name: string;
  cells: { q: number; ch: string }[];
}

/**
 * Build and solve the placement model.
 *   x_p ∈ {0,1}      word placement p = (word, row, col, direction)
 *   y_{q,ℓ} ∈ {0,1}  cell q holds letter ℓ
 *   Σ_ℓ y_{q,ℓ} ≤ 1                                   a cell holds one letter
 *   Σ_{across p covering q with ℓ} x_p ≤ y_{q,ℓ}      placements agree with the cell's letter
 *   Σ_{down p covering q with ℓ} x_p ≤ y_{q,ℓ}
 *   Σ_{across p ∋ q} x_p ≤ 1,  Σ_{down p ∋ q} x_p ≤ 1  no two words in the same direction share a cell
 *   Σ_ℓ y_{q,ℓ} ≤ Σ_{p ∋ q} x_p                        every tile belongs to a word
 *   Σ_q y_{q,ℓ} = tiles_ℓ                              every tile is used exactly once
 *   z_q + z_q' − Σ_{across p ⊇ {q,q'}} x_p ≤ 1         adjacent tiles lie in one word (both directions)
 *   Σ_c z_{0,c} ≥ 1,  Σ_r z_{r,0} ≥ 1                  pin the grid to the top-left corner
 *   connectivity, as a flow:  one root cell r_q (Σ r_q = 1, r_q ≤ z_q) pushes T−1 units
 *     of flow out along grid edges; every other occupied cell absorbs exactly one unit;
 *     flow may only enter occupied cells (f_{q→q'} ≤ (T−1)·z_{q'}). A cell the flow cannot
 *     reach cannot absorb its unit, so every tile must be connected to the root.
 * where z_q = Σ_ℓ y_{q,ℓ} and T is the number of tiles.
 */
export interface GridModel {
  m: IPModel;
  placements: PlacementVar[];
  shape: GridShape;
  /** Helpers for the connectivity-cut loop. */
  letters: string[];
  total: number;
  y: (i: number, ch: string) => string;
  addRow: (name: string, bound: { equal?: number; max?: number; min?: number }, kind: string) => void;
}

/** Build the placement model without solving it. */
export function buildGridModel(opts: GridOptions): GridModel {
  const { rows, cols, tiles } = opts;
  const letters = [...tiles.keys()];
  const total = totalOf(tiles);
  const q = (r: number, c: number) => r * cols + c;
  const cells = rows * cols;

  // Placements
  const placements: PlacementVar[] = [];
  for (const word of opts.words) {
    const L = word.length;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (c + L <= cols) placements.push({ word, r, c, dir: 'across', name: `p${placements.length}`, cells: [...word].map((ch, i) => ({ q: q(r, c + i), ch })) });
      if (r + L <= rows && L > 0) placements.push({ word, r, c, dir: 'down', name: `p${placements.length}`, cells: [...word].map((ch, i) => ({ q: q(r + i, c), ch })) });
    }
  }

  const m = newModel('minimize');
  const rowCounts: Record<string, number> = {};
  const addRow = (name: string, bound: { equal?: number; max?: number; min?: number }, kind: string) => {
    ipRow(m, name, bound);
    rowCounts[kind] = (rowCounts[kind] ?? 0) + 1;
  };
  const y = (i: number, ch: string) => `y${i}_${ch}`;

  // y variables
  for (let i = 0; i < cells; i++) {
    addRow(`one:${i}`, { max: 1 }, 'a cell holds one letter');
    addRow(`inword:${i}`, { max: 0 }, 'every tile belongs to a word');
    addRow(`across1:${i}`, { max: 1 }, 'one across word per cell');
    addRow(`down1:${i}`, { max: 1 }, 'one down word per cell');
    for (const ch of letters) {
      const v = addVar(m, y(i, ch), 'binary');
      v.coeffs.push([`one:${i}`, 1], [`inword:${i}`, 1], [`tile:${ch}`, 1]);
      addRow(`agreeA:${i}:${ch}`, { max: 0 }, 'across words agree with the cell');
      addRow(`agreeD:${i}:${ch}`, { max: 0 }, 'down words agree with the cell');
      v.coeffs.push([`agreeA:${i}:${ch}`, -1], [`agreeD:${i}:${ch}`, -1]);
    }
  }
  for (const ch of letters) addRow(`tile:${ch}`, { equal: tiles.get(ch)! }, 'every tile used exactly once');

  // adjacency rows: z_q + z_q' − Σ x ≤ 1
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (c + 1 < cols) {
      addRow(`adjA:${q(r, c)}`, { max: 1 }, 'adjacent tiles share a word');
      for (const ch of letters) { coef(m, y(q(r, c), ch), `adjA:${q(r, c)}`, 1); coef(m, y(q(r, c + 1), ch), `adjA:${q(r, c)}`, 1); }
    }
    if (r + 1 < rows) {
      addRow(`adjD:${q(r, c)}`, { max: 1 }, 'adjacent tiles share a word');
      for (const ch of letters) { coef(m, y(q(r, c), ch), `adjD:${q(r, c)}`, 1); coef(m, y(q(r + 1, c), ch), `adjD:${q(r, c)}`, 1); }
    }
  }
  // pin to the corner
  addRow('pinRow', { min: 1 }, 'pin the grid to the corner');
  addRow('pinCol', { min: 1 }, 'pin the grid to the corner');
  for (let c = 0; c < cols; c++) for (const ch of letters) coef(m, y(q(0, c), ch), 'pinRow', 1);
  for (let r = 0; r < rows; r++) for (const ch of letters) coef(m, y(q(r, 0), ch), 'pinCol', 1);

  // placement variables
  const byWord = new Map<string, string[]>();
  for (const p of placements) {
    const v = addVar(m, p.name, 'binary');
    const tag = p.dir === 'across' ? 'A' : 'D';
    p.cells.forEach(({ q: cell, ch }, i) => {
      v.coeffs.push([`agree${tag}:${cell}:${ch}`, 1], [`${p.dir}1:${cell}`, 1], [`inword:${cell}`, -1]);
      if (i + 1 < p.cells.length) v.coeffs.push([`adj${tag}:${cell}`, -1]);
    });
    const arr = byWord.get(p.word) ?? [];
    arr.push(p.name);
    byWord.set(p.word, arr);
  }
  if (opts.exactCounts) {
    for (const [w, n] of opts.exactCounts) {
      addRow(`use:${w}`, { equal: n }, 'each chosen word placed once');
      for (const name of byWord.get(w) ?? []) coef(m, name, `use:${w}`, 1);
    }
  }

  // connectivity as flow
  const connectivity = opts.connectivity ?? 'flow';
  if (connectivity === 'flow' && total > 1) {
    addRow('root', { equal: 1 }, 'exactly one root cell');
    for (let i = 0; i < cells; i++) {
      const rv = addVar(m, `root${i}`, 'binary');
      rv.coeffs.push(['root', 1], [`rootocc:${i}`, 1]);
      addRow(`rootocc:${i}`, { max: 0 }, 'the root is an occupied cell'); // root_i − z_i ≤ 0
      for (const ch of letters) coef(m, y(i, ch), `rootocc:${i}`, -1);
      addRow(`flow:${i}`, { equal: 0 }, 'flow conservation'); // in − out − z_i + T·root_i = 0
      rv.coeffs.push([`flow:${i}`, total]);
      for (const ch of letters) coef(m, y(i, ch), `flow:${i}`, -1);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const from = q(r, c), to = q(rr, cc);
        const fv = addVar(m, `f${from}_${to}`, 'continuous', 0, total - 1);
        fv.coeffs.push([`flow:${to}`, 1], [`flow:${from}`, -1], [`cap:${from}_${to}`, 1]);
        addRow(`cap:${from}_${to}`, { max: 0 }, 'flow only enters occupied cells'); // f − (T−1)·z_to ≤ 0
        for (const ch of letters) coef(m, y(to, ch), `cap:${from}_${to}`, -(total - 1));
      }
    }
  }

  const shape: GridShape = {
    placements: placements.length,
    cellLetterVars: cells * letters.length,
    rows: Object.entries(rowCounts).map(([name, count]) => ({ name, count })),
  };
  return { m, placements, shape, letters, total, y, addRow };
}

export async function solveGrid(opts: GridOptions): Promise<GridResult> {
  const { rows, cols } = opts;
  const q = (r: number, c: number) => r * cols + c;
  const connectivity = opts.connectivity ?? 'flow';
  const { m, placements, shape, letters, total, y, addRow } = buildGridModel(opts);
  const stats = (status: Stats['status'], solveMs: number, solves: number, backend: Stats['backend']): Stats => ({ variables: m.variables.size, constraints: m.rows.size, solveMs, solves, status, backend });
  if (opts.dryRun || placements.length === 0) return { feasible: false, layout: null, stats: stats('infeasible', 0, 0, null), cuts: [], shape };

  // Solve with lazy connectivity cuts.
  const solver = opts.solver ?? yalpsSolver;
  const cuts: number[] = [];
  let solveMs = 0;
  let solves = 0;
  let backend: Stats['backend'] = null;
  const maxRounds = connectivity === 'flow' ? 1 : (opts.maxRounds ?? 25);
  for (let round = 0; round < maxRounds; round++) {
    const t0 = now();
    const sol = await solver(m, opts.timeoutMs ?? 30000);
    solveMs += now() - t0;
    solves++;
    backend = sol.backend;
    if (sol.status !== 'optimal' && !(sol.status === 'timedout' && sol.values.size)) {
      return { feasible: false, layout: null, stats: stats(sol.status, solveMs, solves, backend), cuts, shape };
    }
    const chosen = new Set([...sol.values].filter(([, v]) => v > 0.5).map(([n]) => n));
    const grid: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
    for (const name of chosen) {
      if (!name.startsWith('y')) continue;
      const [idx, ch] = name.slice(1).split('_');
      const i = Number(idx);
      grid[Math.floor(i / cols)]![i % cols] = ch!;
    }
    const comps = components(grid);
    if (comps.length > 1 && connectivity === 'flow') {
      return { feasible: false, layout: null, stats: stats('error', solveMs, solves, backend), cuts, shape };
    }
    if (comps.length <= 1) {
      const layout: Layout = { rows, cols, grid, placements: placements.filter((p) => chosen.has(p.name)).map(({ word, r, c, dir }) => ({ word, r, c, dir })) };
      return { feasible: true, layout, stats: stats('optimal', solveMs, solves, backend), cuts, shape };
    }
    // Add a cut for every component but the largest: if any of its cells is occupied,
    // some cell bordering the component must be occupied too (valid for every connected
    // layout, since a connected layout of `total` > |S| tiles must leave S somewhere).
    comps.sort((a, b) => b.length - a.length);
    for (const comp of comps.slice(1)) {
      cuts.push(comp.length);
      const inComp = new Set(comp);
      const border = new Set<number>();
      for (const cell of comp) {
        const r = Math.floor(cell / cols), c = cell % cols;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          if (!inComp.has(q(rr, cc))) border.add(q(rr, cc));
        }
      }
      if (border.size === 0) continue;
      for (const cell of comp) {
        const name = `conn:${cuts.length}:${cell}`;
        addRow(name, { max: 0 }, 'connectivity cut');
        for (const ch of letters) {
          coef(m, y(cell, ch), name, 1);
          for (const b of border) coef(m, y(b, ch), name, -1);
        }
      }
    }
    if (total <= 0) break;
  }
  return { feasible: false, layout: null, stats: stats('exhausted', solveMs, solves, backend), cuts, shape };
}

/** Connected components of occupied cells (4-neighbour). */
export function components(grid: string[][]): number[][] {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const seen = new Set<number>();
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const start = r * cols + c;
    if (!grid[r]![c] || seen.has(start)) continue;
    const comp: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cell = stack.pop()!;
      comp.push(cell);
      const cr = Math.floor(cell / cols), cc = cell % cols;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const rr = cr + dr, c2 = cc + dc;
        if (rr < 0 || c2 < 0 || rr >= rows || c2 >= cols) continue;
        const n = rr * cols + c2;
        if (grid[rr]![c2] && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    out.push(comp);
  }
  return out;
}

/** Independent check of a layout against the rules: all tiles used, every run of 2+ is a word, connected. */
export function verifyLayout(layout: Layout, hand: string, dict: Dictionary): string[] {
  const problems: string[] = [];
  const used: string[] = [];
  for (const row of layout.grid) for (const ch of row) if (ch) used.push(ch);
  if (used.sort().join('') !== hand.split('').sort().join('')) problems.push(`tiles on grid (${used.join('')}) ≠ hand (${hand})`);
  const runs: string[] = [];
  for (let r = 0; r < layout.rows; r++) {
    let run = '';
    for (let c = 0; c <= layout.cols; c++) {
      const ch = c < layout.cols ? layout.grid[r]![c]! : '';
      if (ch) run += ch; else { if (run.length >= 2) runs.push(run); run = ''; }
    }
  }
  for (let c = 0; c < layout.cols; c++) {
    let run = '';
    for (let r = 0; r <= layout.rows; r++) {
      const ch = r < layout.rows ? layout.grid[r]![c]! : '';
      if (ch) run += ch; else { if (run.length >= 2) runs.push(run); run = ''; }
    }
  }
  for (const w of runs) if (!dict.has(w)) problems.push(`"${w}" is not a word`);
  // lone tiles
  for (let r = 0; r < layout.rows; r++) for (let c = 0; c < layout.cols; c++) {
    if (!layout.grid[r]![c]) continue;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) => layout.grid[r + dr!]?.[c + dc!]);
    if (!nb) problems.push(`lone tile "${layout.grid[r]![c]}" at (${r},${c})`);
  }
  if (components(layout.grid).length > 1) problems.push('grid is not connected');
  return problems;
}

// --- Model C: two-stage --------------------------------------------------------------------------

export interface TwoStageResult {
  feasible: boolean;
  layout: Layout | null;
  /** Each stage-1 word set tried, with whether it laid out. */
  attempts: { words: string[]; laidOut: boolean; stage2: Stats }[];
  stage1: Stats;
  stage2: Stats;
  status: 'found' | 'letters-infeasible' | 'gave-up';
}

export interface TwoStageOptions {
  rows: number;
  cols: number;
  objective?: LettersObjective;
  maxAttempts?: number;
  maxLen?: number;
  timeoutMs?: number;
  solver?: Solver;
  tight?: boolean;
  /** Called after each attempt, so a UI can show progress. */
  onAttempt?: (attempt: TwoStageResult['attempts'][number]) => void;
}

export async function solveTwoStage(dict: Dictionary, hand: string, opts: TwoStageOptions): Promise<TwoStageResult> {
  const tiles = countLetters(hand);
  const forbidden: string[][] = [];
  const attempts: TwoStageResult['attempts'] = [];
  const stage1: Stats = { variables: 0, constraints: 0, solveMs: 0, solves: 0, status: 'infeasible', backend: null };
  const stage2: Stats = { variables: 0, constraints: 0, solveMs: 0, solves: 0, status: 'infeasible', backend: null };
  const maxAttempts = opts.maxAttempts ?? 12;
  for (let k = 0; k < maxAttempts; k++) {
    const a = await solveLetters(dict, hand, { objective: opts.objective ?? 'fewest-words', forbidden, maxLen: opts.maxLen ?? Math.max(opts.rows, opts.cols), solver: opts.solver, timeoutMs: opts.timeoutMs, tight: opts.tight });
    stage1.variables = a.stats.variables; stage1.constraints = a.stats.constraints; stage1.solveMs += a.stats.solveMs; stage1.solves++; stage1.status = a.stats.status; stage1.backend = a.stats.backend;
    if (!a.feasible) return { feasible: false, layout: null, attempts, stage1, stage2, status: attempts.length ? 'gave-up' : 'letters-infeasible' };
    const g = await solveGrid({ rows: opts.rows, cols: opts.cols, words: a.words, tiles, exactCounts: new Map(a.words.map((w) => [w, 1])), timeoutMs: opts.timeoutMs, solver: opts.solver });
    stage2.variables = Math.max(stage2.variables, g.stats.variables); stage2.constraints = Math.max(stage2.constraints, g.stats.constraints); stage2.solveMs += g.stats.solveMs; stage2.solves += g.stats.solves; stage2.status = g.stats.status; stage2.backend = g.stats.backend;
    const attempt = { words: a.words, laidOut: g.feasible, stage2: g.stats };
    attempts.push(attempt);
    opts.onAttempt?.(attempt);
    if (g.feasible) return { feasible: true, layout: g.layout, attempts, stage1, stage2, status: 'found' };
    forbidden.push(a.words);
  }
  return { feasible: false, layout: null, attempts, stage1, stage2, status: 'gave-up' };
}
