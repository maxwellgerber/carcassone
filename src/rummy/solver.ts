/**
 * Hand partitioning as an integer program.
 *
 * Given the cards in a player's hand and the melds already on the table, find
 * the arrangement of melds and lay-offs that minimises deadwood points. This is
 * a set-packing problem: one binary variable per candidate meld (or per card
 * laid off onto a table meld), a "used at most once" constraint per card, and
 * an objective that maximises the point value of everything melded. The model
 * for a real hand has a few dozen variables and solves in well under a
 * millisecond with the pure-JS YALPS solver, so it runs happily in the browser.
 *
 * The formulation follows Den Hertog & Hulshof, "Solving Rummikub Problems by
 * Integer Linear Programming" (The Computer Journal, 2006), adapted to a single
 * 52-card deck with lay-offs onto existing melds.
 */

import { solve, type Model, type SolutionStatus } from 'yalps';
import {
  type Card,
  type Rules,
  DEFAULT_RULES,
  cardKey,
  cardPoints,
  pointsOf,
  withoutCards,
} from './cards.js';
import { type Meld, enumerateMelds, positionsOf } from './melds.js';

export interface TableMeld {
  /** Short label used in the UI and in variable names, e.g. `T1`. */
  readonly id: string;
  readonly meld: Meld;
}

/** A single thing a player could do with cards from their hand. */
export type Move =
  | { readonly kind: 'meld'; readonly meld: Meld }
  | {
      readonly kind: 'layoff';
      readonly target: TableMeld;
      /** Which end of a run the cards extend, or `set` for adding to a set. */
      readonly end: 'low' | 'high' | 'set';
      /** In the order they are laid down (outward from the run). */
      readonly cards: readonly Card[];
    };

export interface Plan {
  readonly moves: readonly Move[];
  readonly melded: readonly Card[];
  readonly deadwood: readonly Card[];
  readonly deadwoodPoints: number;
  readonly status: SolutionStatus;
}

/**
 * Every lay-off available from `hand` onto `table`. For runs this is the
 * maximal chain of cards that could be added at each end, in laying order (a
 * later card in the chain can only be played if the earlier ones are). For sets
 * each addable card is its own move.
 */
export function enumerateLayoffs(hand: readonly Card[], table: readonly TableMeld[], rules: Rules = DEFAULT_RULES): Move[] {
  const out: Move[] = [];
  const bySuitPos = new Map<string, Card>();
  for (const c of hand) for (const p of positionsOf(c, rules)) bySuitPos.set(c.suit + p, c);

  for (const t of table) {
    const m = t.meld;
    if (m.kind === 'set') {
      const room = rules.maxSetSize - m.cards.length;
      if (room <= 0) continue;
      const rank = m.cards[0]!.rank;
      for (const c of hand) {
        if (c.rank === rank && !m.cards.some((x) => x.suit === c.suit)) out.push({ kind: 'layoff', target: t, end: 'set', cards: [c] });
      }
    } else {
      const chain = (start: number, step: number): Card[] => {
        const cards: Card[] = [];
        for (let p = start; p >= 1 && p <= 14; p += step) {
          const c = bySuitPos.get(m.suit + p);
          if (!c || cards.some((x) => x === c)) break;
          cards.push(c);
        }
        return cards;
      };
      const low = chain(m.low - 1, -1);
      const high = chain(m.high + 1, +1);
      if (low.length) out.push({ kind: 'layoff', target: t, end: 'low', cards: low });
      if (high.length) out.push({ kind: 'layoff', target: t, end: 'high', cards: high });
    }
  }
  return out;
}

/**
 * Find the minimum-deadwood arrangement of `hand` given `table`.
 *
 * Every candidate meld and lay-off card becomes a binary variable. Constraints:
 * each hand card used at most once; a lay-off card deeper in a run chain needs
 * the card before it; a set cannot grow past `maxSetSize`. Objective: maximise
 * points melded, i.e. minimise deadwood.
 */
export function solveHand(hand: readonly Card[], table: readonly TableMeld[] = [], rules: Rules = DEFAULT_RULES): Plan {
  if (hand.length === 0) return { moves: [], melded: [], deadwood: [], deadwoodPoints: 0, status: 'optimal' };

  const melds = enumerateMelds(hand, rules);
  const layoffs = enumerateLayoffs(hand, table, rules);

  const variables = new Map<string, [string, number][]>();
  const constraints = new Map<string, { max: number }>();
  /** Variable name -> what choosing it means. */
  const decode = new Map<string, { meld: Meld } | { layoff: number; j: number }>();
  for (const c of hand) constraints.set('c:' + cardKey(c), { max: 1 });

  melds.forEach((m, i) => {
    const name = `m${i}`;
    const coeffs: [string, number][] = [['obj', pointsOf(m.cards, rules)]];
    for (const c of m.cards) coeffs.push(['c:' + cardKey(c), 1]);
    variables.set(name, coeffs);
    decode.set(name, { meld: m });
  });

  // Lay-off chains: one variable per card, chained so card j needs card j-1.
  layoffs.forEach((lo, i) => {
    if (lo.kind !== 'layoff') return;
    const capName = `cap:${lo.target.id}`;
    if (lo.end === 'set' && !constraints.has(capName)) constraints.set(capName, { max: rules.maxSetSize - lo.target.meld.cards.length });
    lo.cards.forEach((c, j) => {
      const name = `l${i}_${j}`;
      const coeffs: [string, number][] = [['obj', cardPoints(c, rules)], ['c:' + cardKey(c), 1]];
      if (lo.end === 'set') coeffs.push([capName, 1]);
      if (j > 0) {
        const chainName = `chain:${i}:${j}`;
        constraints.set(chainName, { max: 0 });
        coeffs.push([chainName, 1]);
        variables.get(`l${i}_${j - 1}`)!.push([chainName, -1]);
      }
      variables.set(name, coeffs);
      decode.set(name, { layoff: i, j });
    });
  });

  const model: Model = { direction: 'maximize', objective: 'obj', constraints, variables, binaries: true };
  const sol = solve(model);

  const moves: Move[] = [];
  const melded: Card[] = [];
  if (sol.status === 'optimal' || sol.status === 'timedout') {
    const chosen = new Map<number, Card[]>(); // layoff index -> cards chosen from its chain
    for (const [name, value] of sol.variables) {
      if (value < 0.5) continue;
      const d = decode.get(name);
      if (!d) continue;
      if ('meld' in d) moves.push({ kind: 'meld', meld: d.meld });
      else {
        const lo = layoffs[d.layoff]!;
        if (lo.kind !== 'layoff') continue;
        const arr = chosen.get(d.layoff) ?? [];
        arr[d.j] = lo.cards[d.j]!;
        chosen.set(d.layoff, arr);
      }
    }
    for (const [i, cards] of chosen) {
      const lo = layoffs[i]!;
      if (lo.kind !== 'layoff') continue;
      moves.push({ kind: 'layoff', target: lo.target, end: lo.end, cards: cards.filter((c): c is Card => !!c) });
    }
    for (const mv of moves) melded.push(...(mv.kind === 'meld' ? mv.meld.cards : mv.cards));
  }
  const deadwood = withoutCards(hand, melded);
  return { moves, melded, deadwood, deadwoodPoints: pointsOf(deadwood, rules), status: sol.status };
}

/** Hand-size limit past which we refuse to analyse (keeps the UI honest). */
export const MAX_HAND = 20;

export interface DiscardOption {
  readonly card: Card;
  /** Best arrangement of the rest of the hand once this card is discarded. */
  readonly plan: Plan;
}

export interface GoOut {
  readonly possible: boolean;
  /** `discard`: meld everything but one card, then discard it. `all`: meld the whole hand. */
  readonly via: 'discard' | 'all' | null;
  readonly discard: Card | null;
  readonly plan: Plan | null;
}

export interface Analysis {
  readonly hand: readonly Card[];
  readonly table: readonly TableMeld[];
  readonly rules: Rules;
  /** Every meld that could be laid from the hand right now. */
  readonly melds: readonly Meld[];
  /** Every lay-off available onto the table. */
  readonly layoffs: readonly Move[];
  /** Minimum-deadwood arrangement of the whole hand (before any discard). */
  readonly best: Plan;
  /** For each card: what the hand looks like if that card is discarded. Best first. */
  readonly discards: readonly DiscardOption[];
  readonly goOut: GoOut;
  readonly solveMs: number;
}

/**
 * Full turn analysis: legal melds, legal lay-offs, the optimal arrangement, the
 * best discard, and whether the player can go out this turn.
 */
export function analyze(hand: readonly Card[], table: readonly TableMeld[] = [], rules: Rules = DEFAULT_RULES): Analysis {
  if (hand.length > MAX_HAND) throw new Error(`Hand too large (${hand.length} cards; limit ${MAX_HAND})`);
  const t0 = now();
  const melds = enumerateMelds(hand, rules);
  const layoffs = enumerateLayoffs(hand, table, rules);
  const best = solveHand(hand, table, rules);

  const discards: DiscardOption[] = hand.map((card) => ({ card, plan: solveHand(withoutCards(hand, [card]), table, rules) }));
  discards.sort((a, b) => a.plan.deadwoodPoints - b.plan.deadwoodPoints || a.plan.deadwood.length - b.plan.deadwood.length);

  let goOut: GoOut = { possible: false, via: null, discard: null, plan: null };
  const viaDiscard = discards.find((d) => d.plan.deadwood.length === 0);
  if (!rules.discardToGoOut && best.deadwood.length === 0) goOut = { possible: true, via: 'all', discard: null, plan: best };
  else if (viaDiscard) goOut = { possible: true, via: 'discard', discard: viaDiscard.card, plan: viaDiscard.plan };

  return { hand, table, rules, melds, layoffs, best, discards, goOut, solveMs: now() - t0 };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
