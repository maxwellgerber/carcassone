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
import { type Analysis, type Move, type Plan, type TableMeld, MAX_HAND, analyze, solveHand } from './solver.js';

interface State {
  hand: Card[];
  table: TableMeld[];
  /** Top of the discard pile, if the user wants to evaluate taking it. */
  discardTop: Card | null;
  /** Cards picked in the table grid but not yet added as a meld. */
  pending: Card[];
  rules: Rules;
}

const state: State = { hand: [], table: [], discardTop: null, pending: [], rules: { ...DEFAULT_RULES } };
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
  if (o.length) p.set('o', o.join(','));
  history.replaceState(null, '', p.size ? '#' + p.toString() : location.pathname);
}

function readHash(): void {
  const p = new URLSearchParams(location.hash.slice(1));
  const o = new Set((p.get('o') ?? '').split(',').filter(Boolean));
  state.rules = { ...DEFAULT_RULES, aceLow: !o.has('nolow'), aceHigh: o.has('high'), discardToGoOut: !o.has('nodiscard') };
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

  const rule = (key: 'aceLow' | 'aceHigh' | 'discardToGoOut', label: string) =>
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
    h('div', { class: 'row' }, rule('aceLow', 'Ace low (A-2-3)'), rule('aceHigh', 'Ace high (Q-K-A)'), rule('discardToGoOut', 'Must discard to go out')),
    err,
  );
}

/** Rule changes can invalidate a table meld (e.g. Q-K-A after turning ace-high off). */
function revalidateTable(): void {
  state.table = state.table.filter((t) => asMeld(t.meld.cards, state.rules));
}

function planSteps(plan: Plan, discard: Card | null): HTMLElement {
  const steps: HTMLElement[] = [];
  for (const mv of plan.moves) {
    if (mv.kind === 'meld') steps.push(h('li', {}, 'Lay ', cardRow(mv.meld.cards), ` as a ${mv.meld.kind}`));
    else steps.push(h('li', {}, mv.end === 'set' ? 'Add ' : 'Lay off ', h('span', { class: 'cards' }, ...mv.cards.map((c) => cardChip(c, 'new'))), ` onto ${mv.target.id} `, h('span', { class: 'cards' }, ...(mv.target.meld.kind === 'run' ? mv.target.meld.cards : sortCards(mv.target.meld.cards)).map((c) => cardChip(c, 'ghost'))), mv.end === 'set' ? '' : ` (${mv.end} end)`));
  }
  if (discard) steps.push(h('li', {}, 'Discard ', cardChip(discard, 'dead')));
  if (!steps.length) steps.push(h('li', {}, 'Nothing to lay.'));
  return h('ol', { class: 'steps' }, ...steps);
}

/** Render the integer program behind a plan: objective, constraints, and the solution. */
function equationsView(plan: Plan): HTMLElement {
  const { variables, constraints } = plan.model;
  const chosen = new Set(plan.chosen);
  const sub = (name: string) => name.replace(/^m(\d+)$/, 'm$1').replace(/^l(\d+)_(\d+)$/, 'l$1.$2');
  const v = (name: string) => h('span', { class: `var ${chosen.has(name) ? 'one' : ''}`, title: chosen.has(name) ? '= 1 in the optimal solution' : '= 0 in the optimal solution' }, sub(name));
  const term = (name: string, coeff: number, first: boolean) => {
    const parts: unknown[] = [];
    if (coeff < 0) parts.push(first ? '−' : ' − ');
    else if (!first) parts.push(' + ');
    if (Math.abs(coeff) !== 1) parts.push(`${Math.abs(coeff)}·`);
    parts.push(v(name));
    return parts;
  };

  const objective = h('div', { class: 'eq' },
    h('span', { class: 'eq-kw' }, 'maximise'),
    h('span', { class: 'eq-body' }, ...variables.flatMap((x, i) => term(x.name, x.points, i === 0))),
  );
  const rows = constraints.map((k) => h('div', { class: `eq ${k.kind}` },
    h('span', { class: 'eq-label' }, k.kind === 'card' ? cardChip(k.terms.length ? parseCard(k.label.split(' ')[0]!)! : { rank: 1, suit: 'S' }) : k.kind === 'chain' ? 'chain' : 'set'),
    h('span', { class: 'eq-body' }, ...(k.terms.length ? k.terms.flatMap(([name, coeff], i) => term(name, coeff, i === 0)) : ['0']), ` ≤ ${k.max}`),
    h('span', { class: 'eq-why' }, k.terms.length ? k.label : `${k.label.split(' ')[0]} fits nothing — deadwood`),
  ));
  const legend = h('div', { class: 'legend' }, ...variables.map((x) => h('div', { class: `legend-row ${chosen.has(x.name) ? 'one' : ''}` },
    v(x.name), h('span', { class: 'eq-body' }, `= 1 if you ${x.describe}`), h('span', { class: 'eq-why' }, `${x.points} pts`))));
  const value = variables.filter((x) => chosen.has(x.name)).reduce((t, x) => t + x.points, 0);

  return h('details', { open: true, class: 'equations' },
    h('summary', {}, 'The integer program ', h('small', {}, `${variables.length} binary variables, ${constraints.length} constraints — highlighted variables are 1 in the optimum`)),
    h('p', { class: 'hint' }, 'Every way to use a card from your hand is a yes/no variable. The objective counts the points those choices meld; the constraints say each card can only be used once, a run can only grow outward one card at a time, and a set can hold at most four. Maximising melded points is the same as minimising deadwood.'),
    objective,
    h('div', { class: 'eq-st' }, 'subject to'),
    ...rows,
    h('div', { class: 'eq' }, h('span', { class: 'eq-label' }), h('span', { class: 'eq-body' }, 'every variable ∈ {0, 1}')),
    h('div', { class: 'eq-st' }, `optimum: ${value} pts melded → ${plan.deadwoodPoints} pts of deadwood`),
    legend,
  );
}

function resultsPanel(): HTMLElement {
  if (!state.hand.length) {
    return h('section', { class: 'panel' }, h('h2', {}, 'Analysis'), h('div', { class: 'empty' }, 'Add some cards to your hand — or ', h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); loadExample(); } }, 'load an example'), '.'));
  }
  let a: Analysis;
  try {
    a = analyze(state.hand, state.table, state.rules);
  } catch (e) {
    return h('section', { class: 'panel' }, h('h2', {}, 'Analysis'), h('div', { class: 'error' }, (e as Error).message));
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

  const eq = equationsView(a.best);

  return h('section', { class: 'panel' },
    h('h2', {}, 'Analysis ', h('small', {}, `${a.hand.length + 1} integer programs in ${a.solveMs.toFixed(1)} ms`)),
    verdict,
    draw,
    h('details', { open: true }, h('summary', {}, 'Discard options ', h('small', {}, 'best first')), discards),
    h('details', { open: true }, h('summary', {}, 'Legal melds from hand ', h('small', {}, `${a.melds.length} — every set and run you could lay, including overlapping ones`)), meldList),
    h('details', { open: true }, h('summary', {}, 'Legal lay-offs ', h('small', {}, `${a.layoffs.length} — highlighted cards would be added`)), layoffList),
    eq,
    h('div', { class: 'stat' }, `Model: one binary per candidate meld and per lay-off card, one "used at most once" constraint per hand card; objective maximises melded points. Solved with YALPS, a pure-JS branch-and-cut simplex.`),
  );
}

function render(): void {
  writeHash();
  root.replaceChildren(
    h('header', { class: 'rm-head' },
      h('h1', {}, 'Rummy solver'),
      h('p', {}, 'Set up your hand and the melds on the table; the solver lists every legal meld and lay-off, finds the minimum-deadwood arrangement, and tells you whether you can go out.'),
      h('a', { href: '/' }, '← Carcassonne'),
    ),
    h('div', { class: 'rm-grid' },
      h('div', { style: 'display:flex;flex-direction:column;gap:1.2rem' }, handPanel(), tablePanel()),
      resultsPanel(),
    ),
  );
}

readHash();
if (!state.hand.length && !state.table.length && !location.hash) loadExample();
else render();
