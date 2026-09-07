// Drive a real game in headless Chromium against a running `npm run dev` server:
// two human players in separate browser contexts plus an NPC, clicking the actual
// UI (legal cells, ghost meeples, the Skip button) until the game ends. Screenshots
// land in --out (default: ./playthrough). Any page error fails the run.
//
//   npm run dev                      # in one terminal
//   node scripts/play-in-browser.mjs # in another (needs playwright-core on the path,
//                                    # or PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core)
//   SKIN=neon node scripts/play-in-browser.mjs   # play under one of the procedural tilesets
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'playthrough';
const EXECUTABLE = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
mkdirSync(OUT, { recursive: true });

const pwPath = process.env.PLAYWRIGHT_CORE ?? 'playwright-core';
const { chromium } = await import(pwPath.startsWith('/') ? path.join(pwPath, 'index.mjs') : pwPath);

const errors = [];
const seenToasts = new Set();
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

async function newPlayer(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  page.on('requestfailed', (r) => { if (!/fonts\.g(oogleapis|static)\.com/.test(r.url())) errors.push(`${name} request failed: ${r.url()} ${r.failure()?.errorText}`); });
  await page.goto(`${BASE}/auth/login`);
  if (process.env.SKIN) await page.evaluate((id) => localStorage.setItem('carcassonne.skin', id), process.env.SKIN);
  await page.waitForSelector('input[name=name]');
  await page.fill('input[name=name]', name);
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Create game');
  return { name, page, ctx };
}

const snap = async (page, label) => { await page.screenshot({ path: path.join(OUT, `${label}.png`) }); console.log(`  📸 ${label}`); };
const state = (page) => page.evaluate(() => {
  const c = window.__carcassonne; const r = c.room();
  if (!r) return null;
  return {
    phase: r.phase, gphase: r.game?.phase ?? null, my: c.myTurn(), tiles: r.game ? Object.keys(r.game.board).length : 0,
    cur: r.game ? r.game.players[r.game.currentPlayer]?.name : null, scores: r.game ? r.game.players.map((p) => `${p.name}=${p.score}`).join(' ') : '',
    deck: r.game?.deck.length ?? 0, log0: r.game?.log[0] ?? '',
  };
});

const room = `play-${Math.random().toString(36).slice(2, 8)}`;
console.log(`room ${room}`);
const A = await newPlayer('Ada');
const B = await newPlayer('Brook');

await A.page.goto(`${BASE}/r/${room}`);
await A.page.waitForSelector('text=The Table Is Set');
await B.page.goto(`${BASE}/r/${room}`);
await B.page.waitForSelector('text=The Table Is Set');
await A.page.click('.npc-row button:has-text("Hard")');
await A.page.click('label:has-text("Quick game") input');
if (process.env.RIVER) await A.page.click('label:has-text("The River") input');
await A.page.waitForSelector('text=Start game (3 players)');
await snap(A.page, '01-lobby');
await A.page.click('text=Start game (3 players)');
await A.page.waitForSelector('.board-wrap canvas');
await B.page.waitForSelector('.board-wrap canvas');

let placedByHumans = 0, meeplesPlaced = 0, skips = 0, escSkips = 0, autoSkipToasts = 0, shot = { hover: false, ghosts: false, tooltip: false, mid: false };
const rnd = (n) => Math.floor(Math.random() * n);
// Screen positions are only trustworthy after the board has had a frame to refit
// its camera around the newest tile, exactly as a person waits for the redraw.
const afterFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = async (page, before) => {
  const key = (st) => st && `${st.tiles}|${st.gphase}|${st.cur}|${st.phase}`;
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(50); if (key(await state(page)) !== key(before)) return true; }
  return false;
};
let idle = 0;
for (let step = 0; step < 4000; step++) {
  let acted = false;
  for (const P of [A, B]) {
    const st = await state(P.page);
    if (!st) continue;
    if (st.phase === 'ended') { acted = true; break; }
    // Toasts: the auto-skip explanation surfaces here.
    const toasts = await P.page.$$eval('.copy-toast', (els) => els.map((e) => e.textContent));
    for (const t of toasts) { const k = `${P.name}:${t}:${Math.floor(Date.now() / 3000)}`; if (t.includes('turn passes') && !seenToasts.has(k)) { seenToasts.add(k); autoSkipToasts++; console.log(`  toast for ${P.name}: "${t}"`); } }
    if (!st.my) continue;
    if (st.gphase === 'placeTile') {
      await afterFrame(P.page);
      // Cells under the placement bar at the top can't be tapped without panning first.
      const cells = (await P.page.evaluate(() => window.__carcassonne.legalCells())).filter((c) => c.sy > 80);
      if (!cells.length) { await P.page.click('button:has-text("Recenter")'); continue; }
      const c = cells[rnd(cells.length)];
      await P.page.mouse.move(c.sx, c.sy);
      await P.page.waitForTimeout(60);
      if (!shot.hover) { shot.hover = true; await snap(P.page, '02-hover-preview'); }
      await P.page.mouse.click(c.sx, c.sy); // set it down
      await P.page.waitForTimeout(80);
      if (!(await P.page.evaluate(() => !!window.__carcassonne.pending()))) errors.push(`${P.name}: first tap did not set the tile down at ${JSON.stringify(c)}`);
      const how = Math.random();
      if (how < 0.3) { await P.page.click('.place-bar button:has-text("Rotate")', { timeout: 2000 }).catch(() => {}); await P.page.click('.place-bar button:has-text("Place")'); }
      else if (how < 0.5) { await P.page.keyboard.press('r'); await P.page.keyboard.press('Enter'); }
      else { await P.page.mouse.click(c.sx, c.sy); } // second tap confirms
      placedByHumans++;
      acted = true;
      if (!(await settle(P.page, st))) {
        const info = await P.page.evaluate(([x, y]) => ({ under: document.elementFromPoint(x, y)?.outerHTML.slice(0, 80), toasts: [...document.querySelectorAll('.copy-toast')].map((e) => e.textContent), cells: window.__carcassonne.legalCells().slice(0, 3), rot: window.__carcassonne.previewRot(), hint: document.querySelector('.board-hint')?.getBoundingClientRect().toJSON() }), [c.sx, c.sy]);
        await snap(P.page, `debug-tile-click-${step}`);
        errors.push(`${P.name}: nothing happened after clicking legal cell ${JSON.stringify(c)} — ${JSON.stringify(info)}`);
      }
    } else if (st.gphase === 'placeMeeple') {
      await afterFrame(P.page);
      const ghosts = await P.page.evaluate(() => window.__carcassonne.ghosts());
      if (ghosts.length === 0) { errors.push(`${P.name}: asked for a meeple with no ghosts to click (state ${JSON.stringify(st)})`); continue; }
      if (!shot.ghosts) { shot.ghosts = true; await P.page.mouse.move(10, 400); await P.page.waitForTimeout(80); await snap(P.page, '03-ghost-meeples'); }
      const r = Math.random();
      let action = '';
      if (r < 0.6) {
        const g = ghosts[rnd(ghosts.length)];
        await P.page.mouse.move(g.sx, g.sy);
        await P.page.waitForTimeout(80);
        if (!shot.tooltip) { shot.tooltip = true; await snap(P.page, '04-ghost-hover-tooltip'); }
        action = `ghost ${JSON.stringify(g)} under=` + await P.page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [g.sx, g.sy]);
        await P.page.mouse.click(g.sx, g.sy);
        meeplesPlaced++;
      } else if (r < 0.85) {
        try {
          action = 'skip button';
          await P.page.click('.meeple-bar button:has-text("Skip")', { timeout: 4000 });
          skips++;
        } catch (e) {
          const dom = await P.page.evaluate(() => ({ bar: !!document.querySelector('.meeple-bar'), banner: document.querySelector('.turn-banner')?.textContent, heading: document.querySelector('h2')?.textContent }));
          const now = await state(P.page);
          await snap(P.page, `debug-skip-timeout-${step}`);
          errors.push(`${P.name}: Skip click failed (${e.message.split('\n')[0]}); dom=${JSON.stringify(dom)} state=${JSON.stringify(now)}`);
        }
      } else {
        action = 'esc key, focus=' + await P.page.evaluate(() => document.activeElement?.tagName);
        await P.page.keyboard.press('Escape');
        escSkips++;
      }
      acted = true;
      if (!(await settle(P.page, st))) { await snap(P.page, `debug-meeple-${step}`); errors.push(`${P.name}: meeple decision (${action}) did not go through (state ${JSON.stringify(st)})`); }
    }
    if (st.tiles >= 18 && !shot.mid) {
      shot.mid = true;
      await snap(P.page, '05-midgame');
      // Settings popover: open it, flip music off and on, make sure the choice sticks.
      await P.page.click('button[title="Settings"]');
      await snap(P.page, '05b-settings-open');
      await P.page.click('.settings-row:has-text("music") input');
      const off = await P.page.evaluate(() => localStorage.getItem('carcassonne.music'));
      await P.page.click('.settings-row:has-text("music") input');
      const on = await P.page.evaluate(() => localStorage.getItem('carcassonne.music'));
      if (off !== 'off' || on !== 'on') errors.push(`music toggle did not persist (off=${off}, on=${on})`);
      await P.page.click('button[title="Settings"]');
      await P.page.waitForTimeout(300);
      if (await P.page.$('.settings-pop:not([hidden])')) errors.push('settings popover did not close');
    }
  }
  const stA = await state(A.page);
  if (stA?.phase === 'ended') break;
  if (!acted) { idle++; if (idle > 200) { errors.push(`stalled: ${JSON.stringify(stA)}`); break; } await A.page.waitForTimeout(250); } else idle = 0;
}

await A.page.waitForTimeout(600);
const finalA = await state(A.page);
await snap(A.page, '06-game-over');
await snap(B.page, '07-game-over-other-player');
// After the game: dismiss the scores, pan the board, reopen the scores.
await A.page.click('button:has-text("Look at the board")');
if (await A.page.$('.modal-backdrop')) errors.push('end modal did not dismiss');
const camBefore = await A.page.evaluate(() => window.__carcassonne.legalCells().length); // just exercises the hook
void camBefore;
await A.page.mouse.move(400, 400); await A.page.mouse.down(); await A.page.mouse.move(520, 470, { steps: 6 }); await A.page.mouse.up();
await A.page.waitForTimeout(150);
await snap(A.page, '08-post-game-board');
await A.page.click('button:has-text("Final scores")');
if (!(await A.page.$('.modal-backdrop'))) errors.push('end modal did not reopen');
console.log('\nfinal:', finalA);
console.log(`humans placed ${placedByHumans} tiles, ${meeplesPlaced} meeples via ghosts, ${skips} button skips, ${escSkips} Esc skips, ${autoSkipToasts} auto-skip toasts`);
await browser.close();
if (errors.length) { console.error('\nERRORS:'); for (const e of errors) console.error(' -', e); process.exit(1); }
if (finalA?.phase !== 'ended') { console.error('game did not finish'); process.exit(1); }
console.log('\nOK');
