/**
 * Playing-card primitives for the rummy solver. Pure, dependency-free.
 *
 * Cards are written in the usual shorthand: rank then suit, e.g. `AS`, `10H`,
 * `KD`, `7c`. `T` is accepted as an alias for 10.
 */

export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
export const SUIT_NAMES: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
export const SUIT_SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** Ace is 1, Jack 11, Queen 12, King 13. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const RANK_LABELS = ['?', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

export interface Rules {
  /** Allow A-2-3 style runs (ace counts as 1). */
  aceLow: boolean;
  /** Allow Q-K-A style runs (ace counts as 14). */
  aceHigh: boolean;
  /** Deadwood value of an ace. Commonly 1, sometimes 15. */
  acePoints: number;
  /** Deadwood value of J, Q, K. */
  facePoints: number;
  /** Largest set allowed — 4 with a single deck. */
  maxSetSize: number;
  /**
   * Going out requires keeping one card back to discard. When false, melding the
   * whole hand also counts as going out.
   */
  discardToGoOut: boolean;
  /**
   * Melds on the table may be taken apart and rebuilt with cards from your hand,
   * as long as every card that was on the table ends up in a valid meld. When
   * false you may only lay off onto the ends of existing melds.
   */
  rearrangeTable: boolean;
}

export const DEFAULT_RULES: Rules = {
  aceLow: true,
  aceHigh: false,
  acePoints: 1,
  facePoints: 10,
  maxSetSize: 4,
  discardToGoOut: true,
  rearrangeTable: true,
};

export function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

export function rankLabel(rank: Rank): string {
  return RANK_LABELS[rank]!;
}

/** Canonical short form, e.g. `10H`, `AS`. */
export function cardToString(c: Card): string {
  return rankLabel(c.rank) + c.suit;
}

/** Display form with a suit symbol, e.g. `10♥`. */
export function cardToPretty(c: Card): string {
  return rankLabel(c.rank) + SUIT_SYMBOLS[c.suit];
}

export function cardsToString(cards: readonly Card[]): string {
  return cards.map(cardToString).join(' ');
}

/** Stable key for a card, usable in maps/sets and as an ILP constraint name. */
export function cardKey(c: Card): string {
  return cardToString(c);
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

export function cardPoints(c: Card, rules: Rules = DEFAULT_RULES): number {
  if (c.rank === 1) return rules.acePoints;
  if (c.rank >= 11) return rules.facePoints;
  return c.rank;
}

export function pointsOf(cards: readonly Card[], rules: Rules = DEFAULT_RULES): number {
  return cards.reduce((s, c) => s + cardPoints(c, rules), 0);
}

/** Parse one card token. Returns null on anything unrecognised. */
export function parseCard(token: string): Card | null {
  const t = token.trim().toUpperCase().replace(/[♠]/g, 'S').replace(/[♥]/g, 'H').replace(/[♦]/g, 'D').replace(/[♣]/g, 'C');
  const m = /^(A|K|Q|J|T|10|[2-9])([SHDC])$/.exec(t);
  if (!m) return null;
  const r = m[1]!;
  const rank: Rank = r === 'A' ? 1 : r === 'J' ? 11 : r === 'Q' ? 12 : r === 'K' ? 13 : r === 'T' || r === '10' ? 10 : (Number(r) as Rank);
  return { rank, suit: m[2] as Suit };
}

/**
 * Parse a whitespace/comma separated list of cards. Throws on a bad token so the
 * caller can show exactly which one failed.
 */
export function parseCards(text: string): Card[] {
  const out: Card[] = [];
  for (const tok of text.split(/[\s,]+/)) {
    if (!tok) continue;
    const c = parseCard(tok);
    if (!c) throw new Error(`Unrecognised card "${tok}" (expected e.g. AS, 10H, KD)`);
    out.push(c);
  }
  return out;
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

/** Sort by suit then rank — the order a player would fan their hand in. */
export function sortCards(cards: readonly Card[]): Card[] {
  const suitOrder: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3 };
  return [...cards].sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit] || a.rank - b.rank);
}

/** Remove one instance of each card in `remove` from `cards`. */
export function withoutCards(cards: readonly Card[], remove: readonly Card[]): Card[] {
  const left = [...cards];
  for (const r of remove) {
    const i = left.findIndex((c) => sameCard(c, r));
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

/** Throws if any card appears more than once (single-deck rummy). */
export function assertNoDuplicates(cards: readonly Card[], what: string): void {
  const seen = new Set<string>();
  for (const c of cards) {
    const k = cardKey(c);
    if (seen.has(k)) throw new Error(`${what}: ${cardToString(c)} appears more than once`);
    seen.add(k);
  }
}
