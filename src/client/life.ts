import type { RoomDoc } from '../shared/room-types.js';
import type { MeepleKind } from '../shared/types.js';
import { sfxPoke } from './audio.js';
import { room } from './room.js';
import { roundRect } from './ui.js';
import { boardCanvasEl, drawBoard } from './board.js';
import { camera, worldToScreen } from './camera.js';
import { dragState } from './game-view.js';
import { animateMeeples } from './prefs.js';
import { meeplePose } from './wander.js';

export const meepleKey = (m: { x: number; y: number; kind: string; idx: number; playerIdx: number }) => `${m.x},${m.y}|${m.kind}|${m.idx}|${m.playerIdx}`;
/** When each meeple was last poked (ms), for the little hop it does. */
export const pokes = new Map<string, number>();
export const POKE_MS = 480;
export const POKE_LINES = ['Oi!', 'Hey!', 'Ow!', 'Mind it!', 'Careful!', 'Hmph.', 'Do you mind?', 'Not now.', '?!', 'Ahem.'];
export interface Chat { a: string; b: string; textA: string; textB: string; start: number; end: number }
export let chats: Chat[] = [];
export const chatCooldown = new Map<string, number>();
export const SMALL_TALK: Record<string, [string, string][]> = {
  any: [['Hail!', 'Well met.'], ['Fine day.', 'Bit windy.'], ['Any news?', 'None good.'], ['Nice hat.', 'Thanks!'], ['Lost?', 'Always.'], ['Long way?', 'Aye.'], ['Seen the count?', 'Never.'], ['Good morrow.', 'And you.'], ['Rain later.', 'Says who?'], ['Mind the mud.', 'Too late.']],
  road: [['Your purse!', 'Try it.'], ['Toll, please.', 'Nope.'], ['Which way?', 'Follow me.'], ['Long road.', 'Endless.'], ['Bandits about.', 'Just you.']],
  city: [['Halt!', 'Whoa.'], ['Fine walls.', 'Took years.'], ['Who goes?', 'Me.'], ['Shield up.', 'Always.'], ['Any dragons?', 'Not yet.']],
  monastery: [['Bless you.', 'Cheers.'], ['Quiet, please.', 'Sorry.'], ['Pray with me?', 'Later.']],
  farm: [['Nice crop.', 'Needs rain.'], ['Cows loose?', 'Not mine.'], ['Harvest soon.', 'Aye.']],
};
export let lifeAnimFrame: number | null = null;
/** Keep redrawing briefly while a poke hop or a chat bubble is on screen, even with
 *  the wander animation off. */
export function ensureLifeAnimation(): void {
  if (lifeAnimFrame !== null || animateMeeples) return;
  const step = () => {
    lifeAnimFrame = null;
    if (!boardCanvasEl || !room?.game) return;
    const now = performance.now();
    const busy = chats.some((c) => c.end > now) || [...pokes.values()].some((t) => now - t < POKE_MS);
    if (!dragState) drawBoard(boardCanvasEl);
    if (busy) lifeAnimFrame = requestAnimationFrame(step);
  };
  lifeAnimFrame = requestAnimationFrame(step);
}
export function pokeMeeple(m: { x: number; y: number; kind: MeepleKind; idx: number; playerIdx: number }): void {
  const k = meepleKey(m);
  const now = performance.now();
  pokes.set(k, now);
  const seed = (m.x * 31 + m.y * 17 + m.idx * 7 + m.playerIdx * 3) >>> 0;
  sfxPoke(seed);
  // Every third poke or so they say something about it.
  if (Math.random() < 0.4 && !chats.some((c) => c.a === k || c.b === k)) {
    chats.push({ a: k, b: '', textA: POKE_LINES[(seed + Math.floor(now / 1000)) % POKE_LINES.length]!, textB: '', start: now, end: now + 1500 });
  }
  ensureLifeAnimation();
}
/** The meeple under a screen point, if any (topmost = last drawn). */
export function meepleAt(clientX: number, clientY: number, canvasEl: HTMLCanvasElement): RoomDoc['game'] extends null ? never : NonNullable<RoomDoc['game']>['meeples'][number] | null {
  const game = room?.game; if (!game) return null;
  const rect = canvasEl.getBoundingClientRect();
  const px = clientX - rect.left, py = clientY - rect.top;
  const now = performance.now();
  const size = camera.scale * 0.34;
  let hit: NonNullable<RoomDoc['game']>['meeples'][number] | null = null;
  for (const m of game.meeples) {
    const tile = game.board[`${m.x},${m.y}`]; if (!tile) continue;
    const pose = meeplePose(m, tile.tileKey, tile.rot, now);
    const [sx, sy] = worldToScreen(pose.x, pose.y, rect.width, rect.height);
    if (Math.abs(px - sx) <= size * 0.5 && Math.abs(py - sy) <= size * 0.55) hit = m;
  }
  return hit;
}
/** Once per frame: meeples that have wandered within arm's reach may strike up a chat. */
export function maybeStartChats(poses: { key: string; kind: string; x: number; y: number }[], now: number): void {
  chats = chats.filter((c) => c.end > now);
  for (let i = 0; i < poses.length; i++) for (let j = i + 1; j < poses.length; j++) {
    const a = poses[i]!, b = poses[j]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) > 0.28) continue;
    const pair = a.key < b.key ? `${a.key}~${b.key}` : `${b.key}~${a.key}`;
    if ((chatCooldown.get(pair) ?? 0) > now) continue;
    if (chats.some((c) => c.a === a.key || c.b === a.key || c.a === b.key || c.b === b.key)) continue;
    if (Math.random() > 1 / 45) continue; // ~1.5 s of standing together, on average
    const pool = [...SMALL_TALK.any!, ...(a.kind === b.kind ? SMALL_TALK[a.kind] ?? [] : [])];
    const [textA, textB] = pool[Math.floor(Math.random() * pool.length)]!;
    chats.push({ a: a.key, b: b.key, textA, textB, start: now, end: now + 3200 });
    chatCooldown.set(pair, now + 25000 + Math.random() * 20000);
    ensureLifeAnimation();
  }
}
export function drawBubble(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): void {
  ctx.save();
  ctx.font = `600 ${Math.max(10, Math.min(13, size * 0.36))}px "Space Grotesk", sans-serif`;
  const w = ctx.measureText(text).width + 12, hgt = Math.max(16, size * 0.5);
  const bx = x - w / 2, by = y - size * 0.62 - hgt - 6;
  roundRect(ctx, bx, by, w, hgt, hgt / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.fill();
  ctx.strokeStyle = 'rgba(31,46,43,0.75)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 4, by + hgt - 0.5); ctx.lineTo(x, by + hgt + 5); ctx.lineTo(x + 4, by + hgt - 0.5); ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 4, by + hgt); ctx.lineTo(x, by + hgt + 5); ctx.lineTo(x + 4, by + hgt); ctx.stroke();
  ctx.fillStyle = '#1F2E2B'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, by + hgt / 2 + 0.5);
  ctx.restore();
}

/** Chronicle hover/tap: the tiles a scoring line came from, lit on the board. */
