# Carcassonne, on the web

A full multiplayer implementation of the Carcassonne base game (72 tiles, cities,
roads, cloisters, and farms — including end-game farm scoring), built to run on
Cloudflare Workers with Durable Objects powering real-time game rooms.

- Create a game, get a shareable link (`/r/<room-id>`), send it to friends.
- Everyone connects over a WebSocket to a per-room Durable Object, which is the
  single source of truth for game state (server-validated moves, so nobody can
  cheat via the browser console).
- All art (tiles, meeples, banners) is drawn procedurally on `<canvas>` — no
  external image assets, so there's nothing that can fail to load.
- The game engine (`public/shared/engine.js` + `tiles.js`) is a single, pure,
  dependency-free JS module imported unmodified by both the server (Worker /
  Durable Object) and the browser — no build step, no bundler.

## Run it locally

```sh
npm install   # first time only, pulls down wrangler
npm run dev   # starts wrangler dev on http://localhost:8787
```

Open the URL, click "Create game", and send the `/r/...` link to a second
browser (or a private window — identity is a random id in `localStorage`, so
two tabs in the *same* browser profile will be treated as the same player).

## Run the engine test suite

```sh
npm run test:engine
```

This checks the trickiest parts of the rules directly (no server/browser
needed): placement legality, city/road/monastery completion via cross-tile
graph traversal, and farm scoring against completed cities.

## Deploy

```sh
npx wrangler login   # one-time, opens a browser to authorize your Cloudflare account
npm run deploy
```

That's it — `wrangler.toml` already declares the Durable Object binding and the
static asset directory (`public/`), so `wrangler deploy` provisions everything
in one shot. No environment variables or external services required.

## Project layout

```
public/shared/tiles.js    tile definitions + geometry (edges, city/road groups, field regions)
public/shared/engine.js   pure game engine: legality, turn flow, scoring — shared by server + client
public/art.js             procedural canvas art for tiles and meeples
public/app.js             client: routing, WebSocket sync, canvas board, all UI
src/room-do.js            Durable Object: one game room, authoritative state, WebSocket fan-out
src/worker.js             routes /api/room/*/ws to the right Durable Object; everything else is static assets
scripts/test-engine.js    engine correctness tests (run with `npm run test:engine`)
scripts/bot.js            dev-only helper: a second "player" over a raw WebSocket, for local testing
```
