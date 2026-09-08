// Shared-future continuations: play a position forward under the frozen deployment
// policy (the shipped 'normal' bot for every seat) with the remaining tile order
// drawn from one seed and the policy's own dice from another. Two candidate actions
// continued with the same tile seed see the same draws, so the difference between
// their outcomes is far less noisy than two independent playouts would be
// (common random numbers); keeping policy randomness on a separate stream means a
// different number of policy rolls along one path cannot scramble the pairing.
import * as E from '../src/shared/engine.js';
import { chooseNpcMeepleMove, chooseNpcTilePlacement, evaluateFor, NPC_TUNING } from '../src/server/npc.js';
import { mkRng } from '../src/shared/rng.js';
import type { GameState } from '../src/shared/types.js';

export interface Continuation { value: number; terminal: boolean; plies: number }

/** Margin for `me` against the best other seat, in points. */
export function margin(state: GameState, me: number): number {
  const scores = state.players.map((p) => p.score);
  return scores[me]! - Math.max(...scores.filter((_, i) => i !== me));
}

/** Continue `state` for up to `maxPlies` moves (a ply = one tile or one meeple decision).
 *  Returns the final margin if the game ends, else the deployment evaluation of the
 *  reached position from `me`'s seat (in points), so both are on one scale. */
export function playOut(state: GameState, me: number, tileSeed: number, policySeed: number, maxPlies: number, evaluator: typeof NPC_TUNING.evaluator = 'blend'): Continuation {
  const st = E.cloneState(state);
  const tiles = mkRng(tileSeed);
  // Reshuffle the unseen bag under the tile seed; the current tile is already known.
  for (let i = st.deck.length - 1; i > 0; i--) { const j = Math.floor(tiles() * (i + 1)); [st.deck[i], st.deck[j]] = [st.deck[j]!, st.deck[i]!]; }
  const dice = mkRng(policySeed);
  const saved = NPC_TUNING.evaluator;
  NPC_TUNING.evaluator = evaluator;
  let plies = 0;
  try {
    while (st.phase !== 'gameover' && plies < maxPlies) {
      if (st.phase === 'placeTile') { const p = chooseNpcTilePlacement(st, 'normal', dice); E.placeTile(st, p.x, p.y, p.rot); }
      else { const mv = chooseNpcMeepleMove(st, 'normal', dice); if (mv.type === 'place_meeple') E.placeMeeple(st, mv.kind, mv.idx); else E.skipMeeple(st); }
      plies++;
    }
    if (st.phase === 'gameover') return { value: margin(st, me), terminal: true, plies };
    return { value: evaluateFor(st, me), terminal: false, plies };
  } finally {
    NPC_TUNING.evaluator = saved;
  }
}

/** Every complete action from a tile-placement root: placement plus the meeple reply
 *  (each option, and skipping), as the resulting state and a readable label. */
export function completeActions(root: GameState): { label: string; state: GameState; placement: { x: number; y: number; rot: number }; meeple: string }[] {
  const out: { label: string; state: GameState; placement: { x: number; y: number; rot: number }; meeple: string }[] = [];
  for (const p of E.getLegalPlacements(root)) {
    const after = E.cloneState(root);
    E.placeTile(after, p.x, p.y, p.rot);
    if (after.phase !== 'placeMeeple') { out.push({ label: `${p.x},${p.y} r${p.rot} · —`, state: after, placement: p, meeple: '-' }); continue; }
    const skipped = E.cloneState(after); E.skipMeeple(skipped);
    out.push({ label: `${p.x},${p.y} r${p.rot} · skip`, state: skipped, placement: p, meeple: 'skip' });
    for (const o of E.getMeepleOptions(after)) {
      const s = E.cloneState(after); E.placeMeeple(s, o.kind, o.idx);
      out.push({ label: `${p.x},${p.y} r${p.rot} · ${o.kind}${o.idx}`, state: s, placement: p, meeple: `${o.kind}${o.idx}` });
    }
  }
  return out;
}

/** Replay a self-play record up to (not including) the `stopAt`-th action, or to a
 *  random tile-placement decision when `stopAt` is undefined. */
export interface Rec { seed: number; n: number; config: { farmScoring: boolean; quickGame: boolean; river: boolean }; actions: (number | string)[][]; scores: number[] }
export function rootFromRecord(rec: Rec, stopAt: number, DECK_SALT: number): GameState {
  const g = E.createGame(Array.from({ length: rec.n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isNpc: true })), mkRng((rec.seed ^ DECK_SALT) >>> 0), rec.config);
  for (let k = 0; k < stopAt && k < rec.actions.length; k++) {
    const a = rec.actions[k]!;
    if (a[0] === 't') E.placeTile(g, a[1] as number, a[2] as number, a[3] as number);
    else if (a[0] === 'm') E.placeMeeple(g, a[1] as 'city', a[2] as number);
    else E.skipMeeple(g);
  }
  return g;
}
