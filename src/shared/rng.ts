// One deterministic PRNG shared by the server (event seeds), the client (replays)
// and the scripts, so a recorded seed reproduces exactly the same shuffle anywhere.
// xorshift32: tiny, fast, and plenty for shuffling a 72-tile bag.
export function mkRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
}

/** A fresh 32-bit seed from the platform's randomness. */
export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]! || 1;
  }
  return Math.floor(Math.random() * 0xffffffff) || 1;
}
