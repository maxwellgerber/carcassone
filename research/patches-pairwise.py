# Adds a pairwise difference-regression term to research/train.ts, fed by the
# alternative-move benchmark: for candidates a, b at the same root,
#   L_pair = ((V(s_a) - V(s_b)) - (Q(a) - Q(b))/40)^2
# mixed with the ordinary value regression. Net gets trainPairs() (a second backward
# pass with opposite sign), which reuses the fast-loop scratch buffers.
import re
p='src/server/net.ts'; s=open(p).read()
if 'trainPairs(' not in s:
    marker = "  /** One Adam step on a minibatch, mean-squared error on the single output. Returns the batch loss. */"
    add = '''  /** Forward one sample into the scratch activations; returns the output. */
  private fwd(x: ArrayLike<number>, acts: Float64Array[]): number {
    const L = this.w.length;
    const a0 = acts[0]!;
    for (let i = 0; i < a0.length; i++) a0[i] = x[i]!;
    for (let l = 0; l < L; l++) {
      const nin = this.sizes[l]!, nout = this.sizes[l + 1]!;
      const w = this.w[l]!, b = this.b[l]!, a = acts[l]!, out = acts[l + 1]!;
      for (let o = 0; o < nout; o++) {
        let s = b[o]!;
        const row = o * nin;
        for (let i = 0; i < nin; i++) s += w[row + i]! * a[i]!;
        out[o] = l < L - 1 ? (s > 0 ? s : 0.01 * s) : s;
      }
    }
    return acts[L]![0]!;
  }
  /** Backward from an output delta through the scratch activations into gW/gB. */
  private bwd(dOut0: number, acts: Float64Array[], deltas: Float64Array[], gW: Float64Array[], gB: Float64Array[]): void {
    const L = this.w.length;
    deltas[L]![0] = dOut0;
    for (let l = L - 1; l >= 0; l--) {
      const nin = this.sizes[l]!, nout = this.sizes[l + 1]!;
      const a = acts[l]!, w = this.w[l]!;
      const gw = gW[l]!, gb = gB[l]!;
      const dOut = deltas[l + 1]!, dIn = deltas[l]!;
      if (l > 0) dIn.fill(0);
      for (let o = 0; o < nout; o++) {
        const d = dOut[o]!;
        if (d === 0) continue;
        gb[o]! += d;
        const row = o * nin;
        if (l > 0) for (let i = 0; i < nin; i++) { gw[row + i]! += d * a[i]!; dIn[i]! += d * w[row + i]!; }
        else for (let i = 0; i < nin; i++) gw[row + i]! += d * a[i]!;
      }
      if (l > 0) for (let i = 0; i < nin; i++) dIn[i]! *= a[i]! > 0 ? 1 : 0.01;
    }
  }
  private adam(lr: number, l2: number, gW: Float64Array[], gB: Float64Array[]): void {
    this.t++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    for (let l = 0; l < this.w.length; l++) {
      const step = (p: Float64Array, g: Float64Array, m: Float64Array, v: Float64Array, decay: number) => {
        for (let i = 0; i < p.length; i++) {
          const gi = g[i]! + decay * p[i]!;
          m[i] = b1 * m[i]! + (1 - b1) * gi;
          v[i] = b2 * v[i]! + (1 - b2) * gi * gi;
          p[i]! -= lr * (m[i]! / c1) / (Math.sqrt(v[i]! / c2) + eps);
        }
      };
      step(this.w[l]!, gW[l]!, this.mW[l]!, this.vW[l]!, l2);
      step(this.b[l]!, gB[l]!, this.mB[l]!, this.vB[l]!, 0);
    }
  }

  /** One Adam step on value pairs: minimise ((V(a)-V(b)) - d)^2 over the batch, with an
   *  optional plain value term on the same samples (weight `valueWeight`, targets ya/yb). */
  trainPairs(xa: ArrayLike<number>[], xb: ArrayLike<number>[], d: number[], lr = 1e-3, l2 = 1e-5, valueWeight = 0, ya?: number[], yb?: number[]): number {
    const L = this.w.length;
    const { acts, deltas, gW, gB } = this.scratch();
    for (let l = 0; l < L; l++) { gW[l]!.fill(0); gB[l]!.fill(0); }
    let loss = 0;
    const invN = 1 / xa.length;
    for (let k = 0; k < xa.length; k++) {
      const va = this.fwd(xa[k]!, acts);
      const vb = this.fwd(xb[k]!, acts); // acts now hold b; recompute a for its backward below
      const err = (va - vb) - d[k]!;
      loss += err * err;
      // backward through b (negative sign), then re-forward a and backward (positive)
      let db = -2 * err * invN;
      if (valueWeight > 0 && yb) db += valueWeight * 2 * (vb - yb[k]!) * invN;
      this.bwd(db, acts, deltas, gW, gB);
      this.fwd(xa[k]!, acts);
      let da = 2 * err * invN;
      if (valueWeight > 0 && ya) da += valueWeight * 2 * (va - ya[k]!) * invN;
      this.bwd(da, acts, deltas, gW, gB);
    }
    this.adam(lr, l2, gW, gB);
    return loss / xa.length;
  }

'''
    s = s.replace(marker, add + marker)
    # make trainBatch reuse adam() (keeps behaviour identical)
    s = re.sub(r"    // Adam\n    this\.t\+\+;.*?\n    return loss / xs\.length;\n  \}", "    this.adam(lr, l2, gW, gB);\n    return loss / xs.length;\n  }", s, flags=re.S)
    open(p,'w').write(s)

p='research/train.ts'; s=open(p).read()
if 'PAIR_WEIGHT' not in s:
    s = s.replace("const SEED = Number(arg('seed', '11'));", """const SEED = Number(arg('seed', '11'));
// Pairwise supervision from the alternative-move benchmark (data/bench/*.json):
// every PAIR_EVERY value batches, one batch of candidate pairs from the same root.
const PAIR_WEIGHT = 1.0;      // scale of the pair loss relative to the value loss
const PAIR_EVERY = 4;
const PAIR_BATCH = 256;
const PAIR_FILES = arg('pairs', 'data/bench/local-*.json');""")
    s = s.replace("// ---- training under budget ------------------------------------------------------", """// ---- pairs ----------------------------------------------------------------------
interface BCand { x: number[]; q: number; se: number }
interface BRoot { candidates: BCand[]; players: number; tilesLeft: number }
const pairRoots: BRoot[] = [];
try {
  const { globSync } = await import('node:fs');
  for (const f of globSync(PAIR_FILES)) pairRoots.push(...(JSON.parse(readFileSync(f, 'utf8')) as { roots: BRoot[] }).roots.filter((r) => r.candidates.length >= 2 && r.candidates[0]!.x.length === dim));
} catch { /* no pairs */ }
console.error(`pairs: ${pairRoots.length} roots`);
function samplePairs(n: number): { xa: number[][]; xb: number[][]; d: number[] } {
  const xa: number[][] = [], xb: number[][] = [], d: number[] = [];
  while (xa.length < n && pairRoots.length) {
    const r = pairRoots[Math.floor(rng() * pairRoots.length)]!; // roots uniformly, not pairs
    const i = Math.floor(rng() * r.candidates.length); let j = Math.floor(rng() * (r.candidates.length - 1)); if (j >= i) j++;
    const a = r.candidates[i]!, b = r.candidates[j]!;
    xa.push(a.x); xb.push(b.x); d.push((a.q - b.q) / 40);
  }
  return { xa, xb, d };
}

// ---- training under budget ------------------------------------------------------""")
    s = s.replace("""    net.trainBatch(ids.map((i) => row(trainX, i)), ids.map((i) => trainY[i]!), lr, L2);
    seen += ids.length;""", """    net.trainBatch(ids.map((i) => row(trainX, i)), ids.map((i) => trainY[i]!), lr, L2);
    seen += ids.length;
    if (pairRoots.length && PAIR_WEIGHT > 0 && (s / BATCH) % PAIR_EVERY === 0) {
      const pr = samplePairs(PAIR_BATCH);
      net.trainPairs(pr.xa, pr.xb, pr.d, lr * PAIR_WEIGHT, L2);
    }""")
    open(p,'w').write(s)
print('patched')
