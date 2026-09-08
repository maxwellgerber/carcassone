// Run the head-to-head match queue (research/queue.json) on this machine, several at
// a time, then push results to the `mac-results` branch. Plain Node, no shell tricks,
// so it behaves the same on macOS and Linux. Finished jobs are skipped on re-runs.
//
//   node research/worker.mjs            # parallelism = half the CPU cores (keeps the machine usable)
//   node research/worker.mjs 8          # or pick it
//   node research/worker.mjs 8 --no-push
//   QUEUE=path/to/other.json node research/worker.mjs
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, createWriteStream } from 'node:fs';
import { cpus, hostname, arch } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const par = Number(process.argv[2]) || Math.max(1, Math.floor(cpus().length / 2));
const push = !process.argv.includes('--no-push');
const queueFile = process.env.QUEUE ?? 'research/queue.json';
const outDir = 'research/mac-results';
mkdirSync(outDir, { recursive: true });
mkdirSync('data/research', { recursive: true });

const jobs = JSON.parse(readFileSync(queueFile, 'utf8')).jobs;
console.log(`== worker: ${par} parallel matches on ${hostname()} (${arch()}), node ${process.version}, ${jobs.length} jobs`);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const pending = [...jobs];
let running = 0;
const started = Date.now();

function runOne(job) {
  return new Promise((resolve) => {
    const out = `${outDir}/${job.id}.out`;
    if (existsSync(out) && readFileSync(out, 'utf8').startsWith('STRENGTH')) { console.log(`-- ${job.id}: done already`); return resolve(); }
    const args = ['tsx', 'research/eval.ts', '--candidate', job.candidate, '--games', String(job.games), '--seed', String(job.seed), ...(job.args ?? [])];
    console.log(`-> ${job.id}: ${job.games} games/size, seed ${job.seed} ${(job.args ?? []).join(' ')}`);
    const t0 = Date.now();
    const log = createWriteStream(`${outDir}/${job.id}.log`);
    let stdout = '';
    const child = spawn(npx, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.pipe(log);
    child.on('close', (code) => {
      const mins = ((Date.now() - t0) / 60000).toFixed(0);
      const line = stdout.split('\n').find((l) => l.startsWith('STRENGTH'));
      if (code === 0 && line) { writeFileSync(out, line + '\n'); console.log(`<- ${job.id} (${mins} min): ${line}`); }
      else console.log(`!! ${job.id} failed (exit ${code}); see ${outDir}/${job.id}.log`);
      resolve();
    });
  });
}

await new Promise((done) => {
  const pump = () => {
    while (running < par && pending.length) {
      const job = pending.shift();
      running++;
      runOne(job).finally(() => { running--; if (!pending.length && running === 0) done(); else pump(); });
    }
    if (!pending.length && running === 0) done();
  };
  pump();
});

console.log(`== all jobs finished in ${((Date.now() - started) / 60000).toFixed(0)} min`);
for (const j of jobs) {
  const out = `${outDir}/${j.id}.out`;
  if (existsSync(out)) console.log(`${j.id.padEnd(24)} ${readFileSync(out, 'utf8').trim()}`);
}

if (push) {
  try {
    execFileSync('git', ['add', outDir], { stdio: 'inherit' });
    execFileSync('git', ['-c', 'user.name=mac-worker', '-c', 'user.email=mac-worker@users.noreply.github.com', 'commit', '-q', '-m', `mac-results: ${new Date().toISOString()} from ${hostname()}`], { stdio: 'inherit' });
    execFileSync('git', ['push', '-q', 'origin', 'HEAD:mac-results'], { stdio: 'inherit' });
    console.log('== pushed to origin/mac-results');
  } catch (e) {
    console.log(`== push skipped: ${e.message.split('\n')[0]} (results are in ${outDir}; commit and push them by hand)`);
  }
}
