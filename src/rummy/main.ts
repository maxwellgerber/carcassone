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
import { type Analysis, type Move, type Plan, type TableMeld, MAX_HAND, analyze } from './solver.js';

interface State {
  hand: Card[];
  table: TableMeld[];
  /** Top of the discard pile, if the user wants to evaluate taking it. */
  discardTop: Card | null;
  rules: Rules;
}

const state: State = { hand: [], table: [], discardTop: null, rules: { ...DEFAULT_RULES } };
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

function deckPicker(): HTMLElement {
  const grid = h('div', { class: 'deck' });
  for (const suit of SUITS) {
    grid.appendChild(h('div', { class: `suit-label ${suit === 'H' || suit === 'D' ? 'red' : ''}`, title: SUIT_NAMES[suit] }, SUIT_SYMBOLS[suit]));
    for (const rank of RANKS) {
      const c: Card = { rank, suit: suit as Suit };
      const table = onTable(c);
      const cls = ['pick', inHand(c) && 'in-hand', table && 'on-table', state.discardTop && sameCard(c, state.discardTop) && 'is-discard', isRed(c) && 'red'].filter(Boolean).join(' ');
      grid.appendChild(h('button', {
        class: cls,
        type: 'button',
        title: table ? `${cardToString(c)} is on the table (${table.id})` : inHand(c) ? 'Remove from hand' : 'Add to hand',
        onclick: () => toggleHand(c),
      }, rankLabel(rank)));
    }
  }
  return grid;
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
    deckPicker(),
    state.hand.length ? cardRow(state.hand) : h('div', { class: 'empty' }, 'No cards in hand yet.'),
    h('div', { class: 'row' }, typed, h('button', { class: 'small', type: 'button', onclick: apply }, 'Set hand')),
    err,
  );
}

function tablePanel(): HTMLElement {
  const input = h('input', { type: 'text', class: 'wide', placeholder: 'Add a meld on the table: 5H 6H 7H  or  KS KD KC', 'aria-label': 'Meld to add' }) as HTMLInputElement;
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
    : h('div', { class: 'empty' }, 'Nothing on the table. Melds here can be laid off onto.');

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

  return h('section', { class: 'panel' },
    h('h2', {}, 'Analysis ', h('small', {}, `${a.hand.length + 1} integer programs in ${a.solveMs.toFixed(1)} ms`)),
    verdict,
    draw,
    h('details', { open: true }, h('summary', {}, 'Discard options ', h('small', {}, 'best first')), discards),
    h('details', { open: true }, h('summary', {}, 'Legal melds from hand ', h('small', {}, `${a.melds.length} — every set and run you could lay, including overlapping ones`)), meldList),
    h('details', { open: true }, h('summary', {}, 'Legal lay-offs ', h('small', {}, `${a.layoffs.length} — highlighted cards would be added`)), layoffList),
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
