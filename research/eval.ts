// FROZEN harness step 2: playing strength. The candidate weights (blended with the
// hand evaluation exactly as the shipped bot does) play a seeded tourney against a
// frozen reference net, so every experiment is measured against the same opponent
// on the same tile draws. Prints one line:
//
//     STRENGTH win=0.583 margin=2.10 z=1.9 games=160
//
//   npx tsx research/eval.ts --candidate data/research/candidate.ts [--games 80] [--reference research/reference-weights.ts]
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

function arg(name: string, def: string): string { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : def; }
const candidate = arg('candidate', 'data/research/candidate.ts');
const reference = arg('reference', 'research/reference-weights.ts');
const games = Number(arg('games', '80'));
const seed = Number(arg('seed', '4242'));

// Install the candidate and the reference where the tourney's bots find them.
copyFileSync(candidate, 'src/server/weights-candidate.ts');
const refSrc = readFileSync(reference, 'utf8').replace('WEIGHTS_REFERENCE', 'WEIGHTS');
const shippedBackup = readFileSync('src/server/weights.ts', 'utf8');
writeFileSync('src/server/weights.ts', refSrc);
try {
  const runs = [2, 3].map((n) => {
    const outFile = `data/research/eval-${n}p.json`;
    execFileSync('npx', ['tsx', 'scripts/tourney.ts', '--players', String(n), '--games', String(games), '--seed', String(seed + n), '--bots', 'blend,cand,blend-hard,cand-hard', '--out', outFile], { stdio: ['ignore', 'ignore', 'inherit'] });
    return outFile;
  });
  const verdict = execFileSync('npx', ['tsx', 'scripts/gate.ts', ...runs], { encoding: 'utf8' }).trim();
  const m = verdict.match(/candidate win ([\d.]+)% \((\d+) seats, margin ([-\d.]+)\) vs incumbent ([\d.]+)% \((\d+) seats, margin ([-\d.]+)\), z=([-\d.]+)/)!;
  console.error(verdict);
  console.log(`STRENGTH win=${(Number(m[1]) / 100).toFixed(3)} ref_win=${(Number(m[4]) / 100).toFixed(3)} margin=${Number(m[3]).toFixed(2)} ref_margin=${Number(m[6]).toFixed(2)} z=${m[7]} games=${Number(m[2]) + Number(m[5])}`);
} finally {
  writeFileSync('src/server/weights.ts', shippedBackup);
  try { unlinkSync('src/server/weights-candidate.ts'); } catch { /* fine */ }
}
