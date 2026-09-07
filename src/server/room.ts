// Room document shape + the decoupled action layer. Every mutation to a room —
// whether triggered by a human over WebSocket, an NPC's own turn, or (later) an
// MCP-driven agent over RPC — goes through `applyAction`, so there is exactly one
// place that enforces "is this actually your turn" and exactly one place that can
// leave state inconsistent if it throws (handled by the DO via snapshot/rollback).
import { createGame, placeMeeple, placeTile, skipMeeple } from '../shared/engine.js';
import { PLAYER_COLORS } from '../shared/engine.js';
import type { GameConfig, NpcDifficulty } from '../shared/types.js';
import { DEFAULT_CONFIG } from '../shared/types.js';
import type { Action, ChatEntry, RoomDoc, RoomPhase, RoomPlayer } from '../shared/room-types.js';
import type { GameState } from '../shared/types.js';
export type { Action, ChatEntry, RoomDoc, RoomPhase, RoomPlayer } from '../shared/room-types.js';

export const MAX_PLAYERS = 6;
export const MAX_NPCS = 5; // leave room for at least one human

export function freshRoom(now: number): RoomDoc {
  return {
    schemaVersion: 2,
    phase: 'lobby',
    players: [],
    hostId: null,
    game: null,
    config: { ...DEFAULT_CONFIG },
    chat: [],
    createdAt: now,
    lastActivityAt: now,
  };
}

/** Migrate a room persisted under an older/missing schema so old rooms never crash
 *  the DO on load — they just get sane defaults for whatever's new. */
export function migrateRoom(raw: unknown, now: number): RoomDoc {
  if (!raw || typeof raw !== 'object') return freshRoom(now);
  const r = raw as Partial<RoomDoc> & Record<string, unknown>;
  if (r.schemaVersion === 2 && r.config) {
    if (typeof r.lastActivityAt !== 'number') r.lastActivityAt = now;
    r.config = { ...DEFAULT_CONFIG, ...(r.config as Partial<GameConfig>), monasteryScoring: true, shieldBonus: true, meeplesPerPlayer: 7 };
    return r as RoomDoc;
  }
  return {
    schemaVersion: 2,
    phase: (r.phase as RoomPhase) ?? 'lobby',
    players: Array.isArray(r.players) ? (r.players as RoomPlayer[]) : [],
    hostId: (r.hostId as string) ?? null,
    game: (r.game as GameState) ?? null,
    config: { ...DEFAULT_CONFIG, ...(r.config as Partial<GameConfig> | undefined) },
    chat: Array.isArray(r.chat) ? (r.chat as ChatEntry[]) : [],
    createdAt: (r.createdAt as number) ?? now,
    lastActivityAt: now,
  };
}

export class ActionError extends Error {}

function usedColors(room: RoomDoc): Set<string> {
  return new Set(room.players.map((p) => p.color));
}

export function pickColor(room: RoomDoc): string {
  const used = usedColors(room);
  return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[room.players.length % PLAYER_COLORS.length]!;
}

function pushSystemChat(room: RoomDoc, text: string, now: number, id: string): void {
  room.chat.push({ id, system: true, text, ts: now });
  if (room.chat.length > 200) room.chat.shift();
}

function currentPlayerId(room: RoomDoc): string | null {
  if (!room.game) return null;
  return room.game.players[room.game.currentPlayer]?.id ?? null;
}

/** Returns the id of the NPC whose turn it now is, if any, so the caller (the DO)
 *  can schedule an alarm to make their move — NPCs never act inline inside
 *  applyAction, keeping this function's effects fully synchronous and predictable. */
export function npcToActNext(room: RoomDoc): { id: string; difficulty: NpcDifficulty } | null {
  if (room.phase !== 'playing' || !room.game || room.game.phase === 'gameover') return null;
  const id = currentPlayerId(room);
  if (!id) return null;
  const p = room.players.find((pp) => pp.id === id);
  if (p?.isNpc) return { id: p.id, difficulty: p.npcDifficulty ?? 'normal' };
  return null;
}

export interface ApplyContext {
  now: number;
  rng: () => number;
  newId: () => string;
}

/** Shared by the WebSocket upgrade path and the MCP-facing RPC surface — anyone
 *  (human via a verified session, agent via a verified service credential) becomes
 *  a real player if the lobby has room, or a read-only spectator otherwise. */
function joinOrReconnect(room: RoomDoc, playerId: string, name: string, ctx: ApplyContext): void {
  const cleanName = name.trim().slice(0, 24) || 'Traveler';
  let player = room.players.find((p) => p.id === playerId);
  if (!player) {
    const spectator = room.phase !== 'lobby' || room.players.length >= MAX_PLAYERS;
    player = { id: playerId, name: cleanName, color: pickColor(room), connected: true, spectator };
    room.players.push(player);
    if (!room.hostId) room.hostId = playerId;
    pushSystemChat(room, spectator ? `${cleanName} is watching the game.` : `${cleanName} joined the game.`, ctx.now, ctx.newId());
  } else {
    player.connected = true;
    player.name = cleanName;
    pushSystemChat(room, `${player.name} reconnected.`, ctx.now, ctx.newId());
  }
}

/** Apply one action as `playerId`. Mutates `room` in place; throws ActionError (never
 *  a bare Error, so the DO can tell "rejected" apart from "actually crashed") if the
 *  action is illegal. The caller is responsible for persisting/broadcasting only on
 *  success — see room-do.ts's snapshot/rollback wrapper. */
export function applyAction(room: RoomDoc, playerId: string, action: Action, ctx: ApplyContext): void {
  if (action.type === 'join') {
    joinOrReconnect(room, playerId, action.name, ctx);
    return;
  }
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new ActionError('Unknown player — join the room first');

  switch (action.type) {
    case 'set_name': {
      const name = action.name.trim().slice(0, 24);
      if (name) player.name = name;
      return;
    }
    case 'set_color': {
      if (room.phase !== 'lobby') throw new ActionError('Colors are locked once the game starts');
      if (!PLAYER_COLORS.includes(action.color) || usedColors(room).has(action.color)) throw new ActionError('Color unavailable');
      player.color = action.color;
      return;
    }
    case 'set_config': {
      if (room.phase !== 'lobby') throw new ActionError('Game mode can only change in the lobby');
      if (playerId !== room.hostId) throw new ActionError('Only the host can change game modes');
      room.config = { ...room.config, ...sanitizeConfig(action.config) };
      return;
    }
    case 'add_npc': {
      if (room.phase !== 'lobby') throw new ActionError('Can only add NPCs before the game starts');
      if (playerId !== room.hostId) throw new ActionError('Only the host can add NPCs');
      if (room.players.length >= MAX_PLAYERS) throw new ActionError('Room is full');
      if (room.players.filter((p) => p.isNpc).length >= MAX_NPCS) throw new ActionError('Too many NPCs');
      const id = ctx.newId();
      room.players.push({
        id, name: npcName(room), color: pickColor(room), connected: true, isNpc: true,
        npcDifficulty: action.difficulty,
      });
      return;
    }
    case 'remove_npc': {
      if (room.phase !== 'lobby') throw new ActionError('Can only remove NPCs before the game starts');
      if (playerId !== room.hostId) throw new ActionError('Only the host can remove NPCs');
      room.players = room.players.filter((p) => p.id !== action.npcId || !p.isNpc);
      return;
    }
    case 'start': {
      if (room.phase !== 'lobby') throw new ActionError('Game already started');
      if (playerId !== room.hostId) throw new ActionError('Only the host can start the game');
      if (room.players.length < 2) throw new ActionError('Need at least 2 players');
      room.game = createGame(
        room.players.map((p) => ({ id: p.id, name: p.name, color: p.color, isNpc: p.isNpc, npcDifficulty: p.npcDifficulty })),
        ctx.rng,
        room.config,
      );
      room.phase = 'playing';
      pushSystemChat(room, 'The game has begun. Good luck!', ctx.now, ctx.newId());
      return;
    }
    case 'place_tile': {
      requireMyTurn(room, playerId);
      requireValidCoord(action.x, action.y, action.rot);
      placeTile(room.game!, action.x, action.y, action.rot);
      maybeEndGame(room, ctx);
      return;
    }
    case 'place_meeple': {
      requireMyTurn(room, playerId);
      placeMeeple(room.game!, action.kind, action.idx);
      maybeEndGame(room, ctx);
      return;
    }
    case 'skip_meeple': {
      requireMyTurn(room, playerId);
      skipMeeple(room.game!);
      maybeEndGame(room, ctx);
      return;
    }
    case 'new_game': {
      if (playerId !== room.hostId) throw new ActionError('Only the host can start a new game');
      if (room.phase !== 'ended') throw new ActionError('Game is not over');
      room.phase = 'lobby';
      room.game = null;
      pushSystemChat(room, 'Back to the lobby for a new game.', ctx.now, ctx.newId());
      return;
    }
    case 'chat': {
      const text = action.text.trim().slice(0, 300);
      if (!text) return;
      room.chat.push({ id: ctx.newId(), playerId, name: player.name, color: player.color, text, ts: ctx.now });
      if (room.chat.length > 200) room.chat.shift();
      return;
    }
  }
}

function requireValidCoord(x: unknown, y: unknown, rot: unknown): void {
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new ActionError('Invalid coordinates');
  if (!Number.isInteger(rot) || (rot as number) < 0 || (rot as number) > 3) throw new ActionError('Invalid rotation');
}

function requireMyTurn(room: RoomDoc, playerId: string): void {
  if (room.phase !== 'playing' || !room.game) throw new ActionError('Game is not in progress');
  if (currentPlayerId(room) !== playerId) throw new ActionError('Not your turn');
}

function maybeEndGame(room: RoomDoc, ctx: ApplyContext): void {
  if (room.game && room.game.phase === 'gameover' && room.phase !== 'ended') {
    room.phase = 'ended';
    pushSystemChat(room, 'The game has ended! Final scores are in.', ctx.now, ctx.newId());
  }
}

function sanitizeConfig(partial: Partial<GameConfig>): Partial<GameConfig> {
  const out: Partial<GameConfig> = {};
  // Only the rules' real variables are settable: Fields, the River, and the quick-game
  // house rule. Cloisters, coats of arms and the 7-meeple supply are fixed by the rules.
  if (typeof partial.farmScoring === 'boolean') out.farmScoring = partial.farmScoring;
  if (typeof partial.river === 'boolean') out.river = partial.river;
  if (typeof partial.quickGame === 'boolean') out.quickGame = partial.quickGame;
  return out;
}

function npcName(room: RoomDoc): string {
  const existing = new Set(room.players.filter((p) => p.isNpc).map((p) => p.name));
  const names = ['Sir Cogsworth', 'Dame Ratchet', 'Brother Gearwright', 'Lady Pinion', 'Old Foreman Vex'];
  return names.find((n) => !existing.has(n)) ?? `NPC ${room.players.filter((p) => p.isNpc).length + 1}`;
}
