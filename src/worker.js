export { GameRoom } from './room-do.js';

function normalizeRoomId(id) {
  return (id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/room/')) {
      const rest = url.pathname.slice('/api/room/'.length); // "<id>/ws"
      const [rawId, sub] = rest.split('/');
      const roomId = normalizeRoomId(rawId);
      if (!roomId || sub !== 'ws') return new Response('not found', { status: 404 });
      const id = env.GAME_ROOM.idFromName(roomId);
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
