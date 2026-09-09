/**
 * A small solver-neutral integer-program representation, with two backends:
 * YALPS (pure JS, always available) and HiGHS (WebAssembly, much faster on
 * larger models, used when the page can instantiate it).
 */
import { solve as yalpsSolve } from 'yalps';

export interface IPVariable {
  /** Objective coefficient. */
  obj: number;
  /** [row name, coefficient] pairs. */
  coeffs: [string, number][];
  kind: 'binary' | 'integer' | 'continuous';
  /** Upper bound for integer/continuous variables (binary is 0..1). */
  upper?: number;
}

export interface IPRow {
  min?: number;
  max?: number;
  equal?: number;
}

export interface IPModel {
  direction: 'minimize' | 'maximize';
  variables: Map<string, IPVariable>;
  rows: Map<string, IPRow>;
}

export interface IPSolution {
  status: 'optimal' | 'infeasible' | 'unbounded' | 'timedout' | 'cycled' | 'error';
  objective: number;
  /** Variables with non-zero values. */
  values: Map<string, number>;
  backend: 'yalps' | 'highs';
}

export type Solver = (model: IPModel, timeoutMs: number) => Promise<IPSolution>;

export function newModel(direction: 'minimize' | 'maximize' = 'minimize'): IPModel {
  return { direction, variables: new Map(), rows: new Map() };
}

export function addVar(m: IPModel, name: string, kind: IPVariable['kind'], obj = 0, upper?: number): IPVariable {
  const v: IPVariable = { obj, coeffs: [], kind, upper };
  m.variables.set(name, v);
  return v;
}

export function addRow(m: IPModel, name: string, bound: IPRow): void {
  m.rows.set(name, bound);
}

export function coef(m: IPModel, varName: string, row: string, c: number): void {
  const v = m.variables.get(varName);
  if (!v) throw new Error(`no variable ${varName}`);
  v.coeffs.push([row, c]);
}

// --- YALPS backend -------------------------------------------------------------------------

export const yalpsSolver: Solver = async (model, timeoutMs) => {
  const variables = new Map<string, [string, number][]>();
  const constraints = new Map<string, { min?: number; max?: number; equal?: number }>();
  const integers: string[] = [];
  const binaries: string[] = [];
  let anyObj = false;
  for (const [name, v] of model.variables) {
    const coeffs: [string, number][] = [...v.coeffs];
    if (v.obj !== 0) { coeffs.push(['obj', v.obj]); anyObj = true; }
    if (v.kind === 'binary') binaries.push(name);
    else if (v.kind === 'integer') integers.push(name);
    if (v.kind !== 'binary' && v.upper !== undefined) {
      constraints.set(`ub:${name}`, { max: v.upper });
      coeffs.push([`ub:${name}`, 1]);
    }
    variables.set(name, coeffs);
  }
  for (const [name, r] of model.rows) constraints.set(name, r);
  const t0 = Date.now();
  const sol = yalpsSolve({ direction: model.direction, objective: anyObj ? 'obj' : undefined, constraints, variables, integers, binaries }, { timeout: timeoutMs, maxPivots: 2_000_000, checkCycles: true });
  void t0;
  const values = new Map<string, number>();
  for (const [n, x] of sol.variables) values.set(n, x);
  return { status: sol.status, objective: sol.result, values, backend: 'yalps' };
};

// --- HiGHS backend ------------------------------------------------------------------------------

/** Minimal shape of the highs-js module object we use. */
export interface HighsModule {
  solve: (lp: string, options?: Record<string, unknown>) => { Status: string; ObjectiveValue: number; Columns: Record<string, { Primal: number }> };
}

/** Serialise a model in CPLEX LP format, which is what highs-js reads. */
export function toLP(model: IPModel): string {
  const lines: string[] = [];
  const objTerms: string[] = [];
  for (const [name, v] of model.variables) if (v.obj !== 0) objTerms.push(`${fmt(v.obj)} ${name}`);
  lines.push(model.direction === 'minimize' ? 'Minimize' : 'Maximize');
  lines.push(' obj: ' + (objTerms.length ? objTerms.join(' ') : '0 ' + model.variables.keys().next().value));
  lines.push('Subject To');
  const rowTerms = new Map<string, string[]>();
  for (const [name, v] of model.variables) {
    for (const [row, c] of v.coeffs) {
      if (c === 0) continue;
      const arr = rowTerms.get(row) ?? [];
      arr.push(`${fmt(c)} ${name}`);
      rowTerms.set(row, arr);
    }
  }
  let k = 0;
  for (const [row, r] of model.rows) {
    const terms = rowTerms.get(row);
    if (!terms || terms.length === 0) {
      // Empty row: 0 (=|<=|>=) b. Infeasible if violated; encode via a dummy zero-column term.
      const first = model.variables.keys().next().value as string | undefined;
      if (!first) continue;
      const ok = r.equal !== undefined ? r.equal === 0 : (r.min === undefined || r.min <= 0) && (r.max === undefined || r.max >= 0);
      if (ok) continue;
      lines.push(` r${k++}: 0 ${first} ${r.equal !== undefined ? '= ' + r.equal : r.min !== undefined ? '>= ' + r.min : '<= ' + r.max}`);
      continue;
    }
    const lhs = terms.join(' ');
    if (r.equal !== undefined) lines.push(` r${k++}: ${lhs} = ${r.equal}`);
    else {
      if (r.min !== undefined) lines.push(` r${k++}: ${lhs} >= ${r.min}`);
      if (r.max !== undefined) lines.push(` r${k++}: ${lhs} <= ${r.max}`);
    }
  }
  lines.push('Bounds');
  const bins: string[] = [];
  const gens: string[] = [];
  for (const [name, v] of model.variables) {
    if (v.kind === 'binary') { bins.push(name); continue; }
    lines.push(` 0 <= ${name} <= ${v.upper ?? 1e9}`);
    if (v.kind === 'integer') gens.push(name);
  }
  if (bins.length) { lines.push('Binary'); for (let i = 0; i < bins.length; i += 50) lines.push(' ' + bins.slice(i, i + 50).join(' ')); }
  if (gens.length) { lines.push('General'); for (let i = 0; i < gens.length; i += 50) lines.push(' ' + gens.slice(i, i + 50).join(' ')); }
  lines.push('End');
  return lines.join('\n');
}

function fmt(c: number): string {
  return c < 0 ? `- ${Math.abs(c)}` : `+ ${c}`;
}

export function highsSolver(highs: HighsModule): Solver {
  return async (model, timeoutMs) => {
    const lp = toLP(model);
    let res: ReturnType<HighsModule['solve']>;
    try {
      res = highs.solve(lp, { time_limit: timeoutMs / 1000, output_flag: false, mip_rel_gap: 0 });
    } catch (e) {
      console.error(e);
      return { status: 'error', objective: NaN, values: new Map(), backend: 'highs' };
    }
    const values = new Map<string, number>();
    for (const [n, col] of Object.entries(res.Columns ?? {})) if (Math.abs(col.Primal) > 1e-9) values.set(n, col.Primal);
    const st = res.Status;
    const status: IPSolution['status'] = st === 'Optimal' ? 'optimal' : st === 'Infeasible' ? 'infeasible' : st === 'Unbounded' ? 'unbounded' : /time/i.test(st) ? 'timedout' : values.size ? 'timedout' : 'infeasible';
    return { status, objective: res.ObjectiveValue, values, backend: 'highs' };
  };
}
