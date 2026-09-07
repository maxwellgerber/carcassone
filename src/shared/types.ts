// Shared types used by the engine, the server, and the client. No I/O, no framework deps.

export type EdgeType = 'C' | 'R' | 'F' | 'V'; // City, Road, Field, riVer
export type Side = 0 | 1 | 2 | 3; // N, E, S, W
export type MeepleKind = 'city' | 'road' | 'monastery' | 'farm';

export interface TileType {
  key: string;
  label: string;
  edges: [EdgeType, EdgeType, EdgeType, EdgeType];
  cityGroups: number[][]; // groups of side-indices that form one connected city region
  roadGroups: number[][]; // groups of side-indices that form one connected road segment
  fieldRegions: FieldRegion[];
  slotToRegion: number[]; // length 8, canonical slot -> fieldRegions index, or -1 if a city slot
  shield: boolean;
  monastery: boolean;
  count: number;
  /** River expansion tile: placed before the base deck, must continue the river. */
  river: boolean;
  /** 'spring' is the first tile of the river (it replaces the start tile), 'lake' the last. */
  riverRole?: 'spring' | 'lake';
}

export interface FieldRegion {
  slots: number[]; // canonical (unrotated) half-edge slot indices, 0..7
  cityGroups: number[]; // canonical cityGroups indices this region touches
}

export interface PlacedTile {
  tileKey: string;
  rot: number; // 0..3, number of 90-degree clockwise turns
  placedBy: number; // player index
  placedTurn: number;
}

export type Board = Record<string, PlacedTile>; // key: "x,y"

export interface Meeple {
  playerIdx: number;
  x: number;
  y: number;
  kind: MeepleKind;
  idx: number; // canonical cityGroups/roadGroups index, fieldRegions index, or 0 for monastery
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  meeples: number;
  score: number;
  isNpc?: boolean;
  npcDifficulty?: NpcDifficulty;
}

export type NpcDifficulty = 'easy' | 'normal' | 'hard';

/** Game-mode / rule-variant toggles. Every field must have a safe default so older
 *  persisted rooms without a `config` at all still behave exactly as before. */
export interface GameConfig {
  /** Fields: farmers score 3 per completed city they supply at the end (rules 3.0 include this; it's the classic on/off). */
  farmScoring: boolean;
  /** The River mini-expansion: 12 river tiles laid first, spring to lake, before the base deck. */
  river: boolean;
  quickGame: boolean; // roughly half the deck, for a shorter game (a house rule)
  // The following are fixed by the rules and no longer offered in the lobby; they stay
  // on the type so older rooms and the engine's own tests keep working unchanged.
  monasteryScoring: boolean;
  shieldBonus: boolean; // coats of arms are always worth 2 points (1 unfinished)
  meeplesPerPlayer: number; // 7
}

export const DEFAULT_CONFIG: GameConfig = {
  farmScoring: true,
  river: false,
  quickGame: false,
  monasteryScoring: true,
  shieldBonus: true,
  meeplesPerPlayer: 7,
};

export type GamePhase = 'placeTile' | 'placeMeeple' | 'gameover';

export interface LastPlaced {
  x: number;
  y: number;
  rot: number;
}

export interface GameState {
  schemaVersion: 2;
  config: GameConfig;
  players: PlayerState[];
  currentPlayer: number;
  deck: string[];
  currentTile: string | null;
  currentRot: number;
  board: Board;
  meeples: Meeple[];
  phase: GamePhase;
  log: string[];
  turnNumber: number;
  lastPlaced: LastPlaced | null;
  winnerIds: string[] | null;
  /** River: the turn the last river tile made (1 = right, 3 = left, 0 = straight/none), so
   *  the next curve can be forbidden from doubling back. Absent in games without the river. */
  riverLastTurn?: number;
  /** One entry per scoring line in `log`, so the client can show *where* points came
   *  from. `seq` is the log entry's position counted from the oldest entry (log grows
   *  by unshift, so `log.length - 1 - index` finds it). Absent on rooms from before this. */
  scoreEvents?: ScoreEvent[];
}

export interface ScoreEvent {
  seq: number;
  players: number[];
  points: number;
  kind: 'city' | 'road' | 'monastery' | 'farm';
  /** Tiles of the scored feature (for a farm: the field's tiles). */
  tiles: string[];
  /** Farm only: tiles of the completed cities that fed it. */
  fedTiles?: string[];
}

export interface PlayerInfo {
  id: string;
  name: string;
  color?: string;
  isNpc?: boolean;
  npcDifficulty?: NpcDifficulty;
}

export interface Placement {
  x: number;
  y: number;
  rot: number;
}

export interface MeepleOption {
  kind: MeepleKind;
  idx: number;
  label: string;
}
