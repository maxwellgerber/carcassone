import { QUICK_GAME_TILE_COUNT, PLAYER_COLORS } from '../shared/engine.js';
import type { RoomDoc } from '../shared/room-types.js';
import type { GameConfig, NpcDifficulty } from '../shared/types.js';
import { getTileCanvasIn } from './art.js';
import { h, toast } from './dom.js';
import { currentSkin, setSkin, SKINS } from './skins/index.js';
import { me } from './session.js';
import { currentRoomId, room, send } from './room.js';

export function renderLobby(): HTMLElement {
  const r = room!;
  const isHost = r.hostId === me.sub;
  const link = `${location.origin}/r/${currentRoomId}`;

  const playerList = h('div', { class: 'player-list panel' },
    h('h2', {}, `Players (${r.players.length}/6)`),
    ...r.players.map((p) => h('div', { class: 'player-row' },
      h('canvas', { class: 'meeple-swatch', width: 22, height: 22, 'data-color': p.color }),
      p.id === me.sub
        ? h('input', { class: 'name-edit', type: 'text', value: p.name, maxlength: 24, onchange: (e: Event) => send({ type: 'set_name', name: (e.target as HTMLInputElement).value }) })
        : h('span', { style: 'flex:1' }, p.name + (p.isNpc ? ` (NPC · ${p.npcDifficulty})` : '')),
      p.id === r.hostId ? h('span', { class: 'host-badge' }, 'HOST') : null,
      p.id === me.sub ? h('span', { class: 'you-badge' }, 'YOU') : null,
      !p.connected && !p.isNpc ? h('span', { class: 'offline-dot', title: 'offline' }, '●') : null,
      isHost && p.isNpc ? h('button', { class: 'ghost small', onclick: () => send({ type: 'remove_npc', npcId: p.id }) }, '✕') : null,
    )),
    r.players.length < 2 ? h('p', { style: 'color:var(--ink-soft);font-size:0.85rem' }, isHost ? 'Waiting for at least one more player… or seat an NPC.' : 'Waiting for at least one more player…') : null,
    isHost ? h('div', { class: 'npc-row' },
      h('span', { class: 'npc-row-label' }, '🤖 Seat an NPC'),
      ...(['easy', 'normal', 'hard'] as NpcDifficulty[]).map((d) =>
        h('button', { class: 'small', disabled: r.players.length >= 6, onclick: () => send({ type: 'add_npc', difficulty: d }) }, `+ ${d[0]!.toUpperCase()}${d.slice(1)}`)),
    ) : null,
  );

  const usedColors = new Set(r.players.filter((p) => p.id !== me.sub).map((p) => p.color));
  const meColor = r.players.find((p) => p.id === me.sub)?.color;
  const colorPicker = h('div', { class: 'panel' },
    h('h2', { style: 'padding:1rem 1.2rem 0' }, 'Your colour'),
    h('div', { class: 'color-swatches' }, ...PLAYER_COLORS.map((c) => h('div', {
      class: `color-dot${meColor === c ? ' selected' : ''}${usedColors.has(c) ? ' taken' : ''}`,
      style: `background:${c}`,
      onclick: () => { if (!usedColors.has(c)) send({ type: 'set_color', color: c }); },
      title: usedColors.has(c) ? 'taken' : 'pick this colour',
    }))),
  );


  const modesPanel = h('div', { class: 'panel modes-banner' },
    h('h2', { style: 'font-size:1rem' }, '⚙️ Game modes'),
    h('div', { class: 'modes-grid' },
      ...configToggle(r, isHost, 'farmScoring', 'Fields', 'Farmers claim fields and score 3 points per completed city their field supplies, at the end of the game.'),
      ...configToggle(r, isHost, 'river', 'The River', 'Twelve river tiles are laid first, from the spring to the lake. The river must keep flowing and may not double back.'),
      ...configToggle(r, isHost, 'quickGame', 'Quick game', `A shorter game: about ${QUICK_GAME_TILE_COUNT} regular tiles instead of 72.`),
    ),
  );

  const skinPanel = h('div', { class: 'panel', style: 'padding:1rem 1.2rem' },
    h('h2', { style: 'font-size:1rem' }, '🎨 Pick your look'),
    h('p', { style: 'color:var(--ink-soft);font-size:0.85rem;margin:0 0 0.6rem' }, 'Four tilesets, each with its own palette. Your choice is just for your screen — everyone at the table can pick their own.'),
    h('div', { class: 'skin-grid' }, ...SKINS.map((sk) => {
      const preview = h('canvas', { width: 64, height: 64 }) as HTMLCanvasElement;
      const card = h('button', { class: `skin-card${sk.id === currentSkin().id ? ' selected' : ''}`, title: sk.blurb, onclick: () => setSkin(sk.id) },
        preview, h('span', {}, sk.name));
      queueMicrotask(() => { preview.getContext('2d')!.drawImage(getTileCanvasIn(sk.id, 'city_cap_road_curve_a', 64), 0, 0); });
      return card;
    })),
  );

  const rules = h('div', { class: 'rules-card panel' },
    h('h3', {}, 'How to play'),
    h('p', {}, 'On your turn, place the drawn tile so its edges match its neighbours, then optionally place one meeple by clicking a ghost on that tile: a ', h('b', {}, 'knight'), ' in a city, a ', h('b', {}, 'highwayman'), ' on a road, a ', h('b', {}, 'monk'), ' in a cloister, or a ', h('b', {}, 'farmer'), ' in a field.'),
    h('p', {}, 'Completed cities score 2 pts per tile and 2 per coat of arms, roads 1 pt per tile, cloisters 9 pts. Unfinished features score 1 per tile at the end. Fields score 3 pts per completed city they supply — tallied at the very end.'),
  );

  return h('div', { class: 'lobby' },
    h('div', { class: 'lobby-header' },
      h('h1', {}, 'The Table Is Set'),
      h('div', { class: 'room-code-row' },
        h('span', { class: 'room-code' }, currentRoomId!),
        h('button', { class: 'small', onclick: () => { navigator.clipboard?.writeText(link); toast('Link copied!'); } }, '🔗 Copy invite link'),
      ),
    ),
    modesPanel,
    h('div', { class: 'lobby-body' },
      playerList,
      h('div', { class: 'lobby-side' },
        isHost
          ? h('button', { class: 'primary start-btn', disabled: r.players.length < 2, onclick: () => send({ type: 'start' }) }, r.players.length < 2 ? 'Need 2+ players' : `Start game (${r.players.length} players)`)
          : h('p', { style: 'text-align:center;color:var(--ink-soft)' }, 'Waiting for the host to start the game…'),
        colorPicker,
        skinPanel,
        rules,
      ),
    ),
  );
}

export function configToggle(r: RoomDoc, isHost: boolean, key: keyof GameConfig, label: string, desc: string): HTMLElement[] {
  const checked = !!r.config[key];
  return [h('label', { class: 'mode-toggle', style: 'cursor:' + (isHost ? 'pointer' : 'default') },
    h('input', {
      type: 'checkbox', checked, disabled: !isHost,
      onchange: (e: Event) => send({ type: 'set_config', config: { [key]: (e.target as HTMLInputElement).checked } }),
    }),
    h('span', {}, h('strong', {}, label), h('br', {}), h('span', { style: 'color:var(--ink-soft);font-size:0.82rem' }, desc)),
  )];
}
