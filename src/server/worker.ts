export { GameRoom } from './room-do.js';
import { getSession, handleCallback, handleDevLogin, handleLogin, handleLogout, handleSetName, isDevMode } from './auth.js';
import { listRooms } from './registry.js';
import type { Env } from './env.js';

function normalizeRoomId(id: string | undefined): string {
  return (id ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // --- Auth routes -------------------------------------------------------
    if (url.pathname === '/auth/login') return isDevMode(env) ? handleDevLogin(request, env) : handleLogin(request, env);
    if (url.pathname === '/auth/callback') return handleCallback(request, env);
    if (url.pathname === '/auth/set-name') return handleSetName(request, env);
    if (url.pathname === '/auth/logout') return handleLogout();

    if (url.pathname === '/api/me') {
      const session = await getSession(request, env);
      return Response.json({ signedIn: !!session, sub: session?.sub ?? null, name: session?.name ?? null, devMode: isDevMode(env) });
    }
    if (url.pathname === '/api/rooms') {
      const session = await getSession(request, env);
      if (!session) return new Response('Unauthorized', { status: 401 });
      const rooms = await listRooms(env.ROOM_REGISTRY);
      return Response.json({ rooms });
    }

    // --- Gate room routes (the landing page itself is public) --------------
    const isAppRoute = url.pathname.startsWith('/r/');
    if (isAppRoute) {
      const session = await getSession(request, env);
      if (!session) return Response.redirect(new URL(`/auth/login?next=${encodeURIComponent(url.pathname)}`, url), 302);
      if (!session.name) return Response.redirect(new URL(`/welcome?next=${encodeURIComponent(url.pathname)}`, url), 302);
    }
    if (url.pathname === '/welcome') {
      const session = await getSession(request, env);
      if (!session) return Response.redirect(new URL('/auth/login', url), 302);
      // signed-in-but-unnamed falls through to the static welcome page below
    }

    // --- Room WebSocket + RPC, forwarded to the Durable Object with a
    //     server-verified identity — the DO never trusts anything the client sent. --
    if (url.pathname.startsWith('/api/room/')) {
      const session = await getSession(request, env);
      if (!session || !session.name) return new Response('Unauthorized', { status: 401 });
      const rest = url.pathname.slice('/api/room/'.length);
      const [rawId, sub] = rest.split('/');
      const roomId = normalizeRoomId(rawId);
      if (!roomId || !sub || !['ws', 'action', 'state'].includes(sub)) return new Response('not found', { status: 404 });
      const id = env.GAME_ROOM.idFromName(roomId);
      const stub = env.GAME_ROOM.get(id);
      const forwardHeaders = new Headers(request.headers);
      forwardHeaders.set('X-Verified-User-Id', session.sub);
      forwardHeaders.set('X-Verified-User-Name', session.name);
      const forwarded = new Request(request.url, { method: request.method, headers: forwardHeaders, body: request.body });
      return stub.fetch(forwarded);
    }

    return env.ASSETS.fetch(request);
  },
};
