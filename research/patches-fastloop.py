# Applies: allocation-free training loop in net.ts (identical math) + export of the
# best-validation checkpoint seen during the budget in research/train.ts.
import re
p='src/server/net.ts'; s=open(p).read()
if 'private scratch()' not in s:
    old_start=s.index("  /** One Adam step on a minibatch")
    old_end=s.index("    // Adam\n")
    new='''  // Scratch buffers reused across batches: activations, deltas and gradient
  // accumulators. Allocating these per sample was most of the training time.
  private acts: Float64Array[] | null = null;
  private deltas: Float64Array[] | null = null;
  private gW: Float64Array[] | null = null;
  private gB: Float64Array[] | null = null;
  private scratch(): { acts: Float64Array[]; deltas: Float64Array[]; gW: Float64Array[]; gB: Float64Array[] } {
    if (!this.acts) {
      this.acts = this.sizes.map((n) => new Float64Array(n));
      this.deltas = this.sizes.map((n) => new Float64Array(n));
      this.gW = this.w.map((w) => new Float64Array(w.length));
      this.gB = this.b.map((b) => new Float64Array(b.length));
    }
    return { acts: this.acts, deltas: this.deltas!, gW: this.gW!, gB: this.gB! };
  }

  /** Snapshot of the weights (for keeping the best checkpoint). */
  snapshot(): { w: Float64Array[]; b: Float64Array[] } { return { w: this.w.map((x) => Float64Array.from(x)), b: this.b.map((x) => Float64Array.from(x)) }; }
  restore(s: { w: Float64Array[]; b: Float64Array[] }): void { s.w.forEach((x, l) => this.w[l]!.set(x)); s.b.forEach((x, l) => this.b[l]!.set(x)); }

  /** One Adam step on a minibatch, mean-squared error on the single output. Returns the batch loss. */
  trainBatch(xs: ArrayLike<number>[], ys: number[], lr = 1e-3, l2 = 1e-5): number {
    const L = this.w.length;
    const { acts, deltas, gW, gB } = this.scratch();
    for (let l = 0; l < L; l++) { gW[l]!.fill(0); gB[l]!.fill(0); }
    let loss = 0;
    const invN = 1 / xs.length;
    for (let k = 0; k < xs.length; k++) {
      const x = xs[k]!;
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
      const pred = acts[L]![0]!;
      const err = pred - ys[k]!;
      loss += err * err;
      deltas[L]![0] = 2 * err * invN;
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
'''
    s=s[:old_start]+new+s[old_end:]
    open(p,'w').write(s)

p='research/train.ts'; s=open(p).read()
if 'bestSnap' not in s:
    s=s.replace("let epoch = 0, seen = 0;","let epoch = 0, seen = 0;\nlet bestVal = Infinity, bestSnap = net.snapshot();")
    s=s.replace("""  epoch++;
  console.error(`epoch ${epoch} done at ${((Date.now() - started) / 1000).toFixed(0)}s, val ${valMse().toFixed(5)}`);
}
const mse = valMse();""","""  epoch++;
  const v = valMse();
  if (v < bestVal) { bestVal = v; bestSnap = net.snapshot(); }
  console.error(`epoch ${epoch} done at ${((Date.now() - started) / 1000).toFixed(0)}s, val ${v.toFixed(5)}`);
}
// Export the best epoch-end checkpoint seen inside the budget, and report its error.
if (valMse() > bestVal) net.restore(bestSnap);
const mse = valMse();""")
    open(p,'w').write(s)
print('patched')
