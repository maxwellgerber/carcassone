// Decide whether a hill-climb candidate replaces the incumbent, from tourney JSON.
// Prints one line starting with KEEP or REJECT. The bar: across the given reports,
// the candidate bots (cand, cand-hard) must out-win and out-margin the incumbents
// (blend, blend-hard) on aggregate, by more than noise would explain.
import { readFileSync } from 'node:fs';

interface Tally { games: number; wins: number; score: number; margin: number }
let candW = 0, candG = 0, candM = 0, incW = 0, incG = 0, incM = 0;
for (const f of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(f, 'utf8')) as { tally: Record<string, Record<string, Tally>> };
  for (const table of Object.values(r.tally)) {
    for (const [bot, t] of Object.entries(table)) {
      if (!t.games) continue;
      if (bot === 'cand' || bot === 'cand-hard') { candW += t.wins; candG += t.games; candM += t.margin; }
      if (bot === 'blend' || bot === 'blend-hard') { incW += t.wins; incG += t.games; incM += t.margin; }
    }
  }
}
const cw = candW / Math.max(1, candG), iw = incW / Math.max(1, incG);
const cm = candM / Math.max(1, candG), im = incM / Math.max(1, incG);
// Standard error of a win-rate difference at these sample sizes.
const se = Math.sqrt(cw * (1 - cw) / Math.max(1, candG) + iw * (1 - iw) / Math.max(1, incG));
const z = (cw - iw) / (se || 1);
const summary = `candidate win ${(100 * cw).toFixed(1)}% (${candG} seats, margin ${cm.toFixed(2)}) vs incumbent ${(100 * iw).toFixed(1)}% (${incG} seats, margin ${im.toFixed(2)}), z=${z.toFixed(2)}`;
const keep = cw > iw && cm > im && z > 1.0;
console.log(`${keep ? 'KEEP' : 'REJECT'}: ${summary}`);
