/** Word lists and the tile-filtered candidate dictionary. */
import { type Counts, fitsIn } from './tiles.js';

export interface Dictionary {
  readonly name: string;
  readonly words: readonly string[];
  readonly has: (w: string) => boolean;
}

export function makeDictionary(name: string, text: string): Dictionary {
  const words = text.split(/\r?\n/).map((w) => w.trim()).filter((w) => /^[a-z]{2,}$/.test(w));
  const set = new Set(words);
  return { name, words, has: (w) => set.has(w) };
}

/** Words that can be spelled from the hand alone, optionally capped in length. */
export function candidateWords(dict: Dictionary, tiles: Counts, maxLen = Infinity): string[] {
  return dict.words.filter((w) => w.length <= maxLen && fitsIn(w, tiles));
}
