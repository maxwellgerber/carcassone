/**
 * Meld validation and enumeration.
 *
 * A meld is either a *set* (3–4 cards of one rank) or a *run* (3+ consecutive
 * cards of one suit). Runs are stored in ascending order of their *position*
 * on the suit line, which is the rank except that an ace may sit at position 14
 * when `aceHigh` is on. Position 1 (ace low) and 14 (ace high) never share a
 * run, since that would need all 13 ranks in between plus both.
 */

import { type Card, type Rules, type Suit, DEFAULT_RULES, cardKey, cardToString, pointsOf } from './cards.js';

export interface SetMeld {
  readonly kind: 'set';
  readonly cards: readonly Card[];
}

export interface RunMeld {
  readonly kind: 'run';
  readonly suit: Suit;
  /** Ascending. `cards[i]` sits at position `low + i`. */
  readonly cards: readonly Card[];
  /** Position of the first card (1..14). */
  readonly low: number;
  /** Position of the last card (1..14). */
  readonly high: number;
}

export type Meld = SetMeld | RunMeld;

/** Rank at a suit-line position; position 14 is the ace. */
export function rankAtPosition(pos: number): Card['rank'] {
  return (pos === 14 ? 1 : pos) as Card['rank'];
}

/** Which positions a card may occupy under the rules (an ace may have two). */
export function positionsOf(c: Card, rules: Rules): number[] {
  if (c.rank !== 1) return [c.rank];
  const p: number[] = [];
  if (rules.aceLow) p.push(1);
  if (rules.aceHigh) p.push(14);
  return p;
}

export function meldKey(m: Meld): string {
  return (m.kind === 'set' ? 'set:' : `run:`) + m.cards.map(cardKey).join(',');
}

export function meldToString(m: Meld): string {
  return m.cards.map(cardToString).join(' ');
}

export function meldPoints(m: Meld, rules: Rules = DEFAULT_RULES): number {
  return pointsOf(m.cards, rules);
}

/**
 * Validate a group of cards as a meld. Returns the normalised meld (runs sorted)
 * or null. Cards may be given in any order.
 */
export function asMeld(cards: readonly Card[], rules: Rules = DEFAULT_RULES): Meld | null {
  if (cards.length < 3) return null;
  const keys = new Set(cards.map(cardKey));
  if (keys.size !== cards.length) return null;

  if (cards.every((c) => c.rank === cards[0]!.rank)) {
    if (cards.length > rules.maxSetSize) return null;
    return { kind: 'set', cards: [...cards] };
  }

  if (!cards.every((c) => c.suit === cards[0]!.suit)) return null;
  const suit = cards[0]!.suit;
  // An ace may be low or high; try each assignment that the rules allow.
  const ace = cards.find((c) => c.rank === 1);
  const candidates = ace ? positionsOf(ace, rules) : [0];
  for (const acePos of candidates) {
    const positioned = cards.map((c) => ({ c, pos: c.rank === 1 ? acePos : c.rank })).sort((a, b) => a.pos - b.pos);
    let ok = true;
    for (let i = 1; i < positioned.length; i++) {
      if (positioned[i]!.pos !== positioned[i - 1]!.pos + 1) { ok = false; break; }
    }
    if (ok) {
      return { kind: 'run', suit, cards: positioned.map((p) => p.c), low: positioned[0]!.pos, high: positioned[positioned.length - 1]!.pos };
    }
  }
  return null;
}

/**
 * Every valid meld that can be formed from `cards` alone: all 3- and 4-card
 * subsets of each rank, and every window of 3+ consecutive positions in each
 * suit. For a 13-card hand this is at most a few dozen melds.
 */
export function enumerateMelds(cards: readonly Card[], rules: Rules = DEFAULT_RULES): Meld[] {
  const out: Meld[] = [];

  // Sets
  const byRank = new Map<number, Card[]>();
  for (const c of cards) {
    const arr = byRank.get(c.rank) ?? [];
    if (!arr.some((x) => x.suit === c.suit)) arr.push(c); // ignore exact duplicates
    byRank.set(c.rank, arr);
  }
  for (const group of byRank.values()) {
    for (const subset of subsets(group, 3, Math.min(rules.maxSetSize, group.length))) {
      out.push({ kind: 'set', cards: subset });
    }
  }

  // Runs: per suit, build a 15-slot line (index = position) then take windows.
  const bySuit = new Map<Suit, (Card | undefined)[]>();
  for (const c of cards) {
    const line = bySuit.get(c.suit) ?? new Array<Card | undefined>(15).fill(undefined);
    for (const pos of positionsOf(c, rules)) line[pos] = c;
    bySuit.set(c.suit, line);
  }
  for (const [suit, line] of bySuit) {
    for (let start = 1; start <= 14; start++) {
      if (!line[start]) continue;
      const run: Card[] = [line[start]!];
      for (let end = start + 1; end <= 14 && line[end]; end++) {
        run.push(line[end]!);
        if (run.length >= 3) out.push({ kind: 'run', suit, cards: [...run], low: start, high: end });
      }
    }
  }
  return out;
}

function subsets<T>(items: readonly T[], minSize: number, maxSize: number): T[][] {
  const out: T[][] = [];
  const n = items.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const size = popcount(mask);
    if (size < minSize || size > maxSize) continue;
    const s: T[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s.push(items[i]!);
    out.push(s);
  }
  return out;
}

function popcount(x: number): number {
  let n = 0;
  while (x) { n += x & 1; x >>= 1; }
  return n;
}
