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
  lastActivityAt: number;
  /** Sequence number of the last event folded into this document (0 = none). The
   *  room is the fold of its event log; this snapshot just saves replaying it. */
  seq: number;
  /** Event seq of the `start` that began the game in progress, and its seed. */
  gameStart?: { seq: number; seed: number };
  gameStartedAt?: number;
  /** Finished games in this room, newest last. */
  games: GameSummary[];
}

/** One recorded mutation. `seed` drives every random choice the action makes and
 *  `ts` is its clock, so folding the same events again yields the identical room. */
export interface RoomEvent {
  seq: number;
  ts: number;
  playerId: string;
  seed: number;
  action: Action | InternalAction;
}

/** Actions the server raises itself (socket lifecycle); never accepted from clients. */
export type InternalAction =
  | { type: 'disconnect' }
  | { type: 'leave' }
  | { type: 'system_note'; text: string };

export interface GameSummary {
  id: string;
  /** 1-based index of this game within the room. */
  no: number;
  startedAt: number;
  endedAt: number;
  config: GameConfig;
  /** Exactly what createGame was handed, in seat order, plus final scores. */
  players: { id: string; name: string; color: string; isNpc?: boolean; npcDifficulty?: NpcDifficulty; score: number }[];
  winnerIds: string[];
  seed: number;
  firstSeq: number;
  lastSeq: number;
  tilesPlaced: number;
}

/** What a replay needs: the recorded seed and the in-game actions, in order. */
export interface ReplayDoc {
  roomId: string;
  summary: GameSummary;
  moves: { seq: number; ts: number; playerId: string; action: Extract<Action, { type: 'place_tile' | 'place_meeple' | 'skip_meeple' }> }[];
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
