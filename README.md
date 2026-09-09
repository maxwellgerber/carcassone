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
  (easy/normal/hard) from the lobby — it plays its own turns automatically via
  a Durable Object alarm, using the same rules engine as everyone else.
- Toggle game-mode variants in the lobby before starting: farm scoring,
  cloisters, the shield bonus, a shorter "quick game" deck (~36 tiles instead
  of 72), and meeples-per-player (5–9).
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

## Rummy solver (a side quest)

`/rummy` is a standalone page, unrelated to Carcassonne, that solves the
hand-partitioning problem in rummy: given your hand and the melds already on
the table, what can you do this turn? It lists every legal meld and lay-off,
finds the arrangement that leaves the least deadwood, ranks your discards, says
whether you can go out, and evaluates taking the top of the discard pile. The
situation is encoded in the URL hash so it can be shared.

The solver (`src/rummy/solver.ts`) is an integer program, after Den Hertog &
Hulshof's Rummikub formulation: one binary variable per candidate meld and per
lay-off card, one "used at most once" constraint per hand card, chain
constraints so a run can only be extended outward one card at a time, and an
objective that maximises melded points. It runs in the browser on
[YALPS](https://github.com/Ivordir/YALPS), a pure-JS MILP solver — a 13-card
hand is a few dozen variables and solves in well under a millisecond, so the
page re-solves on every click. By default the table may be rearranged
(every card already on the table must land in exactly one meld of the new
arrangement, so a run can be broken to free a card as long as what is left is
still valid); a toggle switches to lay-off-only rummy, which uses a second
formulation with chain constraints for extending runs. Other toggles: ace low,
ace high, and whether going out requires a discard. Single deck, no jokers.
The page ends with a step-by-step explainer of the program built for the
current hand, with switches the reader can flip to see constraints pass or
fail.

`npm run test:rummy` checks hand-picked situations and compares the integer
program against an independent brute-force search on 400 random hands.

## Bananagrams: "can I dump my hand?" (another side quest)

`/bananagrams` compares three integer-programming formulations of the same
question, all solved in the browser: **A**, letters only (choose words whose
letters add up to the tiles plus crossings; a relaxation, so its "yes" is a
guess); **B**, a one-shot grid model (word placements on an R×C board with
cell-agreement, every-run-is-a-word, every-tile-used, and a flow formulation
of connectivity; exact but large); and **C**, two-stage (A proposes a word
set, a small B tries to place exactly those words, a no-good cut forbids the
set if it fails). The page shows each model's answer, size, and solve time,
then explains all three from the live hand.

Solvers: `src/bananagrams/vendor/` carries [HiGHS](https://highs.dev) compiled
to WebAssembly by [highs-js](https://github.com/lovasoa/highs-js), embedded as
base64 so the page needs no runtime fetch; YALPS remains as a pure-JS fallback
and for comparison. Solving runs in a Web Worker. Word lists: a common-words
list (the 20k Google list filtered against ENABLE) and ENABLE up to eight
letters, in `src/bananagrams/data/`.

`npm run test:bananagrams` checks the models against an independent layout
verifier and each other on fixed and random hands.

## Run the test suite / lint / typecheck

```sh
npm run test        # typecheck + lint + engine tests + rummy solver tests
npm run test:engine  # just the engine correctness tests
npm run test:rummy   # just the rummy solver tests
npm run test:bananagrams  # the Bananagrams models (loads the HiGHS wasm in Node)
npm run lint
npm run typecheck
```

The engine tests check the trickiest parts of the rules directly (no
server/browser needed): placement legality and input validation, city/road/
monastery completion via cross-tile graph traversal, farm scoring, the exact
72-tile distribution, all game-mode variants, the pre-placed start tile, the
automatic meeple skip, and the "unplaceable tile is discarded" rule.

Two heavier checks are available on demand:

```sh
npx tsx scripts/simulate.ts 40        # 40 full NPC-vs-NPC games with invariants checked every move
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
  room.ts                  room document shape + the decoupled action layer
  npc.ts                   NPC move selection (easy/normal/hard)
  auth.ts                  OIDC (discovery + PKCE + JWKS verification) + dev-mode mock login
  registry.ts              KV-backed room registry (Durable Objects can't be enumerated)
src/client/
  main.ts                  routing, WebSocket sync, canvas board, all UI
  art.ts                   loads the SVG tile art + procedural meeples/tile-back
  audio.ts                 Web Audio soundtrack (the tune + all sound effects)
  skins/                   the selectable looks: geometry.ts (shared edge-contract drawing), one painter per skin
  tiles/*.svg              the 24 hand-illustrated tile types (the default skin)
  dom.ts                   tiny DOM builder helper
src/mcp/server.ts        MCP server exposing the game to agents (see above)
src/rummy/               the rummy solver page (/rummy): cards.ts, melds.ts, solver.ts (the ILP), main.ts (UI)
src/bananagrams/         the Bananagrams page (/bananagrams): ip.ts (model + YALPS/HiGHS backends), models.ts (the three formulations), main.ts (UI + worker)
static/                  index.html shell + styles.css (and rummy.html + rummy.css), copied as-is into the build
scripts/
  build-client.mjs         esbuild bundler for the client (app.js) and the rummy page (rummy.js)
  test-engine.ts           engine correctness tests
  test-rummy.ts            rummy solver tests (hand-picked cases + brute-force cross-check)
  simulate.ts              plays whole NPC games against the engine, checking invariants
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
