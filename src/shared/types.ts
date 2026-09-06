// Shared types used by the engine, the server, and the client. No I/O, no framework deps.

export type EdgeType = 'C' | 'R' | 'F'; // City, Road, Field
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
  farmScoring: boolean;
  monasteryScoring: boolean;
  meeplesPerPlayer: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  farmScoring: true,
  monasteryScoring: true,
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
