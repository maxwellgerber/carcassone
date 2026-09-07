import { mountHome, mountWelcome } from './home.js';
import { mountRoom, teardownRoom } from './room.js';
import { mountReplay } from './replay.js';

export const root = document.getElementById('app')!;
export function navigate(path: string): void { history.pushState({}, '', path); route(); }
window.addEventListener('popstate', route);

export function route(): void {
  teardownRoom();
  const m = location.pathname.match(/^\/r\/([a-z0-9-]+)\/?$/i);
  const rp = location.pathname.match(/^\/r\/([a-z0-9-]+)\/replay\/([a-z0-9.-]+)\/?$/i);
  if (location.pathname === '/welcome') { void mountWelcome(); return; }
  if (rp) { void mountReplay(rp[1]!.toLowerCase(), rp[2]!); return; }
  if (m) { void mountRoom(m[1]!.toLowerCase()); return; }
  void mountHome();
}
