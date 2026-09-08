// FROZEN harness step 2: playing strength. The candidate weights (blended with the
// hand evaluation exactly as the shipped bot does) play a seeded tourney against a
// frozen reference net, so every experiment is measured against the same opponent
// on the same tile draws. Prints one line:
//
//     STRENGTH win=0.583 margin=2.10 z=1.9 games=160
//
//   npx tsx research/eval.ts --candidate data/research/candidate.ts [--games 80] [--reference research/reference-weights.ts]
import { execFileSync } from 'node:child_process';
import { copyFileSync, unlinkSync } from 'node:fs';

function arg(name: string, def: string): string { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : def; }
const candidate = arg('candidate', 'data/research/candidate.ts');
const reference = arg('reference', 'research/reference-weights.ts');
const games = Number(arg('games', '80'));
const seed = Number(arg('seed', '4242'));
const encoder = arg('encoder', '');
const blend = arg('blend', '');
const tune = arg('tune', '');
const search = arg('search', ''); // optional JSON of hard-bot search knobs for the candidate only
const bots = arg('bots', 'blend,cand,blend-hard,cand-hard'); // e.g. blend-hard,cand-hard for search experiments // optional JSON of evaluation knobs for the candidate only, e.g. '{"reserveValue":9}' // optional: the candidate's net weight in the blend (shipped: 0.5) // optional: an encoder file (src/server-relative imports) the candidate was trained with

// Install the candidate where the tourney's cand bots find it; the reference (weights
// and its frozen encoder) is loaded by the tourney itself under CARC_REFERENCE=1.
// Per-run file names, so two evals can run at once without trampling each other.
const tag = String(process.pid);
const candFile = `src/server/weights-candidate-${tag}.ts`, encFile = `src/server/features-candidate-${tag}.ts`;
copyFileSync(candidate, candFile);
if (encoder) copyFileSync(encoder, encFile);
// --reference shipped: play the live shipped bot (current weights + live encoder) instead
// of the frozen gen-0 reference — the head-to-head that decides a promotion.
const vsShipped = reference === 'shipped';
if (!vsShipped && reference !== 'research/reference-weights.ts') throw new Error('the reference is the frozen research/reference-weights.ts, or "shipped"');
try {
  const runs = [2, 3].map((n) => {
    const outFile = `data/research/eval-${tag}-${n}p.json`;
    execFileSync('npx', ['tsx', 'scripts/tourney.ts', '--players', String(n), '--games', String(games), '--seed', String(seed + n), '--bots', bots, '--out', outFile], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...(vsShipped ? {} : { CARC_REFERENCE: '1' }), CARC_CANDIDATE_FILE: `../src/server/weights-candidate-${tag}.js`, ...(encoder ? { CARC_CANDIDATE_ENCODER: `../src/server/features-candidate-${tag}.js` } : {}), ...(blend ? { CARC_CAND_BLEND: blend } : {}), ...(tune ? { CARC_CAND_TUNE: tune } : {}), ...(search ? { CARC_CAND_SEARCH: search } : {}) } });
    return outFile;
  });
  const verdict = execFileSync('npx', ['tsx', 'scripts/gate.ts', ...runs], { encoding: 'utf8' }).trim();
  const m = verdict.match(/candidate win ([\d.]+)% \((\d+) seats, margin ([-\d.]+)\) vs incumbent ([\d.]+)% \((\d+) seats, margin ([-\d.]+)\), z=([-\d.]+)/)!;
  console.error(verdict);
  console.log(`STRENGTH win=${(Number(m[1]) / 100).toFixed(3)} ref_win=${(Number(m[4]) / 100).toFixed(3)} margin=${Number(m[3]).toFixed(2)} ref_margin=${Number(m[6]).toFixed(2)} z=${m[7]} games=${Number(m[2]) + Number(m[5])}`);
} finally {
  try { unlinkSync(candFile); } catch { /* fine */ }
  try { unlinkSync(encFile); } catch { /* fine */ }
}
