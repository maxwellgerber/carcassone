// The full Worker environment — bindings declared in wrangler.toml plus secrets/vars
// set via `wrangler secret put` / `.dev.vars`. Single source of truth so auth.ts,
// room-do.ts, and worker.ts never disagree about what's available.
export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  ROOM_REGISTRY?: KVNamespace;
  USER_PROFILES?: KVNamespace;
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_REDIRECT_URI?: string;
  SESSION_SECRET?: string;
  MCP_SERVICE_TOKEN?: string;
}
