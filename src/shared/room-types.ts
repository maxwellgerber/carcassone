// Room-document and action types shared between the server (room.ts, room-do.ts)
// and the client (which only ever sees these shapes over the wire, never runs the
// mutating logic itself).
import type { GameConfig, GameState, NpcDifficulty } from './types.js';

export interface RoomPlayer {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  spectator?: boolean;
  isNpc?: boolean;
  npcDifficulty?: NpcDifficulty;
}

export interface ChatEntry {
  id: string;
  system?: boolean;
  playerId?: string;
  name?: string;
  color?: string;
  text: string;
  ts: number;
}

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export interface RoomDoc {
  schemaVersion: 2;
  phase: RoomPhase;
  players: RoomPlayer[];
  hostId: string | null;
  game: GameState | null;
  config: GameConfig;
  chat: ChatEntry[];
  createdAt: number;
}

export type Action =
  | { type: 'join'; name: string }
  | { type: 'set_name'; name: string }
  | { type: 'set_color'; color: string }
  | { type: 'set_config'; config: Partial<GameConfig> }
  | { type: 'add_npc'; difficulty: NpcDifficulty }
  | { type: 'remove_npc'; npcId: string }
  | { type: 'start' }
  | { type: 'place_tile'; x: number; y: number; rot: number }
  | { type: 'place_meeple'; kind: 'city' | 'road' | 'monastery' | 'farm'; idx: number }
  | { type: 'skip_meeple' }
  | { type: 'new_game' }
  | { type: 'chat'; text: string };
