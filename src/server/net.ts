// A small multilayer perceptron with its own training loop, in plain TypeScript,
// so the same code trains offline (scripts/train.ts), runs inside the Worker, and
// ships its weights as JSON. No tensor library: the net is a few thousand
// parameters and a forward pass is a few microseconds.

export interface NetWeights { sizes: number[]; w: number[][]; b: number[][] }

export class Net {
  sizes: number[];
  w: Float64Array[]; // w[l] is (out x in), row-major
  b: Float64Array[];
  // Adam state
  private mW: Float64Array[] = []; private vW: Float64Array[] = []; private mB: Float64Array[] = []; private vB: Float64Array[] = [];
  private t = 0;

  constructor(sizes: number[], rng: () => number = Math.random) {
    this.sizes = sizes;
    this.w = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const nin = sizes[l]!, nout = sizes[l + 1]!;
      const scale = Math.sqrt(2 / nin);
      const w = new Float64Array(nin * nout);
      for (let i = 0; i < w.length; i++) w[i] = (rng() * 2 - 1) * scale;
      this.w.push(w); this.b.push(new Float64Array(nout));
      this.mW.push(new Float64Array(nin * nout)); this.vW.push(new Float64Array(nin * nout));
      this.mB.push(new Float64Array(nout)); this.vB.push(new Float64Array(nout));
    }
  }

  static fromJSON(j: NetWeights): Net {
    const n = new Net(j.sizes, () => 0);
    j.w.forEach((w, l) => n.w[l]!.set(w));
    j.b.forEach((b, l) => n.b[l]!.set(b));
    return n;
  }
  toJSON(): NetWeights {
    return { sizes: this.sizes, w: this.w.map((w) => [...w].map((x) => Math.round(x * 1e5) / 1e5)), b: this.b.map((b) => [...b].map((x) => Math.round(x * 1e5) / 1e5)) };
  }

  /** Forward pass; returns the activations of every layer (needed for backprop). */
  forwardAll(x: ArrayLike<number>): Float64Array[] {
    const acts: Float64Array[] = [Float64Array.from(x)];
    for (let l = 0; l < this.w.length; l++) {
      const nin = this.sizes[l]!, nout = this.sizes[l + 1]!;
      const w = this.w[l]!, b = this.b[l]!, a = acts[l]!;
      const out = new Float64Array(nout);
      for (let o = 0; o < nout; o++) {
        let s = b[o]!;
        const row = o * nin;
        for (let i = 0; i < nin; i++) s += w[row + i]! * a[i]!;
        out[o] = l < this.w.length - 1 ? (s > 0 ? s : 0.01 * s) : s; // leaky relu hidden, linear output
      }
      acts.push(out);
    }
    return acts;
  }
  predict(x: ArrayLike<number>): number {
    const acts = this.forwardAll(x);
    return acts[acts.length - 1]![0]!;
  }

  /** One Adam step on a minibatch, mean-squared error on the single output. Returns the batch loss. */
  trainBatch(xs: ArrayLike<number>[], ys: number[], lr = 1e-3, l2 = 1e-5): number {
    const L = this.w.length;
    const gW = this.w.map((w) => new Float64Array(w.length));
    const gB = this.b.map((b) => new Float64Array(b.length));
    let loss = 0;
    for (let k = 0; k < xs.length; k++) {
      const acts = this.forwardAll(xs[k]!);
      const pred = acts[L]![0]!;
      const err = pred - ys[k]!;
      loss += err * err;
      let delta = new Float64Array([2 * err / xs.length]);
      for (let l = L - 1; l >= 0; l--) {
        const nin = this.sizes[l]!, nout = this.sizes[l + 1]!;
        const a = acts[l]!;
        const gw = gW[l]!, gb = gB[l]!;
        const next = new Float64Array(nin);
        for (let o = 0; o < nout; o++) {
          const d = delta[o]!;
          if (d === 0) continue;
          gb[o]! += d;
          const row = o * nin;
          const w = this.w[l]!;
          for (let i = 0; i < nin; i++) { gw[row + i]! += d * a[i]!; next[i]! += d * w[row + i]!; }
        }
        if (l > 0) for (let i = 0; i < nin; i++) next[i]! *= a[i]! > 0 ? 1 : 0.01;
        delta = next;
      }
    }
    // Adam
    this.t++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    for (let l = 0; l < L; l++) {
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
    return loss / xs.length;
  }
}
