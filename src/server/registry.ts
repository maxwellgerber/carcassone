// Durable Objects have no enumeration API — there is no "list every GameRoom".
// This tiny KV-backed registry is what makes "list my rooms" / MCP room discovery
// possible at all; it must exist before any programmatic (MCP) room creation does,
// since it can't be reconstructed after the fact for rooms that predate it.
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
