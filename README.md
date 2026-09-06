# Carcassonne, on the web

A full multiplayer implementation of the Carcassonne base game — cities, roads,
cloisters, farms, selectable game-mode toggles, and NPC opponents — built in
TypeScript to run on Cloudflare Workers with Durable Objects powering real-time
game rooms, and gated behind real OIDC authentication (with a batteries-included
local dev mode).

- Create a game, get a shareable link (`/r/<room-id>`), send it to friends.
- Sign-in is required to play: any standards-compliant OIDC provider in
  production, or an automatic local mock login in dev — see **Authentication**
  below. First-time sign-in asks for a display name once; it's remembered
  across devices.
- No friends around, or hit an agent usage limit? Add an NPC opponent
  (easy/normal/hard) from the lobby — it plays its own turns automatically via
  a Durable Object alarm, using the same rules engine as everyone else.
- Toggle game modes in the lobby before starting (e.g. turn off farm scoring
  for a shorter game).
- Everyone connects over a WebSocket to a per-room Durable Object, the single
  source of truth for game state. The server never trusts anything the client
  claims about its own identity — the Worker verifies the session and injects
  a trusted identity header before the Durable Object ever sees the request.
- The game engine (`src/shared/`) is pure, dependency-free TypeScript imported
  unmodified by the server, the browser, and the NPC logic.
- Tile/meeple art is currently a procedural placeholder rendered on canvas in
  the "Verdigris Gearworks" palette; a hand-authored SVG pass is planned
  against the frozen tile-geometry contract in `src/shared/tiles.ts`.

## Run it locally

```sh
npm install         # first time only
npm run build       # bundles the client (esbuild) into dist/client
npm run dev          # starts wrangler dev on http://localhost:8787
```

Open the URL and click through — with no OIDC env vars set, the app runs in
**dev mode** automatically: "sign in" is a one-click mock login (no network
round trip to a real IDP), so nothing is ever blocked on having a real
identity provider to develop against.

To test a second player locally: identity now comes from a signed session
cookie (not `localStorage`), so two tabs in the same browser profile really
are two different people as long as you dev-login as a different name in
each — dev mode mints a stable per-browser-profile id the first time and
remembers it, so use two separate browser profiles/incognito windows for two
distinct local dev identities. Or just add an NPC instead.

## Authentication

Production needs four things, set via `wrangler secret put <NAME>` (secrets)
or `[vars]` in `wrangler.toml` (non-secret config):

- `OIDC_ISSUER` — your IDP's issuer URL (must serve
  `/.well-known/openid-configuration`)
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET` — omit for a public/PKCE-only client
- `OIDC_REDIRECT_URI` — e.g. `https://your-domain/auth/callback`
- `SESSION_SECRET` — a random string used to sign session cookies (`openssl
  rand -base64 32`)

The client is a generic OIDC Relying Party using Authorization Code + PKCE via
discovery — no vendor-specific code, works against Auth0, Okta, Entra ID, or
any other standards-compliant IDP. With `OIDC_ISSUER`/`OIDC_CLIENT_ID` unset,
the app falls back to dev mode automatically (see `src/server/auth.ts`).

You'll also want two KV namespaces before deploying (see `wrangler.toml`):

```sh
npx wrangler kv namespace create ROOM_REGISTRY
npx wrangler kv namespace create USER_PROFILES
```

Replace the placeholder ids in `wrangler.toml` with the ones each command
prints. `wrangler dev` simulates KV locally regardless of the id, so this
isn't needed for local development.

## Run the test suite / lint / typecheck

```sh
npm run test        # typecheck + lint + engine tests
npm run test:engine  # just the engine correctness tests
npm run lint
npm run typecheck
```

The engine tests check the trickiest parts of the rules directly (no
server/browser needed): placement legality and input validation, city/road/
monastery completion via cross-tile graph traversal, farm scoring, the
72-tile deck count, game-mode config, and the "unplaceable tile is discarded"
rule.

## Deploy

```sh
npx wrangler login    # one-time
npm run deploy        # builds the client, then wrangler deploy
```

## Project layout

```
src/shared/            pure game engine + types — imported by server, client, and NPC logic
  tiles.ts               tile definitions + geometry (the frozen edge/rotation contract)
  engine.ts               legality, turn flow, scoring
  types.ts, room-types.ts  shared type definitions
src/server/
  worker.ts               routes requests; the sole trust boundary for identity
  room-do.ts               Durable Object: hibernatable WebSockets, RPC surface, NPC alarm
  room.ts                  room document shape + the decoupled action layer
  npc.ts                   NPC move selection (easy/normal/hard)
  auth.ts                  OIDC (discovery + PKCE + JWKS verification) + dev-mode mock login
  registry.ts              KV-backed room registry (Durable Objects can't be enumerated)
src/client/
  main.ts                  routing, WebSocket sync, canvas board, all UI
  art.ts                   procedural canvas art (interim — see Art note above)
  dom.ts                   tiny DOM builder helper
static/                  index.html shell + styles.css, copied as-is into the build
scripts/
  build-client.mjs         esbuild bundler for the client
  test-engine.ts           engine correctness tests
  bot.ts                   dev-only: a second "player" over a raw WebSocket (logs in via dev mode first)
```

## Known follow-ups (tracked, not yet done)

- Hand-authored SVG tile/meeple art replacing the procedural placeholder.
- MCP server exposing room/move actions so agents can play full games against
  each other (the Durable Object's `/action` RPC endpoint and the
  transport-decoupled action layer in `room.ts` exist specifically to make
  this a thin wrapper rather than a second protocol).
- Idle-room cleanup (TTL-based) — rooms persist indefinitely today.
