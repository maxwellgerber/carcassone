# Autoresearch: the learned evaluator

An autonomous research loop in the style of Karpathy's `autoresearch`: one
editable experiment file, a frozen harness, one scalar metric under a fixed
budget, and an agent that proposes, edits, runs, keeps or reverts, and logs.

## What is frozen

- `research/prepare.ts` — replays self-play game records through the engine and
  encodes them with `src/server/features.ts` into a binary train/val split, split
  by game. Re-run only when the encoder changes or a new data generation lands.
- `research/eval.ts` — strength: candidate-blend vs a frozen reference net on
  seeded 2p and 3p tourneys. Same seeds every run.
- `research/reference-weights.ts` — the frozen opponent (gen-0 weights).
- The metric definitions and the time budget.

## What the loop edits

- `research/train.ts` (architecture, optimiser, schedule, batch, loss, regularisation).
- `src/server/features.ts` (the encoding), followed by a `prepare` re-run. Because
  the metric is on re-encoded data, encoder experiments compare on the same games.
- `src/server/npc.ts` search knobs (only measured by strength, never by the proxy).

## Metrics and budget

- **Proxy**: `val_mse` from `research/train.ts` under a 90 s wall-clock budget on
  this 4-core box. Lower is better. This is the fast loop (~2 min per experiment
  including load).
- **Strength**: `research/eval.ts` win rate and margin vs the reference, 80 games
  each at 2p and 3p (~10 min). Run when the proxy improves by ≥ 0.001, or for any
  change that the proxy cannot see (search, blending, feature semantics).

## Keep rule

1. Proxy experiment: keep if `val_mse` drops by ≥ 0.0005 (noise floor measured by
   re-running the baseline with different seeds), else revert.
2. Strength experiment: keep if candidate win rate exceeds the reference's by more
   than one standard error (gate.ts `z > 1`) with a positive margin, else revert.
3. A kept change is committed with its metric in the message and a row in
   `research/results.tsv`. A reverted change still gets a row.

## Data generations

Self-play data comes from the current best bot with 12% exploration. When the
bot improves meaningfully (a strength keep), a new generation is played
(`scripts/selfplay.ts --records`, locally or via the Self-play data GitHub
workflow), `prepare` is re-run, and the proxy baseline is re-measured. Results
across generations are not comparable; the log notes the generation.

## Log format

`research/results.tsv`: `id  gen  kind  description  val_mse  strength  verdict  commit`
