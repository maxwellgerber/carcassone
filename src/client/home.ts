import { PLAYER_COLORS } from '../shared/engine.js';
import type { GameSummary } from '../shared/room-types.js';
import { getTileCanvas, getMeepleCanvas } from './art.js';
import { h } from './dom.js';
import { me, refreshMe } from './session.js';
import { navigate, root } from './router.js';
import { paintMeepleSwatches } from './ui.js';

export function randomRoomId(): string {
  const adjectives = ['brave', 'swift', 'golden', 'stone', 'wild', 'noble', 'quiet', 'clever', 'lucky', 'crimson'];
  const animals = ['falcon', 'badger', 'fox', 'heron', 'wolf', 'raven', 'otter', 'stag', 'lynx', 'sparrow'];
  const a = adjectives[Math.random() * adjectives.length | 0];
  const b = animals[Math.random() * animals.length | 0];
  const n = Math.floor(10 + Math.random() * 90);
  return `${a}-${b}-${n}`;
}

export function bannerCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const w = 420, hgt = 150; c.width = w; c.height = hgt;
  const ctx = c.getContext('2d')!;
  const size = 96;
  const tiles = [
    { key: 'city_cap_road_curve_a', rot: 1 },
    { key: 'monastery_road', rot: 0 },
    { key: 'road_fork', rot: 0 },
    { key: 'city_four_shield', rot: 0 },
  ];
  tiles.forEach((t, i) => {
    const tc = getTileCanvas(t.key, t.rot, size);
    const x = i * (size + 6) + 8, y = (hgt - size) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.translate(x + size / 2, y + size / 2);
    ctx.rotate((i - 1.5) * 0.05);
    ctx.drawImage(tc, -size / 2, -size / 2, size, size);
    ctx.restore();
  });
  const mc = getMeepleCanvas(PLAYER_COLORS[0]!, 44, false);
  ctx.drawImage(mc, w - 60, hgt / 2 - 44, 44, 44);
  return c;
}

export async function mountHome(): Promise<void> {
  root.innerHTML = '';
  root.appendChild(h('div', { class: 'home' }, h('p', {}, 'Loading…')));
  await refreshMe();
  root.innerHTML = '';

  const authArea = me.signedIn
    ? h('div', { class: 'home-actions' },
        h('div', { class: 'home-card panel' },
          h('h3', {}, '🏰 Start a game'),
          h('p', {}, 'Create a fresh table and send the link to your friends.'),
          h('button', { class: 'primary', onclick: () => navigate(`/r/${randomRoomId()}`) }, 'Create game'),
        ),
        h('div', { class: 'home-card panel' },
          h('h3', {}, '🧭 Join a game'),
          h('p', {}, 'Got a link or a room code from a friend? Hop in.'),
          (() => {
            const input = h('input', { type: 'text', placeholder: 'e.g. brave-falcon-42' }) as HTMLInputElement;
            const go = () => { const v = input.value.trim().toLowerCase().replace(/^\/?r\//, ''); if (v) navigate(`/r/${v}`); };
            input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go(); });
            return h('div', { class: 'join-row' }, input, h('button', { onclick: go }, 'Join'));
          })(),
        ),
      )
    : h('div', { class: 'home-actions' },
        h('div', { class: 'home-card panel', style: 'align-items:center;text-align:center' },
          h('h3', {}, '⚔️ Ready to play?'),
          h('p', {}, 'Sign in to create or join a table. It takes a few seconds.'),
          h('button', { class: 'primary', onclick: () => { window.location.href = '/auth/login'; } }, me.devMode ? 'Continue (dev mode)' : 'Sign in to play'),
        ),
      );

  const footer = me.signedIn
    ? h('p', { class: 'home-footer' }, `Signed in as ${me.name}. `, h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); window.location.href = '/auth/logout'; } }, 'Sign out'), '.')
    : h('p', { class: 'home-footer' }, me.devMode ? 'Running in local dev mode — no real identity provider configured.' : 'No spam, no passwords stored by us — sign-in is handled by your identity provider.');

  const historyEl = me.signedIn ? h('div', { class: 'history panel', hidden: true }) : null;
  root.appendChild(h('div', { class: 'home' },
    h('div', { class: 'home-banner' }, bannerCanvas()),
    h('h1', { class: 'home-title display' }, 'Carcassonne'),
    h('p', { class: 'home-subtitle' }, 'Draw a tile, extend the land, place your meeple, and race your friends — or a table of NPCs — to claim the roads, cities, and cloisters of the countryside.'),
    authArea,
    historyEl,
    footer,
  ));
  if (historyEl) void fillHistory(historyEl);
}

/** Past games for the signed-in player, newest first, each with a replay link. */
export async function fillHistory(el: HTMLElement): Promise<void> {
  let games: { roomId: string; summary: GameSummary }[] = [];
  try { games = ((await (await fetch('/api/history')).json()) as { games: typeof games }).games ?? []; } catch { return; }
  if (!games.length) return;
  el.hidden = false;
  el.appendChild(h('h3', {}, '📜 Your games'));
  for (const { roomId, summary } of games.slice(0, 12)) {
    const top = Math.max(...summary.players.map((p) => p.score));
    const mine = summary.players.find((p) => p.id === me.sub);
    const won = !!mine && mine.score === top;
    el.appendChild(h('div', { class: 'history-row' },
      h('span', { class: 'history-when' }, new Date(summary.endedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
      h('span', { class: 'history-result' + (won ? ' won' : '') }, won ? '🏆 Won' : 'Lost'),
      h('span', { class: 'history-players' }, ...summary.players.map((p) => h('span', { class: 'history-player' + (p.score === top ? ' winner' : '') },
        h('canvas', { class: 'meeple-swatch', width: 14, height: 14, 'data-color': p.color }), ` ${p.name} ${p.score}`))),
      h('a', { href: `/r/${roomId}/replay/${summary.id}`, onclick: (e: Event) => { e.preventDefault(); navigate(`/r/${roomId}/replay/${summary.id}`); } }, '🎞 Replay'),
      h('a', { href: `/r/${roomId}`, onclick: (e: Event) => { e.preventDefault(); navigate(`/r/${roomId}`); } }, 'Table'),
    ));
  }
  paintMeepleSwatches(el);
}

export async function mountWelcome(): Promise<void> {
  root.innerHTML = '';
  await refreshMe();
  root.innerHTML = '';
  const next = new URLSearchParams(location.search).get('next') || '/';
  root.appendChild(h('div', { class: 'home' },
    h('h1', { class: 'home-title display' }, 'Welcome!'),
    h('p', { class: 'home-subtitle' }, "What should we call you at the table? You can change this later from the lobby."),
    h('form', { class: 'home-card panel', method: 'POST', action: '/auth/set-name', style: 'align-items:stretch;gap:1rem' },
      h('input', { type: 'hidden', name: 'next', value: next }),
      h('input', { type: 'text', name: 'name', placeholder: 'Your name', maxlength: 24, required: true, autofocus: true }),
      h('button', { class: 'primary', type: 'submit' }, "Let's play"),
    ),
  ));
}

// ---------------------------------------------------------------------------
// Room (lobby + game)
// ---------------------------------------------------------------------------
