/**
 * Tests for the rummy hand solver. Hand-picked cases first, then a randomised
 * comparison of the integer-programming solver against an independent
 * brute-force search (which is exponential, but fine at ≤10 cards).
 */
import {
  type Card,
  type Rules,
  DEFAULT_RULES,
  cardToString,
  cardsToString,
  fullDeck,
  parseCards,
  pointsOf,
  withoutCards,
  cardPoints,
} from '../src/rummy/cards.js';
import { type Meld, asMeld, enumerateMelds, meldKey, meldToString } from '../src/rummy/melds.js';
import { type TableMeld, analyze, enumerateLayoffs, solveHand } from '../src/rummy/solver.js';

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) pass++;
  else { fail++; console.error('FAIL:', msg); }
}
function eq<T>(a: T, b: T, msg: string): void {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`);
}
function tbl(...melds: string[]): TableMeld[] {
  return melds.map((m, i) => {
    const meld = asMeld(parseCards(m));
    if (!meld) throw new Error(`bad table meld ${m}`);
    return { id: `T${i + 1}`, meld };
  });
}

// --- Parsing ---------------------------------------------------------------
{
  const cs = parseCards('AS 10h Td, KC');
  eq(cardsToString(cs), 'AS 10H 10D KC', 'parse shorthand incl. T and lowercase');
  let threw = false;
  try { parseCards('AS 1X'); } catch { threw = true; }
  assert(threw, 'bad token throws');
}

// --- Meld validation ---------------------------------------------------------
{
  assert(asMeld(parseCards('7S 7H 7D'))?.kind === 'set', '3-card set');
  assert(asMeld(parseCards('7S 7H 7D 7C'))?.kind === 'set', '4-card set');
  assert(asMeld(parseCards('7S 7H')) === null, '2 cards is not a meld');
  assert(asMeld(parseCards('7S 7H 8D')) === null, 'mixed ranks/suits is not a meld');
  const run = asMeld(parseCards('7H 5H 6H'));
  assert(run?.kind === 'run' && meldToString(run) === '5H 6H 7H', 'run is normalised ascending');
  assert(asMeld(parseCards('AH 2H 3H'))?.kind === 'run', 'ace-low run by default');
  assert(asMeld(parseCards('QH KH AH')) === null, 'ace-high run rejected by default');
  const hi: Rules = { ...DEFAULT_RULES, aceHigh: true };
  const qka = asMeld(parseCards('QH KH AH'), hi);
  assert(qka?.kind === 'run' && qka.high === 14, 'ace-high run allowed when enabled');
  assert(asMeld(parseCards('KH AH 2H'), { ...hi, aceLow: true }) === null, 'no wrap-around K-A-2');
}

// --- Enumeration ---------------------------------------------------------------
{
  const hand = parseCards('5H 6H 7H 8H 7S 7D 7C');
  const melds = enumerateMelds(hand);
  const keys = melds.map(meldKey);
  eq(new Set(keys).size, keys.length, 'no duplicate melds enumerated');
  for (const m of melds) assert(asMeld(m.cards) !== null, `enumerated meld valid: ${meldToString(m)}`);
  const runs = melds.filter((m) => m.kind === 'run').map(meldToString).sort();
  eq(runs.join('|'), '5H 6H 7H|5H 6H 7H 8H|6H 7H 8H', 'all run windows');
  const sets = melds.filter((m) => m.kind === 'set').map(meldToString).sort();
  // 7H 7S 7D 7C: four 3-subsets and one 4-subset
  eq(sets.length, 5, 'set subsets of a 4-of-a-kind');
}

// --- Lay-offs ----------------------------------------------------------------
{
  const table = tbl('5H 6H 7H', 'KS KD KC');
  const lays = enumerateLayoffs(parseCards('4H 3H 8H KH 2S'), table);
  const desc = lays.map((l) => l.kind === 'layoff' && `${l.target.id}:${l.end}:${cardsToString(l.cards)}`).sort();
  eq(desc.join('|'), 'T1:high:8H|T1:low:4H 3H|T2:set:KH', 'lay-off chains in laying order');
  const full = enumerateLayoffs(parseCards('KH'), tbl('KS KD KC KH'));
  eq(full.length, 0, 'no lay-off onto a full set');
}

// --- Solver, hand-picked -------------------------------------------------------
{
  // Contested card: 7H could join the run (melds 18) or the set (melds 21). The set wins.
  const p = solveHand(parseCards('5H 6H 7H 7S 7D 2C'));
  eq(p.status, 'optimal', 'status');
  eq(cardsToString(p.deadwood), '5H 6H 2C', 'set of 7s beats run of 5-6-7');
  eq(p.deadwoodPoints, 13, 'deadwood points');
  eq(p.moves.length, 1, 'only one meld possible (7H is contested)');
}
{
  // 7H must go to the run so that 8H 9H can be melded too.
  const p = solveHand(parseCards('5H 6H 7H 8H 9H 7S 7D'));
  eq(p.deadwoodPoints, 14, 'best is run of five, deadwood 7S 7D');
}
{
  // Split the 4-run into a run of 3 + use the 8H in a set? 5H6H7H8H + 8S8D(deadwood 16) vs 5H6H7H + 8H8S8D (deadwood 0)
  const p = solveHand(parseCards('5H 6H 7H 8H 8S 8D'));
  eq(p.deadwoodPoints, 0, 'prefers two melds over one long run');
}
{
  // Lay-offs beat deadwood. Table run 5H-7H, hand has 8H 9H 4H and junk.
  const p = solveHand(parseCards('8H 9H 4H KS'), tbl('5H 6H 7H'));
  eq(cardsToString(p.deadwood), 'KS', 'chain lay-off both ends');
  const lay = p.moves.filter((m) => m.kind === 'layoff');
  eq(lay.length, 2, 'two lay-off moves (one per end)');
}
{
  // Chain constraint: 9H cannot be laid without 8H.
  const p = solveHand(parseCards('9H KS'), tbl('5H 6H 7H'));
  eq(cardsToString(p.deadwood), '9H KS', '9H is stranded without the 8H');
}
{
  // A card is used once: 8H is both a lay-off and part of a set — solver picks the better.
  const p = solveHand(parseCards('8H 8S 8D'), tbl('5H 6H 7H'));
  eq(p.deadwoodPoints, 0, 'set beats lay-off when it melds more');
  eq(p.moves.length, 1, 'single move');
}
{
  const p = solveHand(parseCards('9C 9S'), tbl('9H 9D 9C'));
  // 9C already on table — duplicate in a single deck; ensure nothing crashes and 9S is laid off
  assert(p.status === 'optimal', 'duplicates do not crash');
}
{
  // Ace high: Q K A run, A must not also count low.
  const rules: Rules = { ...DEFAULT_RULES, aceHigh: true };
  const p = solveHand(parseCards('QS KS AS 2S 3S'), [], rules);
  // Options: Q K A (deadwood 2S 3S = 5) or A 2 3 (deadwood Q K = 20) -> pick first.
  eq(p.deadwoodPoints, 5, 'ace used once, at the better end');
}

// --- Analysis / going out ----------------------------------------------------------
{
  const a = analyze(parseCards('AS 2S 3S 7H 7D 7C KD'));
  assert(a.goOut.possible && a.goOut.via === 'discard' && !!a.goOut.discard && cardToString(a.goOut.discard) === 'KD', 'go out by melding all but the KD');
  eq(a.best.deadwoodPoints, 10, 'best (pre-discard) leaves the KD');
  eq(a.discards[0]!.plan.deadwoodPoints, 0, 'best discard leaves nothing');
}
{
  const a = analyze(parseCards('AS 2S 3S 7H 7D 7C'));
  assert(!a.goOut.possible, 'fully melded hand cannot go out when a discard is required');
  const a2 = analyze(parseCards('AS 2S 3S 7H 7D 7C'), [], { ...DEFAULT_RULES, discardToGoOut: false });
  assert(a2.goOut.possible && a2.goOut.via === 'all', 'without the discard rule the whole hand melds out');
}
{
  // Two cards left; one is a lay-off, so going out is possible by laying off the 9H and discarding the 9C.
  const a = analyze(parseCards('AS 2S 3S 7H 7D 7C 9H 9C'), tbl('5H 6H 7H 8H'));
  assert(a.goOut.possible && !!a.goOut.discard && cardToString(a.goOut.discard) === '9C', 'go out via lay-off plus discard');
}
{
  const a = analyze(parseCards('KS'));
  assert(a.goOut.possible && a.goOut.via === 'discard', 'one card in hand: discard it and go out');
  const e = analyze([]);
  assert(!e.goOut.possible && e.best.deadwoodPoints === 0, 'empty hand is harmless');
}

// --- Randomised comparison with brute force -------------------------------------------
/** Exhaustive state search: max points melded. Independent of the ILP. */
const memo = new Map<string, number>();
function brute(hand: Card[], table: Meld[], rules: Rules): number {
  if (hand.length === 0) return 0;
  const key = hand.map(cardToString).sort().join(',') + '#' + table.map(meldToString).join('|') + '#' + rules.aceHigh;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  for (const m of enumerateMelds(hand, rules)) {
    best = Math.max(best, pointsOf(m.cards, rules) + brute(withoutCards(hand, m.cards), table, rules));
  }
  for (const c of hand) {
    table.forEach((t, i) => {
      let grown: Meld | null = null;
      if (t.kind === 'set') {
        if (t.cards.length < rules.maxSetSize && t.cards[0]!.rank === c.rank && !t.cards.some((x) => x.suit === c.suit)) grown = { kind: 'set', cards: [...t.cards, c] };
      } else if (t.suit === c.suit) {
        const lo = t.low - 1, hi = t.high + 1;
        const pos = c.rank === 1 ? [rules.aceLow ? 1 : 0, rules.aceHigh ? 14 : 0].filter(Boolean) : [c.rank];
        if (pos.includes(lo)) grown = { ...t, cards: [c, ...t.cards], low: lo };
        else if (pos.includes(hi)) grown = { ...t, cards: [...t.cards, c], high: hi };
      }
      if (grown) {
        const nt = table.slice(); nt[i] = grown;
        best = Math.max(best, cardPoints(c, rules) + brute(withoutCards(hand, [c]), nt, rules));
      }
    });
  }
  memo.set(key, best);
  return best;
}

{
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  let mismatches = 0;
  const trials = 400;
  for (let trial = 0; trial < trials; trial++) {
    const rules: Rules = { ...DEFAULT_RULES, aceHigh: rnd() < 0.5, aceLow: true };
    // Bias hands toward interesting structure: draw from a few suits/ranks.
    const deck = shuffle(fullDeck()).filter(() => rnd() < 0.55);
    const handSize = 5 + Math.floor(rnd() * 5);
    const hand = deck.slice(0, handSize);
    const pool = deck.slice(handSize);
    // Table: up to 3 melds carved from the remaining pool.
    const table: TableMeld[] = [];
    const poolMelds = shuffle(enumerateMelds(pool, rules));
    const used = new Set<string>();
    for (const m of poolMelds) {
      if (table.length >= 3) break;
      if (m.cards.some((c) => used.has(cardToString(c)))) continue;
      if (m.kind === 'set' && m.cards.length === 4) continue;
      m.cards.forEach((c) => used.add(cardToString(c)));
      table.push({ id: `T${table.length + 1}`, meld: m });
    }
    const ilp = solveHand(hand, table, rules);
    const expectMelded = brute(hand, table.map((t) => t.meld), rules);
    const gotMelded = pointsOf(hand, rules) - ilp.deadwoodPoints;
    if (ilp.status !== 'optimal' || gotMelded !== expectMelded) {
      mismatches++;
      if (mismatches <= 5) {
        console.error(`MISMATCH hand=[${cardsToString(hand)}] table=[${table.map((t) => meldToString(t.meld)).join(' | ')}] aceHigh=${rules.aceHigh} ilp=${gotMelded} brute=${expectMelded} status=${ilp.status}`);
        console.error('  ilp moves:', ilp.moves.map((m) => m.kind === 'meld' ? meldToString(m.meld) : `${m.target.id}<-${cardsToString(m.cards)}`).join(' ; '));
      }
    }
    // Sanity: the plan is self-consistent.
    assert(ilp.melded.length + ilp.deadwood.length === hand.length, 'melded + deadwood = hand');
    assert(new Set(ilp.melded.map(cardToString)).size === ilp.melded.length, 'no card melded twice');
  }
  eq(mismatches, 0, `ILP matches brute force on ${trials} random hands`);
}

console.log(`rummy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
