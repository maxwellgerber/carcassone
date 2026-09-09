/** Bananagrams tiles: the real 144-tile distribution, hands, and letter counting. */

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

/** Tiles per letter in a standard Bananagrams set (144 total). */
export const DISTRIBUTION: Record<string, number> = {
  a: 13, b: 3, c: 3, d: 6, e: 18, f: 3, g: 4, h: 3, i: 12, j: 2, k: 2, l: 5, m: 3,
  n: 8, o: 11, p: 3, q: 2, r: 9, s: 6, t: 9, u: 6, v: 3, w: 3, x: 2, y: 3, z: 2,
};

export type Counts = Map<string, number>;

export function countLetters(word: string): Counts {
  const m: Counts = new Map();
  for (const ch of word) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

export function totalOf(c: Counts): number {
  let t = 0;
  for (const n of c.values()) t += n;
  return t;
}

/** Parse a hand like "aeiln rtsq" (spaces ignored). Throws on non-letters. */
export function parseHand(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z]/g, '');
  const bad = text.toLowerCase().replace(/[a-z\s,]/g, '');
  if (bad) throw new Error(`Only letters are tiles; "${bad[0]}" is not one.`);
  return s.split('').sort().join('');
}

/** Deal `n` tiles from a fresh 144-tile pouch. */
export function dealHand(n: number, rng: () => number = Math.random): string {
  const pouch: string[] = [];
  for (const [ch, k] of Object.entries(DISTRIBUTION)) for (let i = 0; i < k; i++) pouch.push(ch);
  for (let i = pouch.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pouch[i], pouch[j]] = [pouch[j]!, pouch[i]!];
  }
  return pouch.slice(0, n).sort().join('');
}

/** True if `word` can be spelled from `tiles` (as counts). */
export function fitsIn(word: string, tiles: Counts): boolean {
  const need = countLetters(word);
  for (const [ch, n] of need) if ((tiles.get(ch) ?? 0) < n) return false;
  return true;
}
