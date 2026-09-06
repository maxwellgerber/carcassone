export { GameRoom } from './room-do.js';
import { getSession, handleCallback, handleDevLogin, handleLogin, handleLogout, handleSetName, isDevMode } from './auth.js';
import { listRooms } from './registry.js';
import type { Env } from './env.js';

function normalizeRoomId(id: string | undefined): string {
  return (id ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
}

interface VerifiedIdentity { id: string; name: string; }

/** Agents (the MCP server) authenticate with a shared service token rather than an
 *  OIDC session — a browser can't complete an interactive login, and an agent isn't
 *  a human with a consent screen to click through. The token proves the request came
 *  from our trusted MCP gateway; the gateway self-asserts which agent it's acting as,
 *  namespaced under `agent-` so it can never collide with a real OIDC subject. This
 *  is the same "verified header, DO trusts it exclusively" model as human sessions —
 *  just a different front door onto it. Disabled entirely unless MCP_SERVICE_TOKEN
 *  is configured, so it's inert by default. */
function verifyAgent(request: Request, env: Env): VerifiedIdentity | null {
  if (!env.MCP_SERVICE_TOKEN) return null;
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${env.MCP_SERVICE_TOKEN}`) return null;
  const agentId = request.headers.get('X-Agent-Id');
  if (!agentId || !/^[a-zA-Z0-9_-]{1,64}$/.test(agentId)) return null;
  const name = (request.headers.get('X-Agent-Name') ?? agentId).slice(0, 24);
  return { id: `agent-${agentId}`, name };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // --- Auth routes -------------------------------------------------------
    if (url.pathname === '/auth/login') {
      if (isDevMode(env)) return handleDevLogin(request, env);
      if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID) {
        return new Response('OIDC is not configured for this deployment (OIDC_ISSUER / OIDC_CLIENT_ID missing). See README > Authentication.', { status: 500 });
      }
      return handleLogin(request, env);
    }
    if (url.pathname === '/auth/callback') return handleCallback(request, env);
    if (url.pathname === '/auth/set-name') return handleSetName(request, env);
    if (url.pathname === '/auth/logout') return handleLogout();

    if (url.pathname === '/api/me') {
      const session = await getSession(request, env);
      return Response.json({ signedIn: !!session, sub: session?.sub ?? null, name: session?.name ?? null, devMode: isDevMode(env) });
    }
    if (url.pathname === '/api/rooms') {
      const session = verifyAgent(request, env) ?? (await getSession(request, env));
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
      const rest = url.pathname.slice('/api/room/'.length);
      const [rawId, sub] = rest.split('/');
      const roomId = normalizeRoomId(rawId);
      if (!roomId || !sub || !['ws', 'action', 'state'].includes(sub)) return new Response('not found', { status: 404 });

      const agent = sub !== 'ws' ? verifyAgent(request, env) : null; // agents use the RPC surface, never hold a WS open
      let identity: VerifiedIdentity;
      if (agent) {
        identity = agent;
      } else {
        const session = await getSession(request, env);
        if (!session || !session.name) return new Response('Unauthorized', { status: 401 });
        identity = { id: session.sub, name: session.name };
      }

      const id = env.GAME_ROOM.idFromName(roomId);
      const stub = env.GAME_ROOM.get(id);
      const forwardHeaders = new Headers(request.headers);
      forwardHeaders.set('X-Verified-User-Id', identity.id);
      forwardHeaders.set('X-Verified-User-Name', identity.name);
      const forwarded = new Request(request.url, { method: request.method, headers: forwardHeaders, body: request.body });
      return stub.fetch(forwarded);
    }

    return env.ASSETS.fetch(request);
  },
};
