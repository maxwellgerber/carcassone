// Durable Objects have no enumeration API — there is no "list every GameRoom".
// This tiny KV-backed registry is what makes "list my rooms" / MCP room discovery
// possible at all; it must exist before any programmatic (MCP) room creation does,
// since it can't be reconstructed after the fact for rooms that predate it.
import type { GameSummary } from '../shared/room-types.js';

export interface RoomMeta {
  id: string;
  createdAt: number;
  createdBy: string;
}

export async function registerRoom(kv: KVNamespace | undefined, id: string, createdBy: string): Promise<void> {
  if (!kv) return;
  const meta: RoomMeta = { id, createdAt: Date.now(), createdBy };
  await kv.put(`room:${id}`, JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 90 });
}

/** Per-player game history, newest first by key order. Written once per finished
 *  game for every human at the table; the summary is enough for a results list and
 *  carries the room + game id needed to fetch a replay. */
export interface HistoryEntry { roomId: string; summary: GameSummary }

export async function recordHistory(kv: KVNamespace | undefined, roomId: string, summary: GameSummary): Promise<void> {
  if (!kv || !roomId) return;
  const entry: HistoryEntry = { roomId, summary };
  const order = String(9_999_999_999_999 - summary.endedAt).padStart(13, '0'); // newest sorts first
  for (const p of summary.players) {
    if (p.isNpc) continue;
    await kv.put(`hist:${p.id}:${order}:${summary.id}`, JSON.stringify(entry), { expirationTtl: 60 * 60 * 24 * 365 });
  }
}

export async function listHistory(kv: KVNamespace | undefined, playerId: string, limit = 30): Promise<HistoryEntry[]> {
  if (!kv) return [];
  const list = await kv.list({ prefix: `hist:${playerId}:`, limit });
  const out: HistoryEntry[] = [];
  for (const k of list.keys) {
    const v = await kv.get(k.name);
    if (v) out.push(JSON.parse(v) as HistoryEntry);
  }
  return out;
}

export async function listRooms(kv: KVNamespace | undefined, limit = 100): Promise<RoomMeta[]> {
  if (!kv) return [];
  const list = await kv.list({ prefix: 'room:', limit });
  const metas: RoomMeta[] = [];
  for (const k of list.keys) {
    const v = await kv.get(k.name);
    if (v) metas.push(JSON.parse(v) as RoomMeta);
  }
  return metas.sort((a, b) => b.createdAt - a.createdAt);
}
