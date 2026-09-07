#!/usr/bin/env node
// MCP server exposing this Carcassonne deployment as tools, so agents can create
// rooms, join them, and play full games against each other (or against NPCs, or
// against humans) via MCP tool calls instead of a browser.
//
// Talks to the same Worker/Durable Object every human player uses, over the RPC
// surface at /api/room/:id/action and /state (src/server/room-do.ts) — not a
// second protocol. Each running instance of this server acts as exactly one
// agent identity; run one instance per agent (each with its own AGENT_ID) to
// have multiple agents at the same table.
//
// Required env: CARCASSONNE_BASE_URL, MCP_SERVICE_TOKEN (must match the Worker's
// configured token), AGENT_ID. Optional: AGENT_NAME (defaults to AGENT_ID).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getLegalPlacements, getMeepleOptions } from '../shared/engine.js';
import type { RoomDoc } from '../shared/room-types.js';

const BASE_URL = process.env.CARCASSONNE_BASE_URL ?? 'http://localhost:8787';
const SERVICE_TOKEN = process.env.MCP_SERVICE_TOKEN;
const AGENT_ID = process.env.AGENT_ID;
const AGENT_NAME = process.env.AGENT_NAME ?? AGENT_ID;

if (!SERVICE_TOKEN || !AGENT_ID) {
  console.error('CARCASSONNE MCP server: set MCP_SERVICE_TOKEN and AGENT_ID env vars (see README).');
  process.exit(1);
}

function roomHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${SERVICE_TOKEN}`,
    'X-Agent-Id': AGENT_ID!,
    'X-Agent-Name': AGENT_NAME!,
    'Content-Type': 'application/json',
  };
}

async function callAction(roomId: string, action: Record<string, unknown>): Promise<{ room?: RoomDoc; error?: string }> {
  const res = await fetch(`${BASE_URL}/api/room/${encodeURIComponent(roomId)}/action`, {
    method: 'POST', headers: roomHeaders(), body: JSON.stringify(action),
  });
  const body = (await res.json()) as { room?: RoomDoc; error?: string };
  if (!res.ok) return { error: body.error ?? `HTTP ${res.status}` };
  return body;
}

async function getState(roomId: string): Promise<RoomDoc> {
  const res = await fetch(`${BASE_URL}/api/room/${encodeURIComponent(roomId)}/state`, { headers: roomHeaders() });
  if (!res.ok) throw new Error(`get_state failed: HTTP ${res.status}`);
  const body = (await res.json()) as { room: RoomDoc };
  return body.room;
}

function text(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

const ADJECTIVES = ['brave', 'swift', 'golden', 'stone', 'wild', 'noble', 'quiet', 'clever', 'lucky', 'crimson'];
const ANIMALS = ['falcon', 'badger', 'fox', 'heron', 'wolf', 'raven', 'otter', 'stag', 'lynx', 'sparrow'];
function randomRoomId(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a}-${b}-${Math.floor(10 + Math.random() * 90)}`;
}

const server = new McpServer({ name: 'carcassonne', version: '1.0.0' });

server.tool('create_room', 'Create a new Carcassonne room and join it as this agent. Returns the room id and a shareable URL.', {
  gameConfig: z.object({ farmScoring: z.boolean().optional(), river: z.boolean().optional(), quickGame: z.boolean().optional() }).optional()
    .describe('Optional game-mode toggles, host-only and only settable before start.'),
}, async ({ gameConfig }) => {
  const roomId = randomRoomId();
  const joined = await callAction(roomId, { type: 'join', name: AGENT_NAME });
  if (joined.error) return text({ error: joined.error });
  if (gameConfig) await callAction(roomId, { type: 'set_config', config: gameConfig });
  return text({ roomId, url: `${BASE_URL}/r/${roomId}`, room: joined.room });
});

server.tool('join_room', 'Join an existing room by id as this agent (or reconnect if already seated). Joining a room already in progress makes you a spectator.', {
  roomId: z.string(),
}, async ({ roomId }) => text(await callAction(roomId, { type: 'join', name: AGENT_NAME })));

server.tool('list_rooms', 'List known rooms (most recently created first).', {}, async () => {
  const res = await fetch(`${BASE_URL}/api/rooms`, { headers: roomHeaders() });
  return text(await res.json());
});

server.tool('get_state', 'Get the full current state of a room: players, scores, board, whose turn it is, and the current tile.', {
  roomId: z.string(),
}, async ({ roomId }) => text(await getState(roomId)));

server.tool('get_legal_moves', "Get every legal tile placement for the current tile, and (if it's this agent's turn and a tile was just placed) the available meeple options. Use this before place_tile / place_meeple — the server rejects anything not in these lists.", {
  roomId: z.string(),
}, async ({ roomId }) => {
  const room = await getState(roomId);
  if (!room.game) return text({ error: 'Game has not started yet.' });
  const isMyTurn = room.game.players[room.game.currentPlayer]?.id === `agent-${AGENT_ID}`;
  return text({
    isMyTurn,
    phase: room.game.phase,
    currentTile: room.game.currentTile,
    legalPlacements: isMyTurn && room.game.phase === 'placeTile' ? getLegalPlacements(room.game) : [],
    meepleOptions: isMyTurn && room.game.phase === 'placeMeeple' ? getMeepleOptions(room.game) : [],
  });
});

server.tool('start_game', 'Start the game (host only, needs at least 2 players/NPCs in the lobby).', { roomId: z.string() }, async ({ roomId }) => text(await callAction(roomId, { type: 'start' })));

server.tool('add_npc', 'Add an NPC opponent to the lobby (host only, before start).', {
  roomId: z.string(), difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
}, async ({ roomId, difficulty }) => text(await callAction(roomId, { type: 'add_npc', difficulty })));

server.tool('place_tile', 'Place the current tile at (x, y) with the given rotation (0-3, 90-degree clockwise turns). Must be this agent\'s turn and phase "placeTile" — check get_legal_moves first. If nothing on the placed tile can take a meeple (or you have none left), the turn ends immediately and the phase moves on without a place_meeple/skip_meeple step — check get_state afterwards.', {
  roomId: z.string(), x: z.number().int(), y: z.number().int(), rot: z.number().int().min(0).max(3),
}, async ({ roomId, x, y, rot }) => text(await callAction(roomId, { type: 'place_tile', x, y, rot })));

server.tool('place_meeple', 'Place a meeple on the tile just placed. kind is one of city/road/monastery/farm; idx comes from get_legal_moves\' meepleOptions.', {
  roomId: z.string(), kind: z.enum(['city', 'road', 'monastery', 'farm']), idx: z.number().int(),
}, async ({ roomId, kind, idx }) => text(await callAction(roomId, { type: 'place_meeple', kind, idx })));

server.tool('skip_meeple', 'Decline to place a meeple on the tile just placed, ending the turn.', { roomId: z.string() }, async ({ roomId }) => text(await callAction(roomId, { type: 'skip_meeple' })));

server.tool('chat', 'Send a table-talk chat message visible to everyone in the room.', {
  roomId: z.string(), text: z.string().max(300),
}, async ({ roomId, text: msg }) => text(await callAction(roomId, { type: 'chat', text: msg })));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Carcassonne MCP server running as agent "${AGENT_NAME}" (${AGENT_ID}) -> ${BASE_URL}`);
