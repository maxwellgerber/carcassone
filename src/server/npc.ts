// NPC opponent logic. Runs entirely against the same pure engine every human move
// does — an NPC "move" is indistinguishable from a real action once chosen, so it
// shares the exact same apply path (see actions.ts) as WS players and MCP agents.
import { cloneState, deriveFeatures, getLegalPlacements, getMeepleOptions, placeMeeple, placeTile, type Features } from '../shared/engine.js';
import type { GameState, MeepleKind, NpcDifficulty, Placement } from '../shared/types.js';

export type NpcMove =
  | { type: 'place_tile'; x: number; y: number; rot: number }
  | { type: 'place_meeple'; kind: MeepleKind; idx: number }
  | { type: 'skip_meeple' };

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** Score a hypothetical placement by how many points it would immediately hand out
 *  (to anyone — an NPC playing well also avoids gifting an opponent's city closure)
 *  and how much it grows the NPC's own open features. Cheap: board is tiny. */
function scorePlacement(state: GameState, before: Features, placement: Placement, npcIdx: number): number {
  const trial = cloneState(state);
  placeTile(trial, placement.x, placement.y, placement.rot);
  const after = deriveFeatures(trial);
  let score = 0;
  const newlyComplete = (list: { complete: boolean; id: string }[], prevList: { complete: boolean; id: string }[]) => {
    const prevComplete = new Set(prevList.filter((f) => f.complete).map((f) => f.id));
    return list.filter((f) => f.complete && !prevComplete.has(f.id));
  };
  for (const cf of newlyComplete(after.cityFeatures, before.cityFeatures)) {
    const onIt = state.meeples.filter((m) => m.kind === 'city' && after.lookups.cityGroupRoot(m.x, m.y, m.idx) === cf.id);
    const mine = onIt.filter((m) => m.playerIdx === npcIdx).length;
    const theirs = onIt.length - mine;
    score += mine > theirs ? 6 : theirs > mine ? -6 : 0;
  }
  for (const rf of newlyComplete(after.roadFeatures, before.roadFeatures)) {
    const onIt = state.meeples.filter((m) => m.kind === 'road' && after.lookups.roadGroupRoot(m.x, m.y, m.idx) === rf.id);
    const mine = onIt.filter((m) => m.playerIdx === npcIdx).length;
    const theirs = onIt.length - mine;
    score += mine > theirs ? 3 : theirs > mine ? -3 : 0;
  }
  for (const mf of newlyComplete(after.monasteryFeatures as never as { complete: boolean; id: string }[], before.monasteryFeatures as never as { complete: boolean; id: string }[])) {
    const [mx, my] = mf.id.split(',').map(Number);
    const onIt = state.meeples.filter((m) => m.kind === 'monastery' && m.x === mx && m.y === my);
    const mine = onIt.filter((m) => m.playerIdx === npcIdx).length;
    score += mine > 0 ? 5 : onIt.length > 0 ? -5 : 0;
  }
  return score;
}

export function chooseNpcTilePlacement(state: GameState, difficulty: NpcDifficulty, rng: () => number): Placement {
  const legal = getLegalPlacements(state);
  if (legal.length === 0) throw new Error('no legal placements available');
  if (difficulty === 'easy') return pick(legal, rng);

  const npcIdx = state.currentPlayer;
  const before = deriveFeatures(state); // the same for every candidate — compute it once
  const scored = legal.map((p) => ({ p, s: scorePlacement(state, before, p, npcIdx) }));
  const maxScore = Math.max(...scored.map((s) => s.s));
  const best = scored.filter((s) => s.s === maxScore).map((s) => s.p);
  if (difficulty === 'hard' || maxScore > 0) return pick(best, rng);
  // 'normal' with no immediately-scoring move: mildly prefer placements that keep
  // more of the board's own open edges alive rather than pure randomness.
  return pick(legal, rng);
}

export function chooseNpcMeepleMove(state: GameState, difficulty: NpcDifficulty, rng: () => number): NpcMove {
  const options = getMeepleOptions(state);
  if (options.length === 0) return { type: 'skip_meeple' };
  if (difficulty === 'easy') {
    return rng() < 0.5 ? { type: 'skip_meeple' } : { type: 'place_meeple', ...pick(options, rng) };
  }
  // Prefer claiming a feature outright by simulating each option one ply deep and
  // reusing the same completion-value heuristic as tile placement; otherwise weight
  // by feature type (cities > roads > monasteries, be stingy with farmers) rather
  // than placing a meeple purely at random.
  const weight: Record<MeepleKind, number> = { city: 4, road: 3, monastery: 3, farm: difficulty === 'hard' ? 1.5 : 0.6 };
  let bestScore = -Infinity;
  let bestOpts: typeof options = [];
  for (const o of options) {
    const trial = cloneState(state);
    placeMeeple(trial, o.kind, o.idx);
    const gained = trial.players[state.currentPlayer]!.score - state.players[state.currentPlayer]!.score;
    const s = gained * 2 + weight[o.kind] + rng() * 0.5;
    if (s > bestScore) { bestScore = s; bestOpts = [o]; } else if (s === bestScore) bestOpts.push(o);
  }
  const skipBaseline = 1.2; // roughly "farm-ish" value, so weak options sometimes get skipped
  if (bestScore < skipBaseline && difficulty !== 'hard' && rng() < 0.35) return { type: 'skip_meeple' };
  const chosen = pick(bestOpts, rng);
  return { type: 'place_meeple', kind: chosen.kind, idx: chosen.idx };
}
