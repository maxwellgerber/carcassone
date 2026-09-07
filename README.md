# Carcassonne, on the web

A full multiplayer implementation of the Carcassonne base game — cities, roads,
cloisters, farms, selectable game-mode variants, and NPC opponents — built in
TypeScript to run on Cloudflare Workers with Durable Objects powering
real-time game rooms, gated behind real OIDC authentication (with a
batteries-included local dev mode), and playable by autonomous agents via an
MCP server.

- Create a game, get a shareable link (`/r/<room-id>`), send it to friends.
- Sign-in is required to play: any standards-compliant OIDC provider in
  production, or an automatic local mock login in dev — see **Authentication**
  below. First-time sign-in asks for a display name once; it's remembered
  across devices.
- No friends around, or hit an agent usage limit? Add an NPC opponent
  (easy: random; normal: one-ply search over a position evaluation that values
  meeples in hand; hard: the same plus short Monte Carlo rollouts under a time
  cap) from the lobby — it plays its own turns automatically via
  a Durable Object alarm, using the same rules engine as everyone else.
- Game modes follow the 3.0 rulebook: cloisters are always in play, coats of
  arms are always worth 2 points, everyone has 7 meeples. The lobby offers the
  rules' real variables — **Fields** (farmers) and **The River** (12 river
  tiles laid first, source to lake, continuing the river and never bending
  back the way the last bend went) — plus a "quick game" house rule (~36
  regular tiles instead of 72).
- Tiles are hand-illustrated SVGs in the "Verdigris Gearworks" style (patinated
  brass, cross-hatch shading, chamfered corners) — see `docs/tile-geometry-contract.md`
  for how independently-drawn tiles are guaranteed to line up at every edge. The
  deck is the exact 72-tile, 24-type distribution of the physical base game, with
  the start tile already on the table when play begins.
- Meeples are placed on the board itself: after your tile lands, every feature you
  could claim shows a ghost meeple in your colour — click one, or skip. If nothing
  on the tile can take a meeple, the turn moves on without asking.
- Four looks to choose from, each a complete tileset with its own palette: the
  hand-illustrated **Verdigris Gearworks** default, plus three painted on the fly
  by the client against the same edge contract (`src/client/skins/`): **Parchment
  Atlas** (sepia ink on foxed paper), **Neon Grid** (a rain-slick night city), and
  **Storybook Meadow** (pink castles and flower-strewn fields). Pick one in the
  lobby or from the ⚙️ menu; it's per screen, remembered in localStorage, and any
  skin's tiles seam with any other's.
- Sound: a looping lute-and-pipe tune in D Dorian and effects for tiles landing,
  meeples, scoring, your turn, and game over — all synthesised in the browser with
  the Web Audio API (`src/client/audio.ts`), nothing to download. Music and effects
  toggle independently from the ⚙️ menu on the board; the choice is remembered.
- Everyone connects over a WebSocket to a per-room Durable Object, the single
  source of truth for game state. The server never trusts anything the client
  claims about its own identity — the Worker verifies the session (or an
  agent's service token) and injects a trusted identity header before the
  Durable Object ever sees the request.
- Agents can play too: `src/mcp/server.ts` exposes the game as MCP tools
  (`create_room`, `place_tile`, `get_legal_moves`, …) against the same
  authoritative Durable Object every human uses — see **MCP server** below.
- The game engine (`src/shared/`) is pure, dependency-free TypeScript imported
  unmodified by the server, the browser, and the NPC/MCP logic.
- Idle rooms clean themselves up: a Durable Object alarm resets any room's
  storage after 7 days with no activity.

## Run it locally

```sh
npm install         # first time only
cp .dev.vars.example .dev.vars   # first time only — enables dev-mode auth
npm run build       # bundles the client (esbuild) into dist/client
npm run dev          # starts wrangler dev on http://localhost:8787
```

Open the URL and click through — with `.dev.vars`'s `ENVIRONMENT=development`
set, the app runs in **dev mode**: "sign in" is a one-click mock login (no
network round trip to a real IDP), so nothing is ever blocked on having a real
identity provider to develop against. Without that flag, dev mode is disabled
even if OIDC isn't configured — see **Authentication** for why that matters.

To test a second player locally: identity comes from a signed session cookie
(not `localStorage`), so two tabs in the same browser profile really are two
different people as long as you dev-login as a different name in each — dev
mode mints a stable per-browser-profile id the first time and remembers it, so
use two separate browser profiles/incognito windows for two distinct local dev
identities. Or just add an NPC instead.

## Authentication

Dev mode (`ENVIRONMENT=development`, see `.dev.vars.example`) is **opt-in**,
not a fallback for "OIDC happens to be unconfigured" — it's gated this way on
purpose. Dev-mode sessions are signed with a secret that's hardcoded in
`src/server/auth.ts` (visible in source control), so if it ever activated in a
real deployment, anyone could forge a valid session for any user. A deployment
without `ENVIRONMENT=development` and without OIDC configured fails closed
with a clear 500 on `/auth/login`, rather than silently running insecurely.

For a real deployment, set (see **Deploy checklist** below for exactly how):

- `OIDC_ISSUER` — your IDP's issuer URL (must serve
  `/.well-known/openid-configuration`)
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET` — omit for a public/PKCE-only client
- `OIDC_REDIRECT_URI` — `https://<your-deployed-domain>/auth/callback`
- `SESSION_SECRET` — a random string used to sign session cookies

The client is a generic OIDC Relying Party using Authorization Code + PKCE via
discovery — no vendor-specific code, works against Auth0, Okta, Entra ID, or
any other standards-compliant IDP.

## MCP server

`src/mcp/server.ts` runs as its own process (stdio transport) and talks to the
same Worker every human uses, via a small RPC surface on the Durable Object
(`/api/room/:id/action` and `/state`) rather than a second protocol. Each
running instance is one agent identity — run multiple instances (each with a
different `AGENT_ID`) to seat several agents at the same table, including
against human players or NPCs.

```sh
export CARCASSONNE_BASE_URL=http://localhost:8787   # or your deployed URL
export MCP_SERVICE_TOKEN=...                         # must match the server's
export AGENT_ID=my-agent
export AGENT_NAME="My Agent"                         # optional, defaults to AGENT_ID
npm run mcp
```

The server only accepts agent connections if `MCP_SERVICE_TOKEN` is configured
on the Worker (see **Deploy checklist**) — it's inert by default. Tools:
`create_room`, `join_room`, `list_rooms`, `get_state`, `get_legal_moves`,
`start_game`, `add_npc`, `place_tile`, `place_meeple`, `skip_meeple`, `chat`.

## Run the test suite / lint / typecheck

```sh
npm run test        # typecheck + lint + engine tests
npm run test:engine  # just the engine correctness tests
npm run lint
npm run typecheck
```

The engine tests check the trickiest parts of the rules directly (no
server/browser needed): placement legality and input validation, city/road/
monastery completion via cross-tile graph traversal, farm scoring, the exact
72-tile distribution, all game-mode variants, the pre-placed start tile, the
automatic meeple skip, the River's deck order and placement rules, and the
"unplaceable tile is discarded" rule.

Two heavier checks are available on demand:

```sh
npx tsx scripts/simulate.ts 40        # 40 full NPC-vs-NPC games with invariants checked every move
npx tsx scripts/tourney.ts --games 60 # easy/normal/hard (and the pre-rewrite bots) at 2-5 player tables:
                                      # win rate, margin, meeples kept in hand, time per move
node scripts/play-in-browser.mjs      # two humans + an NPC clicking through a real game in headless
                                      # Chromium against `npm run dev` (needs playwright-core; see the file)
```

## Deploy checklist

Everything here needs your Cloudflare account — none of it can be done for
you without you present. In order:

1. **Log in**: `npx wrangler login`
2. **Create the two KV namespaces** (room enumeration + display names):
   ```sh
   npx wrangler kv namespace create ROOM_REGISTRY
   npx wrangler kv namespace create USER_PROFILES
   ```
   Each prints an id — replace the two `REPLACE_WITH_REAL_KV_ID` placeholders
   in `wrangler.toml` with them.
3. **Set secrets** (never go in `wrangler.toml`):
   ```sh
   npx wrangler secret put SESSION_SECRET       # e.g. `openssl rand -base64 32`
   npx wrangler secret put OIDC_CLIENT_SECRET   # skip for a public/PKCE-only IDP client
   npx wrangler secret put MCP_SERVICE_TOKEN    # skip if you don't want agent access yet
   ```
4. **Set non-secret OIDC config** — uncomment and fill in the `[vars]` block
   in `wrangler.toml` (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI`
   pointing at your real deployed domain). Leave `ENVIRONMENT` unset/out of
   `wrangler.toml` entirely — that's what keeps dev mode off in production.
5. **Register the redirect URI** (`https://<your-domain>/auth/callback`) with
   your IDP's client configuration.
6. **Deploy**: `npm run deploy` (builds the client, then `wrangler deploy`).
7. **Smoke test**: visit the deployed URL, confirm `/auth/login` redirects to
   your real IDP (not a dev-mode form), complete a login, pick a name, create
   a room, and play a turn.

`wrangler deploy --dry-run` is safe to run any time before step 6 — it
validates the Worker bundles correctly without touching your account.

## Project layout

```
src/shared/            pure game engine + types — imported by server, client, and NPC/MCP logic
  tiles.ts               tile definitions + geometry (the frozen edge/rotation contract)
  engine.ts               legality, turn flow, scoring, game-mode variants
  types.ts, room-types.ts  shared type definitions
src/server/
  worker.ts               routes requests; the sole trust boundary for identity (human or agent)
  room-do.ts               Durable Object: hibernatable WebSockets, RPC surface, NPC alarm, idle cleanup
  room.ts                  room document shape + the decoupled action layer; the event fold (applyEvent)
  npc.ts                   NPC move selection (easy/normal/hard): evaluation, one-ply search, rollouts
  features.ts, net.ts      the learned evaluator: feature-graph encoding and a tiny MLP (weights.ts is generated)
  auth.ts                  OIDC (discovery + PKCE + JWKS verification) + dev-mode mock login
  registry.ts              KV-backed room registry (Durable Objects can't be enumerated)
src/client/
  main.ts                  entry point: skin + router wiring, first render
  router.ts, session.ts    URL routing; who is signed in
  home.ts, lobby.ts        landing page (+ game history), the pre-game lobby
  room.ts, replay.ts       WebSocket sync + reactions to state changes; replay scrubbing
  game-view.ts             the in-game layout: board wrap, input handling, sidebar, end modal
  board.ts, camera.ts      canvas board renderer (tiles, highlights, spotlight, particles); pan/zoom maths
  placement.ts, spots.ts   two-tap tile placement, meeple markers and their points; where meeples stand on a tile
  wander.ts, life.ts       meeples walking their features; pokes and small talk
  ambient.ts               the living board: light, weather, birds, smoke, fireflies
  prefs.ts, ui.ts, hooks.ts  saved preferences; small shared widgets; window.__carcassonne for the playthrough script
  art.ts                   loads the SVG tile art + procedural meeples/tile-back
  audio.ts                 Web Audio soundtrack (the tune + all sound effects)
  skins/                   the selectable looks: geometry.ts (shared edge-contract drawing), one painter per skin
  tiles/*.svg              the 24 hand-illustrated tile types (the default skin)
  dom.ts                   tiny DOM builder helper
src/mcp/server.ts        MCP server exposing the game to agents (see above)
static/                  index.html shell + styles.css, copied as-is into the build
scripts/
  build-client.mjs         esbuild bundler for the client
  test-engine.ts           engine correctness tests
  simulate.ts              plays whole NPC games against the engine, checking invariants
  tourney.ts               measures the NPC brains against each other (legacy-npc.ts is the old one)
  test-room.ts             the event log rebuilds the room; a replay reproduces the final board
  selfplay.ts, train.ts    generate self-play data and train the learned evaluator
  play-in-browser.mjs      drives a real game through the UI in headless Chromium
  bot.ts                   dev-only: a second "player" over a raw WebSocket (logs in via dev mode first)
  generate-base-tile-svgs.ts  regenerates the locked tile-geometry skeletons (see docs/tile-geometry-contract.md)
docs/tile-geometry-contract.md  why independently-illustrated tiles still align
```

## Known follow-ups (tracked, not yet done)

- Real OIDC provider isn't wired up yet — needs actual issuer/client
  credentials from you (see **Deploy checklist**).
- No automated test coverage for `src/mcp/server.ts` itself (the underlying
  RPC surface it calls is covered; verified manually end-to-end instead —
  see git history).
