/**
 * Bananagrams "can I dump my hand?" page. Three integer-programming formulations
 * side by side, solved in the browser (HiGHS via WebAssembly, or YALPS in pure JS),
 * with an explainer written from the live hand.
 *
 * The same bundle runs in a Web Worker: when loaded without a `document` it
 * becomes the worker, so long solves never freeze the page.
 */
import commonText from './data/common.txt';
import largeText from './data/large.txt';
import highsFactory from './vendor/highs.cjs';
import highsWasm from './vendor/highs.wasm';
import { type Dictionary, candidateWords, makeDictionary } from './dict.js';
import { type Solver, highsSolver, toLP, yalpsSolver } from './ip.js';
import {
  type GridResult,
  type GridShape,
  type Layout,
  type LettersResult,
  type TwoStageResult,
  buildGridModel,
  buildLettersModel,
  solveGrid,
  solveLetters,
  solveTwoStage,
  verifyLayout,
} from './models.js';
import { DISTRIBUTION, countLetters, dealHand, parseHand } from './tiles.js';

// --- Shared: dictionaries and solver backends ------------------------------------------------

const dicts: Record<string, Dictionary> = {
  common: makeDictionary('common', commonText),
  large: makeDictionary('large', largeText),
};
type Backend = 'highs' | 'yalps';
let highsPromise: Promise<Solver> | null = null;
function solverFor(backend: Backend): Promise<Solver> {
  if (backend === 'yalps') return Promise.resolve(yalpsSolver);
  if (!highsPromise) {
    highsPromise = (async () => {
      const bin = Uint8Array.from(atob(highsWasm), (c) => c.charCodeAt(0));
      return highsSolver(await highsFactory({ wasmBinary: bin }));
    })();
  }
  return highsPromise;
}

// --- Job protocol (page <-> worker, or in-process) -------------------------------------------------

interface JobBase { id: number; backend: Backend; dict: string; hand: string; rows: number; cols: number; timeoutMs: number }
type Job =
  | (JobBase & { kind: 'letters'; tight: boolean })
  | (JobBase & { kind: 'grid' })
  | (JobBase & { kind: 'twostage'; tight: boolean; maxAttempts: number });
type JobResult =
  | { kind: 'letters'; result: LettersResult }
  | { kind: 'grid'; result: GridResult }
  | { kind: 'twostage'; result: TwoStageResult };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
interface Progress { id: number; attempt: TwoStageResult['attempts'][number] }
interface Done { id: number; result: JobResult; elapsedMs: number }

async function runJob(job: Job, onProgress: (p: Progress) => void): Promise<Done> {
  const dict = dicts[job.dict]!;
  const solver = await solverFor(job.backend);
  const t0 = performance.now();
  let result: JobResult;
  if (job.kind === 'letters') {
    result = { kind: 'letters', result: await solveLetters(dict, job.hand, { solver, maxLen: Math.max(job.rows, job.cols), tight: job.tight, timeoutMs: job.timeoutMs }) };
  } else if (job.kind === 'grid') {
    const tiles = countLetters(job.hand);
    const words = candidateWords(dict, tiles, Math.max(job.rows, job.cols));
    result = { kind: 'grid', result: await solveGrid({ rows: job.rows, cols: job.cols, words, tiles, solver, timeoutMs: job.timeoutMs }) };
  } else {
    result = { kind: 'twostage', result: await solveTwoStage(dict, job.hand, { rows: job.rows, cols: job.cols, solver, tight: job.tight, maxAttempts: job.maxAttempts, timeoutMs: job.timeoutMs, onAttempt: (attempt) => onProgress({ id: job.id, attempt }) }) };
  }
  return { id: job.id, result, elapsedMs: performance.now() - t0 };
}

// Worker entry: no document means we were loaded as a worker.
if (typeof document === 'undefined') {
  const ctx = self as unknown as { onmessage: ((e: MessageEvent<Job>) => void) | null; postMessage: (m: unknown) => void };
  ctx.onmessage = (e) => {
    runJob(e.data, (p) => ctx.postMessage({ type: 'progress', ...p })).then(
      (done) => ctx.postMessage({ type: 'done', ...done }),
      (err) => ctx.postMessage({ type: 'error', id: e.data.id, message: String(err) }),
    );
  };
} else {
  pageMain();
}

// --- Page ------------------------------------------------------------------------------------------------

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | null | undefined>;
function h(tag: string, attrs: Attrs = {}, ...children: unknown[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v === false || v == null) { /* omit */ }
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity as 1)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

interface ModelRun<T> {
  state: 'idle' | 'running' | 'done' | 'error';
  result: T | null;
  elapsedMs: number;
  attempts: TwoStageResult['attempts'];
  error: string;
  backendUsed: Backend | null;
}
function fresh<T>(): ModelRun<T> { return { state: 'idle', result: null, elapsedMs: 0, attempts: [], error: '', backendUsed: null }; }

interface PageState {
  hand: string;
  dict: string;
  grid: number; // 0 = auto
  backend: Backend;
  tight: boolean;
  timeLimit: number; // seconds, for the one-shot model
  A: ModelRun<LettersResult>;
  B: ModelRun<GridResult>;
  C: ModelRun<TwoStageResult>;
}

function pageMain(): void {
  const root = document.getElementById('bananagrams')!;
  const state: PageState = { hand: '', dict: 'common', grid: 0, backend: 'highs', tight: false, timeLimit: 30, A: fresh(), B: fresh(), C: fresh() };

  // -- worker with in-process fallback --
  let worker: Worker | null = null;
  try {
    const script = document.currentScript as HTMLScriptElement | null;
    if (script?.src) worker = new Worker(script.src);
    else if (script?.textContent) worker = new Worker(URL.createObjectURL(new Blob([script.textContent], { type: 'text/javascript' })));
  } catch (e) {
    console.warn('Web Worker unavailable, solving on the main thread', e);
    worker = null;
  }
  let nextId = 1;
  const pending = new Map<number, { onProgress: (p: Progress) => void; resolve: (d: Done) => void; reject: (e: Error) => void }>();
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ type: string; id: number } & Partial<Done> & Partial<Progress> & { message?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      if (e.data.type === 'progress') p.onProgress(e.data as Progress);
      else if (e.data.type === 'done') { pending.delete(e.data.id); p.resolve(e.data as Done); }
      else { pending.delete(e.data.id); p.reject(new Error(e.data.message ?? 'worker error')); }
    };
    worker.onerror = (e) => { console.error(e); for (const [, p] of pending) p.reject(new Error('worker crashed')); pending.clear(); };
  }
  function submit(job: DistributiveOmit<Job, 'id'>, onProgress: (p: Progress) => void): Promise<Done> {
    const id = nextId++;
    const full = { ...job, id } as Job;
    if (!worker) return new Promise((resolve) => setTimeout(() => resolve(runJob(full, onProgress)), 30));
    return new Promise((resolve, reject) => { pending.set(id, { onProgress, resolve, reject }); worker!.postMessage(full); });
  }
  let cancelWorker = () => { /* set when a worker exists */ };
  if (worker) cancelWorker = () => { worker?.terminate(); worker = null; pending.clear(); location.reload(); };

  // -- helpers --
  const gridSize = () => state.grid || (state.hand.length <= 7 ? 5 : state.hand.length <= 11 ? 6 : state.hand.length <= 15 ? 7 : 8);
  const base = () => ({ backend: state.backend, dict: state.dict, hand: state.hand, rows: gridSize(), cols: gridSize(), timeoutMs: state.timeLimit * 1000 });
  const anyRunning = () => state.A.state === 'running' || state.B.state === 'running' || state.C.state === 'running';

  function writeHash(): void {
    const p = new URLSearchParams();
    if (state.hand) p.set('h', state.hand);
    if (state.dict !== 'common') p.set('d', state.dict);
    if (state.grid) p.set('g', String(state.grid));
    if (state.backend !== 'highs') p.set('s', state.backend);
    if (state.tight) p.set('t', '1');
    history.replaceState(null, '', p.size ? '#' + p.toString() : location.pathname);
  }
  function readHash(): void {
    const p = new URLSearchParams(location.hash.slice(1));
    try { state.hand = parseHand(p.get('h') ?? ''); } catch { state.hand = ''; }
    if (p.get('d') && dicts[p.get('d')!]) state.dict = p.get('d')!;
    state.grid = Number(p.get('g') ?? 0) || 0;
    state.backend = p.get('s') === 'yalps' ? 'yalps' : 'highs';
    state.tight = p.get('t') === '1';
  }

  function resetResults(): void { state.A = fresh(); state.B = fresh(); state.C = fresh(); }

  async function runA(): Promise<void> {
    if (!state.hand) return;
    state.A = { ...fresh(), state: 'running' };
    render();
    try {
      const d = await submit({ kind: 'letters', tight: state.tight, ...base() }, () => undefined);
      if (d.result.kind === 'letters') state.A = { ...fresh(), state: 'done', result: d.result.result, elapsedMs: d.elapsedMs, backendUsed: d.result.result.stats.backend };
    } catch (e) { state.A = { ...fresh(), state: 'error', error: String(e) }; }
    render();
  }
  async function runC(): Promise<void> {
    if (!state.hand) return;
    state.C = { ...fresh(), state: 'running' };
    render();
    try {
      const d = await submit({ kind: 'twostage', tight: state.tight, maxAttempts: 12, ...base() }, (p) => { state.C.attempts = [...state.C.attempts, p.attempt]; render(); });
      if (d.result.kind === 'twostage') state.C = { ...fresh(), state: 'done', result: d.result.result, attempts: d.result.result.attempts, elapsedMs: d.elapsedMs, backendUsed: d.result.result.stage2.backend ?? d.result.result.stage1.backend };
    } catch (e) { state.C = { ...fresh(), state: 'error', error: String(e) }; }
    render();
  }
  async function runB(): Promise<void> {
    if (!state.hand) return;
    state.B = { ...fresh(), state: 'running' };
    render();
    try {
      const d = await submit({ kind: 'grid', ...base() }, () => undefined);
      if (d.result.kind === 'grid') state.B = { ...fresh(), state: 'done', result: d.result.result, elapsedMs: d.elapsedMs, backendUsed: d.result.result.stats.backend };
    } catch (e) { state.B = { ...fresh(), state: 'error', error: String(e) }; }
    render();
  }
  async function runFast(): Promise<void> { await runA(); await runC(); }

  // Size estimate for the one-shot model: build it on the page without solving (cheap).
  interface Estimate { variables: number; constraints: number; shape: GridShape }
  let estimateCache: { key: string; value: Estimate } | null = null;
  function estimateB(): Estimate | null {
    if (!state.hand) return null;
    const key = `${state.hand}|${state.dict}|${gridSize()}`;
    if (estimateCache?.key === key) return estimateCache.value;
    const tiles = countLetters(state.hand);
    const words = candidateWords(dicts[state.dict]!, tiles, gridSize());
    const built = buildGridModel({ rows: gridSize(), cols: gridSize(), words, tiles });
    const value = { variables: built.m.variables.size, constraints: built.m.rows.size, shape: built.shape };
    estimateCache = { key, value };
    return value;
  }

  // -- rendering --
  function tile(ch: string, cls = ''): HTMLElement {
    return h('span', { class: `tile ${cls}`.trim() }, ch.toUpperCase());
  }
  function tiles(hand: string, cls = ''): HTMLElement {
    return h('span', { class: 'tiles' }, ...hand.split('').map((ch) => tile(ch, cls)));
  }
  function layoutView(layout: Layout, hand: string): HTMLElement {
    const problems = verifyLayout(layout, hand, dicts[state.dict]!);
    const el = h('div', { class: 'board', style: `grid-template-columns: repeat(${layout.cols}, var(--cell))` });
    for (let r = 0; r < layout.rows; r++) for (let c = 0; c < layout.cols; c++) {
      const ch = layout.grid[r]![c]!;
      el.appendChild(ch ? tile(ch, 'on-board') : h('span', { class: 'cell' }));
    }
    return h('div', { class: 'board-wrap' }, el,
      h('div', { class: 'hint' }, `${layout.placements.length} words: ${layout.placements.map((p) => p.word).join(', ')}`),
      problems.length ? h('div', { class: 'error' }, 'Independent check failed: ' + problems.join('; ')) : h('div', { class: 'ok' }, 'Independent check: every run is a word, all tiles used, one connected grid.'));
  }
  const fmtMs = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(0)} ms`;
  function statRow(pairs: [string, string][]): HTMLElement {
    return h('dl', { class: 'stats' }, ...pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }

  function handPanel(): HTMLElement {
    const input = h('input', { type: 'text', class: 'wide', placeholder: 'type your tiles: e.g. aeeinorsstt', value: state.hand, 'aria-label': 'Tiles in hand' }) as HTMLInputElement;
    const err = h('div', { class: 'error' });
    const apply = () => {
      try {
        const hand = parseHand(input.value);
        if (hand.length > 24) throw new Error('At most 24 tiles here; a starting hand is 21 or fewer.');
        state.hand = hand; resetResults(); render(); void runFast();
      } catch (e) { err.textContent = (e as Error).message; }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    const deal = (n: number) => () => { state.hand = dealHand(n); resetResults(); render(); void runFast(); };
    const sel = (label: string, value: string, options: [string, string][], onchange: (v: string) => void) =>
      h('label', { class: 'field' }, label, h('select', { onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
        ...options.map(([v, t]) => h('option', { value: v, selected: v === value }, t))));
    const letterCounts = [...countLetters(state.hand)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return h('section', { class: 'panel hand' },
      h('div', { class: 'row between' },
        h('h2', {}, 'Your hand ', h('small', {}, state.hand ? `${state.hand.length} tiles` : 'empty')),
        h('span', { class: 'row' },
          h('button', { class: 'small', type: 'button', onclick: deal(7) }, 'Deal 7'),
          h('button', { class: 'small', type: 'button', onclick: deal(11) }, 'Deal 11'),
          h('button', { class: 'small', type: 'button', onclick: deal(15) }, 'Deal 15'),
          h('button', { class: 'small', type: 'button', onclick: deal(21) }, 'Deal 21'),
        )),
      state.hand ? tiles(state.hand) : h('div', { class: 'empty' }, 'Deal some tiles or type letters below.'),
      h('div', { class: 'row' }, input, h('button', { class: 'small primary', type: 'button', onclick: apply }, 'Use these tiles')),
      err,
      h('div', { class: 'row options' },
        sel('Dictionary', state.dict, [['common', `Common words (${dicts.common!.words.length.toLocaleString()})`], ['large', `ENABLE ≤ 8 letters (${dicts.large!.words.length.toLocaleString()})`]], (v) => { state.dict = v; resetResults(); render(); }),
        sel('Board', String(state.grid), [['0', `auto (${gridSize()}×${gridSize()})`], ...[5, 6, 7, 8, 9, 10].map((n) => [String(n), `${n}×${n}`] as [string, string])], (v) => { state.grid = Number(v); resetResults(); render(); }),
        sel('Solver', state.backend, [['highs', 'HiGHS (WebAssembly)'], ['yalps', 'YALPS (pure JavaScript)']], (v) => { state.backend = v as Backend; resetResults(); render(); }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.tight, onchange: (e: Event) => { state.tight = (e.target as HTMLInputElement).checked; resetResults(); render(); } }), 'Tighter letters model'),
      ),
      state.hand ? h('div', { class: 'hint' }, 'Letter counts: ', letterCounts.map(([ch, n]) => `${ch.toUpperCase()}×${n}`).join(' · '), ` · ${candidateWords(dicts[state.dict]!, countLetters(state.hand), gridSize()).length} dictionary words can be spelled from these tiles and fit the board.`) : null,
    );
  }

  function modelCard(key: 'A' | 'B' | 'C'): HTMLElement {
    const titles = { A: 'Letters only', B: 'One-shot grid', C: 'Two-stage' };
    const subtitles = { A: 'pick words whose letters add up', B: 'place words on the board directly', C: 'pick words, then place them, repeat' };
    const run = state[key];
    const body: unknown[] = [];
    if (!state.hand) body.push(h('div', { class: 'empty' }, 'Waiting for a hand.'));
    else if (run.state === 'idle') {
      if (key === 'B') {
        const est = estimateB();
        body.push(h('p', { class: 'hint' }, est ? `Model size for this hand: ${est.variables.toLocaleString()} variables × ${est.constraints.toLocaleString()} rows (${est.shape.placements.toLocaleString()} placements).` : ''),
          h('div', { class: 'row' },
            h('button', { class: 'small primary', type: 'button', onclick: () => void runB(), disabled: anyRunning() }, 'Solve one-shot'),
            h('label', { class: 'field' }, 'time limit', h('select', { onchange: (e: Event) => { state.timeLimit = Number((e.target as HTMLSelectElement).value); } }, ...[10, 30, 60, 120].map((s) => h('option', { value: s, selected: s === state.timeLimit }, `${s} s`)))),
          ),
          h('p', { class: 'hint' }, 'Not run automatically: this is the expensive one. Seven tiles take seconds; eleven can take a minute or more.'));
      } else body.push(h('button', { class: 'small', type: 'button', onclick: () => void (key === 'A' ? runA() : runC()) }, 'Solve'));
    } else if (run.state === 'running') {
      body.push(h('div', { class: 'running' }, h('span', { class: 'spinner' }), key === 'B' ? `Solving… up to ${state.timeLimit} s.` : 'Solving…'));
      if (key === 'C' && state.C.attempts.length) body.push(attemptsList(state.C.attempts));
      if (key === 'B' && worker) body.push(h('button', { class: 'small ghost', type: 'button', onclick: cancelWorker }, 'Stop (reloads the page)'));
    } else if (run.state === 'error') body.push(h('div', { class: 'error' }, run.error));
    else if (key === 'A' && state.A.result) {
      const r = state.A.result;
      const laid = state.C.attempts.find((a) => a.words.join() === r.words.join());
      body.push(
        h('div', { class: `verdict ${r.feasible ? (laid ? (laid.laidOut ? 'yes' : 'no') : 'maybe') : 'no'}` },
          h('h4', {}, r.feasible ? 'Says yes' : 'Says no'),
          r.feasible ? h('div', {}, 'Words: ', h('b', {}, r.words.join(' + ')), ' with crossings ', [...r.crossings].filter(([, n]) => n > 0).map(([ch, n]) => `${ch.toUpperCase()}×${n}`).join(', ') || 'none') : h('div', {}, 'No set of words spells these tiles, so no layout can exist either. This answer is trustworthy.'),
          r.feasible ? h('div', { class: 'hint' }, laid ? (laid.laidOut ? 'The two-stage model laid exactly these words out, so this yes was right.' : 'The two-stage model tried exactly these words and they cannot be laid out. This yes was a false positive.') : 'Nothing has checked whether these words can actually be placed.') : null,
        ),
        statRow([['variables', r.stats.variables.toLocaleString()], ['rows', r.stats.constraints.toLocaleString()], ['solve', fmtMs(r.stats.solveMs)], ['candidates', r.model.candidates.length.toLocaleString()], ['backend', r.stats.backend ?? '']]),
      );
    } else if (key === 'B' && state.B.result) {
      const r = state.B.result;
      body.push(
        h('div', { class: `verdict ${r.feasible ? 'yes' : r.stats.status === 'infeasible' ? 'no' : 'maybe'}` },
          h('h4', {}, r.feasible ? 'Yes, and here is the board' : r.stats.status === 'infeasible' ? `No layout exists on a ${gridSize()}×${gridSize()} board` : r.stats.status === 'timedout' ? `Gave up after ${state.timeLimit} s` : `Solver stopped: ${r.stats.status}`),
          r.layout ? layoutView(r.layout, state.hand) : null,
          r.stats.status === 'infeasible' ? h('div', { class: 'hint' }, 'This is a proof, not a guess: the solver showed no assignment satisfies every row.') : null,
        ),
        statRow([['variables', r.stats.variables.toLocaleString()], ['rows', r.stats.constraints.toLocaleString()], ['solve', fmtMs(r.stats.solveMs)], ['placements', r.shape.placements.toLocaleString()], ['backend', r.stats.backend ?? '']]),
        h('div', { class: 'row' },
          h('button', { class: 'small', type: 'button', onclick: () => { state.B = fresh(); render(); } }, r.stats.status === 'timedout' ? 'Try again with a longer limit' : 'Reset'),
          r.stats.status === 'timedout' ? h('span', { class: 'hint' }, 'or pick a smaller board / fewer tiles.') : null),
      );
    } else if (key === 'C' && state.C.result) {
      const r = state.C.result;
      body.push(
        h('div', { class: `verdict ${r.feasible ? 'yes' : r.status === 'letters-infeasible' ? 'no' : 'maybe'}` },
          h('h4', {}, r.feasible ? `Yes, found on attempt ${r.attempts.length}` : r.status === 'letters-infeasible' ? 'No: stage 1 finds no words at all' : `Gave up after ${r.attempts.length} word sets`),
          r.layout ? layoutView(r.layout, state.hand) : null,
          r.status === 'gave-up' ? h('div', { class: 'hint' }, 'Every word set stage 1 proposed failed to lay out. That is not a proof of impossibility, only a limit on patience; the one-shot model can settle it.') : null,
        ),
        attemptsList(r.attempts),
        statRow([['stage 1', `${r.stage1.variables.toLocaleString()} × ${r.stage1.constraints.toLocaleString()}, ${fmtMs(r.stage1.solveMs)}`], ['stage 2', `${r.stage2.variables.toLocaleString()} × ${r.stage2.constraints.toLocaleString()}, ${fmtMs(r.stage2.solveMs)}`], ['solves', String(r.stage1.solves + r.stage2.solves)], ['backend', r.stage2.backend ?? r.stage1.backend ?? '']]),
      );
    }
    return h('section', { class: `panel model model-${key}` },
      h('div', { class: 'model-head' }, h('span', { class: 'model-letter' }, key), h('div', {}, h('h3', {}, titles[key]), h('div', { class: 'hint' }, subtitles[key]))),
      ...body,
    );
  }

  function attemptsList(attempts: TwoStageResult['attempts']): HTMLElement {
    return h('ol', { class: 'attempts' }, ...attempts.map((a) => h('li', { class: a.laidOut ? 'ok' : 'bad' }, h('span', { class: 'mark' }, a.laidOut ? '✓' : '✗'), ' ', a.words.join(' + '), h('span', { class: 'hint' }, ` (${fmtMs(a.stage2.solveMs)})`))));
  }

  function summaryTable(): HTMLElement | null {
    if (!state.hand) return null;
    const rowFor = (name: string, run: ModelRun<unknown>, answer: string, size: string, time: string, note: string) =>
      h('tr', {}, h('td', {}, name), h('td', {}, run.state === 'done' ? answer : run.state === 'running' ? 'running…' : run.state === 'error' ? 'error' : 'not run'), h('td', { class: 'num' }, size), h('td', { class: 'num' }, time), h('td', {}, note));
    const A = state.A.result, B = state.B.result, C = state.C.result;
    const cLaid = C?.feasible ? 'yes (laid out)' : C?.status === 'letters-infeasible' ? 'no (proof)' : C?.status === 'gave-up' ? 'unknown (gave up)' : '';
    const aLaid = A ? (A.feasible ? 'yes (unverified)' : 'no (proof)') : '';
    const bLaid = B ? (B.feasible ? 'yes (laid out)' : B.stats.status === 'infeasible' ? 'no (proof)' : 'unknown (timed out)') : '';
    return h('table', { class: 'summary' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Model'), h('th', {}, 'Answer'), h('th', { class: 'num' }, 'Size (vars × rows)'), h('th', { class: 'num' }, 'Solver time'), h('th', {}, 'What the answer is worth'))),
      h('tbody', {},
        rowFor('A · letters only', state.A, aLaid, A ? `${A.stats.variables.toLocaleString()} × ${A.stats.constraints.toLocaleString()}` : '', A ? fmtMs(A.stats.solveMs) : '', 'A "no" is a proof. A "yes" is a hypothesis.'),
        rowFor('B · one-shot grid', state.B, bLaid, B ? `${B.stats.variables.toLocaleString()} × ${B.stats.constraints.toLocaleString()}` : '', B ? fmtMs(B.stats.solveMs) : '', 'Both answers are proofs, on this board size and dictionary.'),
        rowFor('C · two-stage', state.C, cLaid, C ? `${C.stage1.variables.toLocaleString()} × ${C.stage1.constraints.toLocaleString()} then ${C.stage2.variables.toLocaleString()} × ${C.stage2.constraints.toLocaleString()}` : '', C ? fmtMs(C.stage1.solveMs + C.stage2.solveMs) : '', 'A "yes" is a real board. A "no" from stage 1 is a proof; giving up is not.'),
      ));
  }

  // -- explainer --
  function explainer(): HTMLElement {
    const sec = (n: string, title: string, ...body: unknown[]) => h('section', { class: 'step' }, h('div', { class: 'step-n' }, n), h('div', { class: 'step-body' }, h('h3', {}, title), ...body));
    const code = (text: string) => h('pre', { class: 'code' }, text);
    const hand = state.hand;
    const tilesMap = countLetters(hand);
    const dict = dicts[state.dict]!;
    const g = gridSize();
    const cands = hand ? candidateWords(dict, tilesMap, g) : [];
    const A = state.A.result;
    const words = A?.feasible ? A.words : [];
    const chosenSet = new Set(words);

    // Model A equations, written out for this hand.
    const eqA: HTMLElement[] = [];
    if (hand) {
      const letters = [...tilesMap.keys()].sort();
      for (const ch of letters) {
        const inChosen = words.filter((w) => w.includes(ch)).map((w) => { const n = [...w].filter((x) => x === ch).length; return `${n > 1 ? n + '·' : ''}x[${w}]`; });
        const others = cands.filter((w) => w.includes(ch) && !chosenSet.has(w)).length;
        const lhs = [...inChosen, others ? `(${others} more word${others === 1 ? '' : 's'} with ${ch.toUpperCase()}, all 0)` : ''].filter(Boolean).join(' + ') || '0';
        const o = A?.crossings.get(ch) ?? 0;
        eqA.push(h('div', { class: 'eq' }, h('span', { class: 'eq-l' }, tile(ch)), h('span', { class: 'eq-body' }, `${lhs} − o[${ch}] = ${tilesMap.get(ch)}`), h('span', { class: 'eq-why' }, A?.feasible ? `${inChosen.length ? words.filter((w) => w.includes(ch)).reduce((t, w) => t + [...w].filter((x) => x === ch).length, 0) : 0} − ${o} = ${tilesMap.get(ch)} ✓` : '')));
      }
    }

    // One-shot model shape and LP excerpt.
    const shapeB: Estimate | null = state.B.result ? { variables: state.B.result.stats.variables, constraints: state.B.result.stats.constraints, shape: state.B.result.shape } : estimateB();
    let lpExcerpt = '';
    if (hand && cands.length && cands.length <= 400) {
      const m = buildLettersModel(cands.slice(0, 12), tilesMap, 'fewest-words');
      lpExcerpt = toLP(m).split('\n').slice(0, 14).join('\n') + '\n…';
    }

    const attempts = state.C.attempts;
    return h('section', { class: 'explainer' },
      h('header', { class: 'ex-head' },
        h('h2', {}, 'Three ways to ask a solver the same question'),
        h('p', {}, 'The question is "can every tile in my hand go into one connected crossword?" Nothing below searches for layouts by hand. Each approach writes the question as an integer program, a list of yes/no variables with linear rules, and hands it to a general-purpose optimiser. They differ in how much of the board they put into the arithmetic, and that single choice sets both how fast they run and how much their answer is worth.'),
      ),

      sec('A', 'Letters only: the anagram model',
        h('p', {}, 'Forget the board. A dump is a set of words whose letters, taken together, are your tiles, except that where two words cross they share one tile. So: one binary variable per dictionary word you could spell, one integer variable per letter counting how many crossings land on that letter, and one equation per letter.'),
        hand ? h('p', {}, `For this hand the dictionary contributes `, h('b', {}, `${cands.length} candidate words`), ` (every word spellable from the tiles that fits a ${g}-wide board). The equations, with the words the solver chose written out:`) : h('p', { class: 'hint' }, 'Deal a hand to see the equations for it.'),
        eqA.length ? h('div', { class: 'eqs' }, ...eqA) : null,
        h('p', {}, 'Two more rows tie it together. Crossings must number at least words − 1, because a connected crossword of k words has at least k − 1 places where two meet. And each letter cannot cross more times than it has tiles. The objective picks the fewest words, which tends toward long words and, as the attempts below show, is not always what the board wants.'),
        h('p', {}, h('b', {}, 'What the answer is worth.'), ' If this model says no, no layout exists: any layout would give a word set satisfying every row. If it says yes, all you have is a word set with plausible letter arithmetic. It has never looked at whether those words can touch each other on a grid, so the yes can be false. The tighter variant adds a variable per word per letter saying which word crosses on what, and forbids a chosen word from having no crossing at all; it catches a few more impossible sets but costs solve time, and the failures that matter are mostly geometric, so it is off by default.'),
        lpExcerpt ? h('details', {}, h('summary', {}, 'What the solver actually receives ', h('small', {}, 'CPLEX LP text, first lines, twelve candidates shown')), code(lpExcerpt)) : null,
      ),

      sec('B', 'One-shot grid: put the board in the model',
        h('p', {}, `Now include geometry. Fix a ${g}×${g} board. One binary variable for each way to put each candidate word on it, across or down, at every position it fits: ${shapeB ? shapeB.shape.placements.toLocaleString() + ' placements here' : 'the placements'}. One binary per cell per letter saying what that cell holds. Then rules that make the board a legal Bananagrams grid:`),
        h('ul', { class: 'rules' },
          h('li', {}, h('b', {}, 'A cell holds one letter,'), ' and every placement covering a cell must agree with it.'),
          h('li', {}, h('b', {}, 'Every tile is used exactly once:'), ' the cells holding E must number exactly the E tiles in hand. This is the "dump the whole hand" line; relax it to ≤ and the model plays a normal turn instead.'),
          h('li', {}, h('b', {}, 'Every run is a word.'), ' Two horizontally adjacent occupied cells must lie inside one across placement, and no two across placements may share a cell. Together those force every maximal run of letters to be exactly one chosen word, with nothing dangling off its end. Same vertically.'),
          h('li', {}, h('b', {}, 'Every tile is in a word:'), ' an occupied cell must be covered by at least one placement, so no lone tiles.'),
          h('li', {}, h('b', {}, 'One connected grid.'), ' This is the awkward one. The trick is a flow: one occupied cell is elected root, it emits T − 1 units of an imaginary fluid along grid edges, every other occupied cell must absorb exactly one unit, and fluid may only enter occupied cells. A tile the fluid cannot reach cannot absorb its unit, so a disconnected board is infeasible. It costs one continuous variable per directed edge.'),
          h('li', {}, h('b', {}, 'Pin it down:'), ' row 0 and column 0 must each hold a tile, so the solver does not waste effort on the same board shifted around.'),
        ),
        shapeB ? h('div', { class: 'shape' }, h('div', { class: 'hint' }, `Rows for this hand: ` + shapeB.shape.rows.map((r) => `${r.name} ×${r.count.toLocaleString()}`).join(' · ')), h('div', { class: 'hint' }, `Total: ${shapeB.variables.toLocaleString()} variables and ${shapeB.constraints.toLocaleString()} rows.`)) : null,
        h('p', {}, h('b', {}, 'What the answer is worth.'), ' Everything. A yes comes with the board; a no is a proof that no board of this size exists with this dictionary. The price is size: placements grow with words × cells × 2, the flow adds four variables per cell, and the linear relaxation is loose because of the big coefficients in the flow rows, so branch-and-bound works hard. Seven tiles solve in seconds; eleven can take minutes, and this is with a real sparse solver. The pure-JavaScript solver on the same model is out of the question above five or six tiles, which is why this page ships HiGHS compiled to WebAssembly.'),
      ),

      sec('C', 'Two-stage: let A propose and a small B dispose',
        h('p', {}, 'Combine them. Solve the letters model to get a word set. Build the grid model with only those words, each required to appear exactly once, which is a few hundred variables instead of thousands. If it lays out, done. If not, add one row to the letters model forbidding that exact set, a "no-good cut", and ask it again.'),
        attempts.length ? h('div', {}, h('p', {}, 'For this hand the loop went:'), attemptsList(attempts)) : h('p', { class: 'hint' }, 'Run the two-stage model to see the loop for this hand.'),
        hand && attempts.some((a) => !a.laidOut) ? h('p', {}, 'Each ✗ is a word set that passed the letter arithmetic and failed on the board. Most fail for reasons no letter count can see: two words that share only one letter must cross there, and the crossing drags their other letters next to each other, making runs that are not words.') : null,
        h('p', {}, h('b', {}, 'What the answer is worth.'), ' A yes is a real board. A no from stage 1 is a proof. But giving up after a dozen attempts proves nothing, and the loop can in principle grind through every word set; in practice a few attempts settle almost every hand, because the fewest-words objective returns a fresh set each time and the stage-2 models are small. The cut is exact and the loop is complete: with unlimited attempts it reaches the same answer as the one-shot model.'),
      ),

      sec('=', 'Comparison',
        summaryTable(),
        h('p', {}, 'Measured offline on random hands from a real 144-tile set with the common dictionary, HiGHS in WebAssembly under Node, no board larger than the auto setting:'),
        h('table', { class: 'bench' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Tiles'), h('th', {}, 'Board'), h('th', { class: 'num' }, 'A'), h('th', { class: 'num' }, 'C (all attempts)'), h('th', { class: 'num' }, 'B (one solve)'), h('th', {}, 'Notes'))),
          h('tbody', {},
            h('tr', {}, h('td', {}, '7'), h('td', {}, '5×5'), h('td', { class: 'num' }, '2–10 ms'), h('td', { class: 'num' }, '20–250 ms'), h('td', { class: 'num' }, '0.3–9 s'), h('td', {}, 'B has 700–2,000 placement variables; its solve time is dominated by the flow rows.')),
            h('tr', {}, h('td', {}, '9'), h('td', {}, '6×6'), h('td', { class: 'num' }, '5–15 ms'), h('td', { class: 'num' }, '50 ms–1.4 s'), h('td', { class: 'num' }, '14–23 s, or 0.2 s to prove no'), h('td', {}, 'One hand needed ten stage-1 proposals before one laid out.')),
            h('tr', {}, h('td', {}, '11'), h('td', {}, '6×6'), h('td', { class: 'num' }, '10–230 ms'), h('td', { class: 'num' }, '60–300 ms'), h('td', { class: 'num' }, 'not attempted'), h('td', {}, '300+ candidate words; the letters model is still instant.')),
            h('tr', {}, h('td', {}, '13'), h('td', {}, '7×7'), h('td', { class: 'num' }, '40–340 ms'), h('td', { class: 'num' }, '0.1–1 s'), h('td', { class: 'num' }, 'not attempted'), h('td', {}, 'Up to nine attempts; every layout verified independently.')),
          )),
        h('ul', { class: 'rules' },
          h('li', {}, h('b', {}, 'The letters model is a relaxation.'), ' Fast and sound for "no", unreliable for "yes". Its proposals fail on the board often enough that it should never be the last word.'),
          h('li', {}, h('b', {}, 'The one-shot model is the ground truth,'), ' and the only one of the three that proves a "no" once words exist. It is also the only one whose cost is set by the board rather than the hand.'),
          h('li', {}, h('b', {}, 'Two-stage is the practical answer.'), ' It solves what the letters model is good at, counting, and gives the grid model only the part it is good at, a handful of words. It is complete in the limit and fast in practice.'),
          h('li', {}, h('b', {}, 'The objective is a modelling decision.'), ' Fewest words proposes long words that rarely cross well; most words proposes a soup of two-letter words that is slow to place. Fewest words won on every hand measured.'),
          h('li', {}, h('b', {}, 'Tightening the relaxation did not pay.'), ' Adding per-word crossing structure to stage 1 cut few failed attempts and slowed it up to tenfold, because the failures are about adjacency, which no counting model sees.'),
          h('li', {}, h('b', {}, 'The solver matters as much as the model.'), ' The dense pure-JavaScript simplex needed seconds and millions of pivots on stage-2 models that HiGHS solves in tens of milliseconds. Switch the solver above to feel the difference.'),
        ),
        h('p', { class: 'hint' }, 'Simplifications, so the models stay readable: each word may be used at most once; the board is a fixed square; words come from a chosen list, and Bananagrams tables famously disagree about which words count. The 144-tile distribution, the two dictionaries, and every model are in the page source.'),
      ),
    );
  }

  function render(): void {
    writeHash();
    root.replaceChildren(
      h('header', { class: 'bg-head' },
        h('h1', {}, 'Can I dump my hand?'),
        h('p', {}, 'Bananagrams, answered three ways by integer programming, in your browser. Deal tiles, watch the letters-only model guess, the two-stage model lay out a board, and the one-shot model do it the hard way.'),
      ),
      handPanel(),
      h('div', { class: 'models' }, modelCard('A'), modelCard('C'), modelCard('B')),
      explainer(),
      h('footer', { class: 'foot' }, `Solvers: HiGHS ${'1.15'} compiled to WebAssembly (MIT), YALPS (MIT). Tile distribution: ${Object.entries(DISTRIBUTION).map(([k, v]) => k.toUpperCase() + v).join(' ')}.`),
    );
  }

  readHash();
  if (!state.hand) state.hand = dealHand(9);
  render();
  void runFast();
}
