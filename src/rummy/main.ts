/**
 * Rummy solver page (/rummy). Pick a hand, describe the melds on the table, and
 * see every legal meld and lay-off, the minimum-deadwood arrangement, the best
 * discard, and whether you can go out. All solving runs in the browser via the
 * integer program in ./solver.ts.
 */
import { h } from '../client/dom.js';
import {
  type Card,
  type Rules,
  type Suit,
  DEFAULT_RULES,
  RANKS,
  SUITS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  cardPoints,
  cardToPretty,
  cardToString,
  fullDeck,
  parseCard,
  parseCards,
  rankLabel,
  sameCard,
  sortCards,
} from './cards.js';
import { type Meld, asMeld } from './melds.js';
import { type Analysis, type Move, type Plan, type TableMeld, type VarInfo, MAX_HAND, analyze, evaluateSetting, solveHand, solveRelaxed } from './solver.js';

interface State {
  hand: Card[];
  table: TableMeld[];
  /** Top of the discard pile, if the user wants to evaluate taking it. */
  discardTop: Card | null;
  /** Cards picked in the table grid but not yet added as a meld. */
  pending: Card[];
  rules: Rules;
  /** The reader's own on/off setting of the variables in the explainer, keyed by the hand it was made for. */
  sandbox: { key: string; on: Set<string> } | null;
}

const state: State = { hand: [], table: [], discardTop: null, pending: [], rules: { ...DEFAULT_RULES }, sandbox: null };
const root = document.getElementById('rummy')!;

// --- URL hash <-> state (so a situation can be shared) ------------------------------

function writeHash(): void {
  const p = new URLSearchParams();
  if (state.hand.length) p.set('h', state.hand.map(cardToString).join(','));
  if (state.table.length) p.set('t', state.table.map((t) => t.meld.cards.map(cardToString).join(',')).join(';'));
  if (state.discardTop) p.set('d', cardToString(state.discardTop));
  const o: string[] = [];
  if (!state.rules.aceLow) o.push('nolow');
  if (state.rules.aceHigh) o.push('high');
  if (!state.rules.discardToGoOut) o.push('nodiscard');
  if (!state.rules.rearrangeTable) o.push('layoffonly');
  if (o.length) p.set('o', o.join(','));
  history.replaceState(null, '', p.size ? '#' + p.toString() : location.pathname);
}

function readHash(): void {
  const p = new URLSearchParams(location.hash.slice(1));
  const o = new Set((p.get('o') ?? '').split(',').filter(Boolean));
  state.rules = { ...DEFAULT_RULES, aceLow: !o.has('nolow'), aceHigh: o.has('high'), discardToGoOut: !o.has('nodiscard'), rearrangeTable: !o.has('layoffonly') };
  try {
    state.hand = parseCards(p.get('h') ?? '');
    state.table = [];
    for (const m of (p.get('t') ?? '').split(';').filter(Boolean)) addTableMeld(parseCards(m));
    state.discardTop = p.get('d') ? parseCard(p.get('d')!) : null;
  } catch {
    // A malformed hash just starts empty.
  }
}

// --- State helpers ------------------------------------------------------------------

function nextTableId(): string {
  let i = 1;
  while (state.table.some((t) => t.id === `T${i}`)) i++;
  return `T${i}`;
}

function addTableMeld(cards: Card[]): void {
  const meld = asMeld(cards, state.rules);
  if (!meld) throw new Error(`${cards.map(cardToString).join(' ')} is not a valid set or run`);
  for (const c of cards) {
    if (onTable(c)) throw new Error(`${cardToString(c)} is already on the table`);
  }
  state.hand = state.hand.filter((c) => !cards.some((x) => sameCard(x, c)));
  state.pending = state.pending.filter((c) => !cards.some((x) => sameCard(x, c)));
  if (state.discardTop && cards.some((x) => sameCard(x, state.discardTop!))) state.discardTop = null;
  state.table.push({ id: nextTableId(), meld });
}

function onTable(c: Card): TableMeld | undefined {
  return state.table.find((t) => t.meld.cards.some((x) => sameCard(x, c)));
}

function inHand(c: Card): boolean {
  return state.hand.some((x) => sameCard(x, c));
}

function toggleHand(c: Card): void {
  if (onTable(c)) return;
  if (inHand(c)) state.hand = state.hand.filter((x) => !sameCard(x, c));
  else {
    if (state.hand.length >= MAX_HAND) return;
    if (state.discardTop && sameCard(state.discardTop, c)) state.discardTop = null;
    state.pending = state.pending.filter((x) => !sameCard(x, c));
    state.hand.push(c);
  }
  render();
}

function freeCards(): Card[] {
  return fullDeck().filter((c) => !inHand(c) && !onTable(c) && !(state.discardTop && sameCard(state.discardTop, c)));
}

function dealRandom(n: number): void {
  const pool = freeCards();
  state.hand = [];
  for (let i = 0; i < n && pool.length; i++) {
    const j = Math.floor(Math.random() * pool.length);
    state.hand.push(pool.splice(j, 1)[0]!);
  }
  render();
}

function loadExample(): void {
  state.hand = [];
  state.table = [];
  state.pending = [];
  state.rules = { ...DEFAULT_RULES };
  addTableMeld(parseCards('5H 6H 7H'));
  addTableMeld(parseCards('KS KD KC'));
  state.hand = parseCards('AS 2S 3S 9D 9C 9H 8H 4H QD KH');
  state.discardTop = parseCard('JD');
  render();
}

// --- Rendering ----------------------------------------------------------------------

function isRed(c: Card): boolean {
  return c.suit === 'H' || c.suit === 'D';
}

function cardChip(c: Card, cls = ''): HTMLElement {
  return h('span', { class: `card ${isRed(c) ? 'red' : ''} ${cls}`.trim(), title: `${cardPoints(c, state.rules)} pts` }, cardToPretty(c));
}

function cardRow(cards: readonly Card[], cls = ''): HTMLElement {
  return h('span', { class: 'cards' }, ...sortCards(cards).map((c) => cardChip(c, cls)));
}

function meldRow(m: Meld, tag: string, extra?: HTMLElement): HTMLElement {
  const cards = m.kind === 'run' ? m.cards : sortCards(m.cards);
  return h('div', { class: 'meld' },
    h('span', { class: 'tag' }, tag),
    h('span', { class: 'cards' }, ...cards.map((c) => cardChip(c))),
    h('span', { class: 'kind' }, m.kind === 'set' ? 'set' : 'run'),
    extra,
  );
}

function moveRow(mv: Move): HTMLElement {
  if (mv.kind === 'meld') return meldRow(mv.meld, 'lay');
  if (mv.kind === 'rearrange') {
    const fromHand = new Set(mv.fromHand.map(cardToString));
    const cards = mv.meld.kind === 'run' ? mv.meld.cards : sortCards(mv.meld.cards);
    return h('div', { class: 'meld' },
      h('span', { class: 'tag' }, mv.sources.join('+')),
      h('span', { class: 'cards' }, ...cards.map((c) => cardChip(c, fromHand.has(cardToString(c)) ? 'new' : 'ghost'))),
      h('span', { class: 'kind' }, mv.fromHand.length ? `rebuilt ${mv.meld.kind}` : `${mv.meld.kind} left over`),
    );
  }
  const t = mv.target.meld;
  const before = t.kind === 'run' ? t.cards : sortCards(t.cards);
  const after = mv.end === 'low' ? [...[...mv.cards].reverse().map((c) => ({ c, isNew: true })), ...before.map((c) => ({ c, isNew: false }))]
    : [...before.map((c) => ({ c, isNew: false })), ...mv.cards.map((c) => ({ c, isNew: true }))];
  return h('div', { class: 'meld' },
    h('span', { class: 'tag' }, mv.target.id),
    h('span', { class: 'cards' }, ...after.map(({ c, isNew }) => cardChip(c, isNew ? 'new' : 'ghost'))),
    h('span', { class: 'kind' }, mv.end === 'set' ? 'add to set' : `extend ${mv.end} end`),
  );
}

interface CellSpec {
  cls: string;
  title: string;
  onclick: () => void;
}

/** The 52-card grid, one row per suit. `cell` decides how each card looks and what clicking it does. */
function deckGrid(cell: (c: Card) => CellSpec): HTMLElement {
  const grid = h('div', { class: 'deck' });
  for (const suit of SUITS) {
    grid.appendChild(h('div', { class: `suit-label ${suit === 'H' || suit === 'D' ? 'red' : ''}`, title: SUIT_NAMES[suit] }, SUIT_SYMBOLS[suit]));
    for (const rank of RANKS) {
      const c: Card = { rank, suit: suit as Suit };
      const spec = cell(c);
      grid.appendChild(h('button', { class: `pick ${isRed(c) ? 'red' : ''} ${spec.cls}`.trim(), type: 'button', title: spec.title, onclick: spec.onclick }, rankLabel(rank)));
    }
  }
  return grid;
}

function handPicker(): HTMLElement {
  return deckGrid((c) => {
    const table = onTable(c);
    if (table) return { cls: 'on-table', title: `${cardToString(c)} is on the table (${table.id})`, onclick: () => undefined };
    const isDiscard = !!state.discardTop && sameCard(c, state.discardTop);
    return {
      cls: [inHand(c) && 'in-hand', isDiscard && 'is-discard'].filter(Boolean).join(' '),
      title: inHand(c) ? 'Remove from hand' : isDiscard ? 'Top of the discard pile — click to take it into hand' : 'Add to hand',
      onclick: () => toggleHand(c),
    };
  });
}

function inPending(c: Card): boolean {
  return state.pending.some((x) => sameCard(x, c));
}

function tablePicker(): HTMLElement {
  return deckGrid((c) => {
    const table = onTable(c);
    if (table) return { cls: 'on-table-meld', title: `${table.id} — click to remove this meld from the table`, onclick: () => { state.table = state.table.filter((t) => t !== table); render(); } };
    if (inHand(c)) return { cls: 'in-hand-dim', title: `${cardToString(c)} is in your hand — click to move it to the table`, onclick: () => { state.hand = state.hand.filter((x) => !sameCard(x, c)); state.pending.push(c); render(); } };
    return {
      cls: inPending(c) ? 'pending' : '',
      title: inPending(c) ? 'Remove from the meld being built' : 'Add to the meld being built',
      onclick: () => { state.pending = inPending(c) ? state.pending.filter((x) => !sameCard(x, c)) : [...state.pending, c]; render(); },
    };
  });
}

function handPanel(): HTMLElement {
  const typed = h('input', { type: 'text', class: 'wide', placeholder: 'or type a hand: AS 2S 3S 9D 9C 9H …', 'aria-label': 'Hand as text' }) as HTMLInputElement;
  const err = h('div', { class: 'error' });
  const apply = () => {
    try {
      const cards = parseCards(typed.value);
      const clash = cards.find((c) => onTable(c));
      if (clash) throw new Error(`${cardToString(clash)} is on the table`);
      if (cards.length > MAX_HAND) throw new Error(`At most ${MAX_HAND} cards`);
      state.hand = cards;
      render();
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  };
  typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });

  const pts = state.hand.reduce((s, c) => s + cardPoints(c, state.rules), 0);
  return h('section', { class: 'panel' },
    h('h2', {}, 'Your hand ', h('small', {}, `${state.hand.length} cards · ${pts} pts`)),
    h('div', { class: 'row between' },
      h('span', { class: 'hint' }, 'Click cards to add or remove them. Struck-through cards are on the table.'),
      h('span', { class: 'row' },
        h('button', { class: 'small', type: 'button', onclick: () => dealRandom(7) }, 'Deal 7'),
        h('button', { class: 'small', type: 'button', onclick: () => dealRandom(10) }, 'Deal 10'),
        h('button', { class: 'small', type: 'button', onclick: () => dealRandom(13) }, 'Deal 13'),
        h('button', { class: 'small ghost', type: 'button', onclick: () => { state.hand = []; render(); } }, 'Clear'),
      ),
    ),
    handPicker(),
    state.hand.length ? cardRow(state.hand) : h('div', { class: 'empty' }, 'No cards in hand yet.'),
    h('div', { class: 'row' }, typed, h('button', { class: 'small', type: 'button', onclick: apply }, 'Set hand')),
    err,
  );
}

function tablePanel(): HTMLElement {
  const input = h('input', { type: 'text', class: 'wide', placeholder: 'or type a meld: 5H 6H 7H', 'aria-label': 'Meld to add' }) as HTMLInputElement;
  const err = h('div', { class: 'error' });
  const add = () => {
    try {
      addTableMeld(parseCards(input.value));
      input.value = '';
      render();
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  const list = state.table.length
    ? h('div', { class: 'melds' }, ...state.table.map((t) => meldRow(t.meld, t.id,
      h('button', { class: 'x', type: 'button', title: 'Remove from table', onclick: () => { state.table = state.table.filter((x) => x !== t); render(); } }, '×'))))
    : h('div', { class: 'empty' }, 'Nothing on the table yet. Melds here can be laid off onto.');

  // Partition the staged cards into melds with the solver itself: if nothing is
  // left over, every meld it found can go on the table in one click.
  const split = state.pending.length ? solveHand(state.pending, [], state.rules) : null;
  const splitMelds = split ? split.moves.flatMap((m) => (m.kind === 'meld' ? [m.meld] : [])) : [];
  const complete = !!split && split.deadwood.length === 0 && splitMelds.length > 0;
  const addPending = () => {
    try {
      for (const m of splitMelds) addTableMeld([...m.cards]);
      state.pending = [];
      render();
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  };
  let status: HTMLElement | null = null;
  if (split && state.pending.length) {
    if (complete) status = h('span', { class: 'hint' }, splitMelds.length === 1 ? `valid ${splitMelds[0]!.kind}` : `${splitMelds.length} melds`);
    else if (state.pending.length < 3) status = h('span', { class: 'hint' }, `${3 - state.pending.length} more`);
    else status = h('span', { class: 'error' }, splitMelds.length ? 'left over: ' : 'not a set or run', splitMelds.length ? cardRow(split.deadwood, 'dead') : null);
  }
  const pendingRow = h('div', { class: 'pending-row' },
    h('div', { class: 'row' },
      h('span', { class: 'hint' }, 'Building:'),
      state.pending.length ? cardRow(state.pending, 'new') : h('span', { class: 'empty' }, 'click cards above; pick several melds at once if you like'),
      status,
      h('button', { class: 'small', type: 'button', disabled: !complete, onclick: addPending }, splitMelds.length > 1 ? `Add ${splitMelds.length} melds` : 'Add to table'),
      state.pending.length ? h('button', { class: 'small ghost', type: 'button', onclick: () => { state.pending = []; render(); } }, 'Clear') : null,
    ),
    complete && splitMelds.length > 1 ? h('div', { class: 'melds' }, ...splitMelds.map((m) => meldRow(m, 'new'))) : null,
  );

  const discard = h('input', { type: 'text', placeholder: 'e.g. JD', 'aria-label': 'Top of discard pile', value: state.discardTop ? cardToString(state.discardTop) : '' }) as HTMLInputElement;
  discard.style.width = '6rem';
  const setDiscard = () => {
    const v = discard.value.trim();
    if (!v) { state.discardTop = null; render(); return; }
    const c = parseCard(v);
    if (!c) { err.textContent = `Unrecognised card "${v}"`; return; }
    if (onTable(c) || inHand(c)) { err.textContent = `${cardToString(c)} is already in play`; return; }
    state.discardTop = c;
    render();
  };
  discard.addEventListener('keydown', (e) => { if (e.key === 'Enter') setDiscard(); });
  discard.addEventListener('blur', setDiscard);

  const rule = (key: 'aceLow' | 'aceHigh' | 'discardToGoOut' | 'rearrangeTable', label: string) =>
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: state.rules[key], onchange: (e: Event) => { state.rules = { ...state.rules, [key]: (e.target as HTMLInputElement).checked }; revalidateTable(); render(); } }),
      label);

  return h('section', { class: 'panel' },
    h('h2', {}, 'On the table ', h('small', {}, `${state.table.length} melds`)),
    h('span', { class: 'hint' }, 'Click cards to build a meld, then add it. Filled cards are already on the table; click one to remove its meld.'),
    tablePicker(),
    pendingRow,
    list,
    h('div', { class: 'row' }, input, h('button', { class: 'small', type: 'button', onclick: add }, 'Add meld')),
    h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Top of discard pile:'), discard, h('span', { class: 'hint' }, 'optional — shows what taking it would do')),
    h('div', { class: 'row' }, rule('aceLow', 'Ace low (A-2-3)'), rule('aceHigh', 'Ace high (Q-K-A)'), rule('discardToGoOut', 'Must discard to go out'), rule('rearrangeTable', 'Table melds can be rearranged')),
    err,
  );
}

/** Rule changes can invalidate a table meld (e.g. Q-K-A after turning ace-high off). */
function revalidateTable(): void {
  state.table = state.table.filter((t) => asMeld(t.meld.cards, state.rules));
}

function planSteps(plan: Plan, discard: Card | null): HTMLElement {
  const steps: HTMLElement[] = [];
  const rebuilt = plan.moves.filter((m): m is Extract<Move, { kind: 'rearrange' }> => m.kind === 'rearrange');
  if (rebuilt.length) {
    const sources = [...new Set(rebuilt.flatMap((m) => m.sources))];
    steps.push(h('li', {}, `Take apart ${sources.join(', ')} and rebuild the table as:`,
      h('div', { class: 'melds' }, ...rebuilt.map(moveRow))));
  }
  for (const mv of plan.moves) {
    if (mv.kind === 'rearrange') continue;
    if (mv.kind === 'meld') steps.push(h('li', {}, 'Lay ', cardRow(mv.meld.cards), ` as a ${mv.meld.kind}`));
    else steps.push(h('li', {}, mv.end === 'set' ? 'Add ' : 'Lay off ', h('span', { class: 'cards' }, ...mv.cards.map((c) => cardChip(c, 'new'))), ` onto ${mv.target.id} `, h('span', { class: 'cards' }, ...(mv.target.meld.kind === 'run' ? mv.target.meld.cards : sortCards(mv.target.meld.cards)).map((c) => cardChip(c, 'ghost'))), mv.end === 'set' ? '' : ` (${mv.end} end)`));
  }
  if (discard) steps.push(h('li', {}, 'Discard ', cardChip(discard, 'dead')));
  if (!steps.length) steps.push(h('li', {}, 'Nothing to lay.'));
  return h('ol', { class: 'steps' }, ...steps);
}

function currentAnalysis(): Analysis | Error | null {
  if (!state.hand.length) return null;
  try { return analyze(state.hand, state.table, state.rules); } catch (e) { return e as Error; }
}

function resultsPanel(a: Analysis | Error | null): HTMLElement {
  if (a === null) {
    return h('section', { class: 'panel' }, h('h2', {}, 'Analysis'), h('div', { class: 'empty' }, 'Add some cards to your hand — or ', h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); loadExample(); } }, 'load an example'), '.'));
  }
  if (a instanceof Error) {
    return h('section', { class: 'panel' }, h('h2', {}, 'Analysis'), h('div', { class: 'error' }, a.message));
  }

  // Verdict
  let verdict: HTMLElement;
  if (a.goOut.possible && a.goOut.plan) {
    verdict = h('div', { class: 'verdict yes' },
      h('h3', {}, a.goOut.via === 'all' ? 'You can go out — meld everything' : 'You can go out this turn'),
      planSteps(a.goOut.plan, a.goOut.discard));
  } else {
    const bestDiscard = a.discards[0];
    const remaining = bestDiscard ? bestDiscard.plan : a.best;
    verdict = h('div', { class: 'verdict no' },
      h('h3', {}, `Can't go out yet — best leaves ${remaining.deadwoodPoints} pts of deadwood`),
      planSteps(remaining, bestDiscard?.card ?? null),
      remaining.deadwood.length ? h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Still in hand:'), cardRow(remaining.deadwood, 'dead')) : null,
    );
  }

  // Draw evaluation
  let draw: HTMLElement | null = null;
  if (state.discardTop) {
    const withIt = analyze([...state.hand, state.discardTop], state.table, state.rules);
    const after = withIt.discards.find((d) => !sameCard(d.card, state.discardTop!)) ?? withIt.discards[0];
    const now = a.discards[0]?.plan.deadwoodPoints ?? a.best.deadwoodPoints;
    const then = after?.plan.deadwoodPoints ?? withIt.best.deadwoodPoints;
    const goes = withIt.goOut.possible && (withIt.goOut.via === 'all' || !sameCard(withIt.goOut.discard!, state.discardTop));
    draw = h('div', { class: `verdict ${goes || then < now ? 'yes' : 'no'}` },
      h('h3', {}, 'Taking the ', cardChip(state.discardTop), goes ? ' lets you go out' : then < now ? ` improves deadwood to ${then} pts` : then === now ? ' does not help' : ` is worse (${then} pts)`),
      h('div', { class: 'hint' }, `Best deadwood after your discard: ${then} pts with it vs ${now} pts keeping your hand as is (a stock draw is unknown).`),
    );
  }

  // Discard table
  const discards = h('table', { class: 'discards' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Discard'), h('th', {}, 'Deadwood left'), h('th', { class: 'num' }, 'Pts'))),
    h('tbody', {}, ...a.discards.map((d, i) => h('tr', { class: i === 0 ? 'best' : '' },
      h('td', {}, cardChip(d.card)),
      h('td', {}, d.plan.deadwood.length ? cardRow(d.plan.deadwood, 'dead') : h('span', { class: 'hint' }, 'none — goes out')),
      h('td', { class: 'num' }, String(d.plan.deadwoodPoints)),
    ))),
  );

  const meldList = a.melds.length
    ? h('div', { class: 'melds' }, ...a.melds.map((m) => meldRow(m, 'lay')))
    : h('div', { class: 'empty' }, 'No complete sets or runs in hand.');
  const layoffList = a.layoffs.length
    ? h('div', { class: 'melds' }, ...a.layoffs.map(moveRow))
    : h('div', { class: 'empty' }, state.table.length ? 'Nothing in hand fits a table meld.' : 'No melds on the table to lay off onto.');

  return h('section', { class: 'panel' },
    h('h2', {}, 'Analysis ', h('small', {}, `${a.hand.length + 1} integer programs in ${a.solveMs.toFixed(1)} ms`)),
    verdict,
    draw,
    h('details', { open: true }, h('summary', {}, 'Discard options ', h('small', {}, 'best first')), discards),
    h('details', { open: true }, h('summary', {}, 'Legal melds from hand ', h('small', {}, `${a.melds.length} — every set and run you could lay, including overlapping ones`)), meldList),
    h('details', { open: true }, h('summary', {}, 'Legal lay-offs ', h('small', {}, `${a.layoffs.length} — highlighted cards would be added${state.rules.rearrangeTable ? '; rearrangements are in the plan above' : ''}`)), layoffList),
    h('div', { class: 'stat' }, `Model: one binary per candidate meld and per lay-off card, one "used at most once" constraint per hand card; objective maximises melded points. Solved with YALPS, a pure-JS branch-and-cut simplex.`),
  );
}


// --- The explainer: the integer program, taught from the live hand -------------------

function varLabel(name: string): string {
  return name.replace(/^l(\d+)_(\d+)$/, 'l$1.$2');
}

function sandboxFor(a: Analysis): Set<string> {
  const key = [state.hand.map(cardToString).join(','), state.table.map((t) => t.meld.cards.map(cardToString).join(',')).join(';'), JSON.stringify(state.rules)].join('|');
  if (!state.sandbox || state.sandbox.key !== key) state.sandbox = { key, on: new Set(a.best.chosen) };
  return state.sandbox.on;
}

function explainerSection(a: Analysis | Error | null): HTMLElement {
  const sec = (n: number, title: string, ...body: unknown[]) =>
    h('section', { class: 'step' }, h('div', { class: 'step-n' }, String(n)), h('div', { class: 'step-body' }, h('h3', {}, title), ...body));

  if (!a || a instanceof Error) {
    return h('section', { class: 'explainer' },
      h('header', { class: 'ex-head' }, h('h2', {}, 'How the solver thinks'), h('p', {}, 'Add some cards to your hand and this section will write out, step by step, the arithmetic problem the solver builds for it.')));
  }

  const info = a.best.model;
  const vars = info.variables;
  const on = sandboxFor(a);
  const ev = evaluateSetting(info, a.hand, on);
  const optimum = new Set(a.best.chosen);
  const optScore = vars.filter((v) => optimum.has(v.name)).reduce((t, v) => t + v.points, 0);
  const handPts = a.hand.reduce((t, c) => t + cardPoints(c, state.rules), 0);
  const isOpt = ev.feasible && ev.score === optScore;
  const byName = new Map(vars.map((v) => [v.name, v]));

  const flip = (name: string) => { if (on.has(name)) on.delete(name); else on.add(name); render(); };
  const sw = (name: string, opts: { withValue?: boolean } = {}) =>
    h('button', {
      class: `sw ${on.has(name) ? 'on' : ''}`, type: 'button', onclick: () => flip(name),
      title: `${varLabel(name)} is ${on.has(name) ? 1 : 0} — click to flip`,
    }, varLabel(name), opts.withValue ? h('span', { class: 'sw-val' }, on.has(name) ? '= 1' : '= 0') : null);

  const handKeys = new Set(a.hand.map(cardToString));
  const optionRow = (v: VarInfo) => h('div', { class: `opt ${on.has(v.name) ? 'on' : ''}` },
    sw(v.name, { withValue: true }),
    h('span', { class: 'cards' }, ...v.cards.map((c) => cardChip(c, handKeys.has(cardToString(c)) ? '' : 'ghost'))),
    h('span', { class: 'opt-what' }, v.describe.replace(/^lay off \S+ /, 'lay off onto ').replace(/^add \S+ to /, 'add to ').replace(/^lay .* as a (set|run)$/, 'lay as a $1').replace(/^keep .* on the table as a (set|run)$/, 'already on the table, keep as a $1').replace(/^build .* as a (set|run), using (.*) from hand$/, 'rebuild as a $1 with $2 from hand')),
    h('span', { class: 'opt-pts' }, `${v.points} pts`),
  );

  // Step 1 — options
  const meldOpts = vars.filter((v) => 'meld' in v.move);
  const layOpts = vars.filter((v) => !('meld' in v.move));
  const rearr = state.rules.rearrangeTable;
  const tableCount = state.table.reduce((n, t) => n + t.meld.cards.length, 0);
  const step1 = sec(1, 'Write down every option',
    rearr
      ? h('p', {}, 'Pool the cards on the table with the cards in your hand, and list every set or run that could be made from that pool: melds entirely from your hand, melds that are already on the table, and melds that mix the two. Overlapping options are fine, and they are the whole point: a card that fits two options is exactly where a decision has to be made.')
      : h('p', {}, 'Look at your hand and list every complete thing you could do with it: each set or run you could lay, and each single card you could lay off onto a meld already on the table. Overlapping options are fine, and they are the whole point: a card that fits two options is exactly where a decision has to be made.'),
    rearr
      ? h('p', {}, `The pool is ${a.hand.length} hand cards plus ${tableCount} on the table, and it contains `, h('b', {}, `${vars.length} possible melds`), '. There is nothing clever here yet; this is a plain list.')
      : h('p', {}, `Your hand has `, h('b', {}, `${meldOpts.length} melds`), ' you could lay and ', h('b', {}, `${layOpts.length} lay-off cards`), `, ${vars.length} options in all. There is nothing clever here yet; this is a plain list.`),
    vars.length ? null : h('p', { class: 'empty' }, 'Right now there are none, so the whole hand is deadwood and the solver has nothing to decide. Deal a hand with some pairs and sequences to see the rest.'),
  );

  // Step 2 — variables
  const step2 = sec(2, 'Give each option a switch',
    h('p', {}, 'Each option gets a variable that can only be 0 or 1: off or on. Lay that meld, or don\'t. That is all a "binary variable" is. Meld options are named ', h('code', {}, 'm0, m1, …'), rearr ? '.' : [' and lay-off cards ', h('code', {}, 'l1.0, l1.1, …'), ' where the second number is the card\'s place in the chain.']),
    h('p', {}, 'A full setting of the switches is one possible way to play the hand. ', h('b', {}, 'Try it:'), ' click any switch below to flip it. Everything further down recomputes for your setting, including the rules you break.'),
    vars.length ? h('div', { class: 'opts' }, ...vars.map(optionRow)) : null,
    rearr && state.table.length ? h('p', { class: 'hint' }, 'Faded cards are already on the table. The melds that are on the table right now are options too: keeping one is just switching it on.') : null,
    vars.length ? h('div', { class: 'row' },
      h('button', { class: 'small', type: 'button', onclick: () => { on.clear(); render(); } }, 'All off'),
      h('button', { class: 'small', type: 'button', onclick: () => { on.clear(); for (const v of vars) on.add(v.name); render(); } }, 'All on'),
      h('button', { class: 'small', type: 'button', onclick: () => { on.clear(); for (const n of optimum) on.add(n); render(); } }, 'Back to the solver\'s answer'),
      h('span', { class: 'hint' }, `${vars.length} switches means 2^${vars.length} = ${(2 ** vars.length).toLocaleString()} possible settings.`),
    ) : null,
  );

  // Step 3 — objective
  const objTerms = vars.flatMap((v, i) => [i ? ' + ' : '', h('span', { class: 'term' }, `${v.points}×`, sw(v.name))]);
  const step3 = sec(3, 'Score a setting: the objective',
    h('p', {}, 'Multiply each switch by the points of its option and add them up. A switch that is off contributes 0, so the sum is simply the points you have melded. Making this as large as possible is the same as leaving as little deadwood as possible, because every card is either melded or deadwood.', rearr ? ' Only cards from your hand count: cards already on the table are worth 0 in every option, since they were melded before your turn began.' : ''),
    vars.length ? h('div', { class: 'formula' },
      h('div', { class: 'f-line' }, h('span', { class: 'f-kw' }, 'maximise'), h('span', { class: 'f-body' }, ...objTerms)),
      h('div', { class: 'f-line' }, h('span', { class: 'f-kw' }, 'your setting'), h('span', { class: 'f-body' }, vars.filter((v) => on.has(v.name)).map((v) => v.points).join(' + ') || '0', ` = `, h('b', {}, `${ev.score} pts melded`), ` → ${handPts} − ${ev.score} = `, h('b', {}, `${handPts - ev.score} pts of deadwood`))),
    ) : null,
    h('p', { class: 'hint' }, 'The objective alone is useless: switching everything on gives the biggest number. What makes it a real problem is the rules that follow.'),
  );

  // Step 4 — constraints
  const lhsText = (k: (typeof ev.checks)[number]) => {
    const parts = k.constraint.terms.map(([n, c]) => `${c < 0 ? '−' : ''}${on.has(n) ? 1 : 0}`);
    return parts.length ? parts.join(' + ').replace(/\+ −/g, '− ') : '0';
  };
  const conRow = (k: (typeof ev.checks)[number]) => {
    const kk = k.constraint;
    const card = kk.kind === 'card' || kk.kind === 'table' ? parseCard(kk.label.split(' ')[0]!) : null;
    const terms = kk.terms.length ? kk.terms.flatMap(([n, c], i) => [i ? (c < 0 ? ' − ' : ' + ') : (c < 0 ? '−' : ''), sw(n)]) : ['0'];
    return h('div', { class: `con ${k.ok ? 'ok' : 'bad'}` },
      h('span', { class: 'con-who' }, card ? cardChip(card) : kk.kind === 'chain' ? 'order' : 'room'),
      h('span', { class: 'con-eq' }, ...terms, ` ${kk.equal ? '=' : '≤'} ${kk.max}`),
      h('span', { class: 'con-val' }, `${lhsText(k)} = ${k.lhs}`, k.ok ? ' ✓' : k.lhs > kk.max ? ` ✗ over by ${k.lhs - kk.max}` : ` ✗ short by ${kk.max - k.lhs}`),
      h('span', { class: 'con-why' }, kk.terms.length ? kk.label : `${kk.label.split(' ')[0]} fits no option — it can only be deadwood`),
    );
  };
  const cardCons = ev.checks.filter((k) => k.constraint.kind === 'card');
  const tableCons = ev.checks.filter((k) => k.constraint.kind === 'table');
  const chainCons = ev.checks.filter((k) => k.constraint.kind === 'chain');
  const capCons = ev.checks.filter((k) => k.constraint.kind === 'capacity');
  const step4 = sec(4, 'Forbid the impossible: the constraints',
    h('p', {}, 'A constraint is an inequality the switches must satisfy. Each one encodes a rule of the game as arithmetic. The solver never "understands" rummy; it only knows these lines.'),
    h('h4', {}, 'Each card can be used once'),
    h('p', {}, 'For every card in your hand, add up the switches of the options that use it. That sum may be at most 1. If a card sits in two options, this line is what stops you laying it twice. Cards that appear in only one option, or none, get a trivial line, but the solver writes them all the same.'),
    h('div', { class: 'cons' }, ...cardCons.map(conRow)),
    tableCons.length ? h('h4', {}, 'The table must stay legal') : null,
    tableCons.length ? h('p', {}, 'Every card that was already on the table must end up in exactly one chosen meld: not zero, or you would have pocketed a card from the table, and not two. Note the "=" instead of "≤". This one line is what lets the solver take a run apart and reuse its cards, because any rearrangement that leaves every table card in some valid meld is allowed.') : null,
    tableCons.length ? h('div', { class: 'cons' }, ...tableCons.map(conRow)) : null,
    chainCons.length ? h('h4', {}, 'A run grows outward in order') : null,
    chainCons.length ? h('p', {}, 'You can only lay the second card of an extension if the first is laid too. "Second minus first is at most 0" says exactly that: the only forbidden combination is second on, first off, which would make the left side 1.') : null,
    chainCons.length ? h('div', { class: 'cons' }, ...chainCons.map(conRow)) : null,
    capCons.length ? h('h4', {}, 'A set holds at most four') : null,
    capCons.length ? h('p', {}, 'The cards you add to a table set may not exceed the room left in it.') : null,
    capCons.length ? h('div', { class: 'cons' }, ...capCons.map(conRow)) : null,
    h('div', { class: `verdict ${ev.feasible ? 'yes' : 'no'}` },
      h('h3', {}, ev.feasible ? 'Your setting is legal' : `Your setting breaks ${ev.checks.filter((k) => !k.ok).length} rule${ev.checks.filter((k) => !k.ok).length === 1 ? '' : 's'}`),
      h('div', { class: 'hint' }, ev.feasible
        ? `It melds ${ev.score} pts. The best legal setting melds ${optScore}.${isOpt ? ' That is the optimum — you found it.' : ` You are ${optScore - ev.score} short.`}`
        : 'A setting that breaks a rule is not a way to play the hand at all, whatever it scores. Only settings that pass every line count.'),
    ),
    h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Your hand under this setting:'),
      h('span', { class: 'cards' }, ...sortCards(a.hand).map((c) => { const u = ev.usage.get(cardToString(c)) ?? 0; return cardChip(c, u === 0 ? 'dead' : u === 1 ? 'new' : 'clash'); })),
      h('span', { class: 'hint' }, 'solid = melded, dashed = deadwood, red ring = used twice')),
  );

  // Step 5 — solving
  const relax = solveRelaxed(info);
  const frac = relax.fractional;
  const step5 = sec(5, 'Find the best legal setting',
    h('p', {}, `That is the whole problem: ${vars.length} switches, ${info.constraints.length} rules, one score to maximise. Because the score and every rule are sums of "number × switch" with no products or anything fancier, it is a `, h('b', {}, 'linear'), ' program; because the switches must be whole numbers, it is an ', h('b', {}, 'integer'), ' linear program. This shape is so common that general-purpose solvers exist for it, and they do not care that the numbers came from a card game.'),
    h('p', {}, 'The solver here works in two moves. First it pretends the switches may be fractions, any value from 0 to 1. That relaxed problem has no combinatorial explosion at all: the simplex method walks straight to its best answer. Then, if that answer uses fractions, it picks one fractional switch and tries both possibilities, 0 and 1, solving the relaxed problem again for each. Any branch whose relaxed score cannot beat the best whole-number setting found so far is thrown away unsolved. That pruning is why it never visits anything like all 2^n settings.'),
    h('div', { class: 'formula' },
      h('div', { class: 'f-line' }, h('span', { class: 'f-kw' }, 'fractions allowed'), h('span', { class: 'f-body' }, `best score ${Number.isInteger(relax.value) ? relax.value : relax.value.toFixed(2)} pts`, frac.length ? h('span', { class: 'hint' }, ` — with ${frac.map(([n, x]) => `${varLabel(n)} = ${x.toFixed(2)}`).join(', ')}, so it has to branch`) : h('span', { class: 'hint' }, ' — already whole numbers, so no branching was needed'))),
      h('div', { class: 'f-line' }, h('span', { class: 'f-kw' }, 'whole numbers'), h('span', { class: 'f-body' }, `best score `, h('b', {}, `${optScore} pts`), ` → ${a.best.deadwoodPoints} pts of deadwood, with `, h('span', { class: 'cards' }, ...[...optimum].map((n) => byName.get(n)!).map((v) => h('span', { class: 'sw on static' }, varLabel(v.name)))), optimum.size ? '' : 'nothing switched on')),
    ),
    h('p', {}, 'The page runs this once for your whole hand, and once more for each card you might discard. That is what "', h(`b`, {}, `${a.hand.length + 1} integer programs`), '" in the analysis heading means.'),
  );

  return h('section', { class: 'explainer' },
    h('header', { class: 'ex-head' },
      h('h2', {}, 'How the solver thinks'),
      h('p', {}, 'The solver never searches through arrangements of your hand. It translates the question "what is the best thing I can do with these cards?" into a small arithmetic puzzle and hands that to a general-purpose optimiser. Here is the translation, for the exact hand above.'),
    ),
    step1, step2, step3, step4, step5,
  );
}

function render(): void {
  writeHash();
  const a = currentAnalysis();
  root.replaceChildren(
    h('header', { class: 'rm-head' },
      h('h1', {}, 'Rummy solver'),
      h('p', {}, 'Set up your hand and the melds on the table; the solver lists every legal meld and lay-off, finds the minimum-deadwood arrangement, and tells you whether you can go out.'),
      h('a', { href: '/' }, '← Carcassonne'),
    ),
    h('div', { class: 'rm-grid' },
      h('div', { style: 'display:flex;flex-direction:column;gap:1.2rem' }, handPanel(), tablePanel()),
      resultsPanel(a),
    ),
    explainerSection(a),
  );
}

readHash();
if (!state.hand.length && !state.table.length && !location.hash) loadExample();
else render();
