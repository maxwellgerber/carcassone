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
  cardToString,
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
  /** The integer program that was solved. */
  readonly model: ModelInfo;
  /** Names of the variables set to 1 in the optimal solution. */
  readonly chosen: readonly string[];
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

/** One decision variable of the integer program, with what it means. */
export interface VarInfo {
  readonly name: string;
  /** Objective coefficient: points melded if this variable is 1. */
  readonly points: number;
  readonly cards: readonly Card[];
  /** e.g. "lay 9H 9D 9C as a set" or "lay off 8H onto T1 (high end)". */
  readonly describe: string;
  readonly move: { meld: Meld } | { layoff: number; j: number };
}

/** One constraint of the integer program: sum(coeff × var) ≤ max. */
export interface ConstraintInfo {
  readonly name: string;
  readonly kind: 'card' | 'chain' | 'capacity';
  readonly label: string;
  readonly terms: readonly (readonly [string, number])[];
  readonly max: number;
}

export interface ModelInfo {
  readonly variables: readonly VarInfo[];
  readonly constraints: readonly ConstraintInfo[];
  readonly melds: readonly Meld[];
  readonly layoffs: readonly Move[];
}

/**
 * Build the integer program for `hand` against `table`.
 *
 *   maximise   Σ points(v) · v            over every candidate meld / lay-off card v
 *   subject to Σ_{v ∋ c} v ≤ 1            for every card c in hand   (used at most once)
 *              l_j − l_{j−1} ≤ 0          for lay-off chains          (extend a run outward in order)
 *              Σ_{v adds to set t} v ≤ 4 − |t|                        (a set holds at most maxSetSize)
 *              v ∈ {0, 1}
 */
export function buildModel(hand: readonly Card[], table: readonly TableMeld[] = [], rules: Rules = DEFAULT_RULES): ModelInfo {
  const melds = enumerateMelds(hand, rules);
  const layoffs = enumerateLayoffs(hand, table, rules);
  const variables: VarInfo[] = [];
  const cardTerms = new Map<string, [string, number][]>();
  for (const c of hand) cardTerms.set(cardKey(c), []);
  const chains: ConstraintInfo[] = [];
  const caps = new Map<string, { label: string; terms: [string, number][]; max: number }>();

  melds.forEach((m, i) => {
    const name = `m${i}`;
    variables.push({ name, points: pointsOf(m.cards, rules), cards: m.cards, describe: `lay ${m.cards.map(cardToString).join(' ')} as a ${m.kind}`, move: { meld: m } });
    for (const c of m.cards) cardTerms.get(cardKey(c))!.push([name, 1]);
  });
  layoffs.forEach((lo, i) => {
    if (lo.kind !== 'layoff') return;
    lo.cards.forEach((c, j) => {
      const name = `l${i}_${j}`;
      const where = lo.end === 'set' ? `add ${cardToString(c)} to ${lo.target.id}` : `lay off ${cardToString(c)} onto ${lo.target.id} (${lo.end} end)`;
      variables.push({ name, points: cardPoints(c, rules), cards: [c], describe: where, move: { layoff: i, j } });
      cardTerms.get(cardKey(c))!.push([name, 1]);
      if (lo.end === 'set') {
        const cap = caps.get(lo.target.id) ?? { label: `${lo.target.id} can take at most ${rules.maxSetSize - lo.target.meld.cards.length} more`, terms: [], max: rules.maxSetSize - lo.target.meld.cards.length };
        cap.terms.push([name, 1]);
        caps.set(lo.target.id, cap);
      }
      if (j > 0) {
        chains.push({ name: `chain:${i}:${j}`, kind: 'chain', label: `${cardToString(c)} only after ${cardToString(lo.cards[j - 1]!)} on ${lo.target.id}`, terms: [[name, 1], [`l${i}_${j - 1}`, -1]], max: 0 });
      }
    });
  });

  const constraints: ConstraintInfo[] = [];
  for (const c of hand) constraints.push({ name: 'c:' + cardKey(c), kind: 'card', label: `${cardToString(c)} used at most once`, terms: cardTerms.get(cardKey(c))!, max: 1 });
  constraints.push(...chains);
  for (const [id, cap] of caps) constraints.push({ name: `cap:${id}`, kind: 'capacity', label: cap.label, terms: cap.terms, max: cap.max });
  return { variables, constraints, melds, layoffs };
}

/**
 * Find the minimum-deadwood arrangement of `hand` given `table` by solving the
 * integer program from `buildModel`.
 */
export function solveHand(hand: readonly Card[], table: readonly TableMeld[] = [], rules: Rules = DEFAULT_RULES): Plan {
  const info = buildModel(hand, table, rules);
  if (hand.length === 0 || info.variables.length === 0) {
    return { moves: [], melded: [], deadwood: [...hand], deadwoodPoints: pointsOf(hand, rules), status: 'optimal', model: info, chosen: [] };
  }

  const variables = new Map<string, [string, number][]>();
  for (const v of info.variables) variables.set(v.name, [['obj', v.points]]);
  const constraints = new Map<string, { max: number }>();
  for (const k of info.constraints) {
    constraints.set(k.name, { max: k.max });
    for (const [vname, coeff] of k.terms) variables.get(vname)!.push([k.name, coeff]);
  }
  const model: Model = { direction: 'maximize', objective: 'obj', constraints, variables, binaries: true };
  const sol = solve(model);

  const moves: Move[] = [];
  const melded: Card[] = [];
  const chosen: string[] = [];
  if (sol.status === 'optimal' || sol.status === 'timedout') {
    const byName = new Map(info.variables.map((v) => [v.name, v]));
    const chosenChain = new Map<number, Card[]>(); // layoff index -> cards chosen from its chain
    for (const [name, value] of sol.variables) {
      if (value < 0.5) continue;
      const v = byName.get(name);
      if (!v) continue;
      chosen.push(name);
      if ('meld' in v.move) moves.push({ kind: 'meld', meld: v.move.meld });
      else {
        const arr = chosenChain.get(v.move.layoff) ?? [];
        arr[v.move.j] = v.cards[0]!;
        chosenChain.set(v.move.layoff, arr);
      }
    }
    for (const [i, cards] of chosenChain) {
      const lo = info.layoffs[i]!;
      if (lo.kind !== 'layoff') continue;
      moves.push({ kind: 'layoff', target: lo.target, end: lo.end, cards: cards.filter((c): c is Card => !!c) });
    }
    for (const mv of moves) melded.push(...(mv.kind === 'meld' ? mv.meld.cards : mv.cards));
  }
  const deadwood = withoutCards(hand, melded);
  return { moves, melded, deadwood, deadwoodPoints: pointsOf(deadwood, rules), status: sol.status, model: info, chosen };
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
  const best = solveHand(hand, table, rules);
  const { melds, layoffs } = best.model;

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

// --- Teaching helpers: evaluate a hand-picked setting, and the LP relaxation ---------

export interface ConstraintCheck {
  readonly constraint: ConstraintInfo;
  /** Left-hand side under the setting. */
  readonly lhs: number;
  readonly ok: boolean;
}

export interface SettingEval {
  readonly score: number;
  readonly checks: readonly ConstraintCheck[];
  readonly feasible: boolean;
  /** How many chosen variables use each hand card (0 = deadwood, 1 = melded, 2+ = conflict). */
  readonly usage: ReadonlyMap<string, number>;
}

/** Score and check an arbitrary on/off setting of the variables, without solving anything. */
export function evaluateSetting(info: ModelInfo, hand: readonly Card[], on: ReadonlySet<string>): SettingEval {
  let score = 0;
  const usage = new Map<string, number>();
  for (const c of hand) usage.set(cardKey(c), 0);
  for (const v of info.variables) {
    if (!on.has(v.name)) continue;
    score += v.points;
    for (const c of v.cards) usage.set(cardKey(c), (usage.get(cardKey(c)) ?? 0) + 1);
  }
  const checks = info.constraints.map((k) => {
    const lhs = k.terms.reduce((t, [name, coeff]) => t + (on.has(name) ? coeff : 0), 0);
    return { constraint: k, lhs, ok: lhs <= k.max };
  });
  return { score, checks, feasible: checks.every((c) => c.ok), usage };
}

export interface Relaxation {
  readonly value: number;
  /** Variables with a non-integer value in the relaxed optimum. */
  readonly fractional: readonly (readonly [string, number])[];
}

/**
 * Solve the same model with the "whole numbers only" rule dropped, so each
 * variable may take any value between 0 and 1. This is the linear relaxation a
 * branch-and-bound solver starts from.
 */
export function solveRelaxed(info: ModelInfo): Relaxation {
  if (info.variables.length === 0) return { value: 0, fractional: [] };
  const variables = new Map<string, [string, number][]>();
  const constraints = new Map<string, { max: number }>();
  for (const v of info.variables) {
    variables.set(v.name, [['obj', v.points], [`ub:${v.name}`, 1]]);
    constraints.set(`ub:${v.name}`, { max: 1 });
  }
  for (const k of info.constraints) {
    constraints.set(k.name, { max: k.max });
    for (const [vname, coeff] of k.terms) variables.get(vname)!.push([k.name, coeff]);
  }
  const sol = solve({ direction: 'maximize', objective: 'obj', constraints, variables });
  const fractional = sol.variables.filter(([, x]) => x > 1e-6 && x < 1 - 1e-6).map(([n, x]) => [n, x] as const);
  return { value: Number.isFinite(sol.result) ? sol.result : 0, fractional };
}
