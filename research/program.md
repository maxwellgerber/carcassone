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
- `research/reference-weights.ts` — the frozen opponent (gen-0 weights), fed by
  `research/reference-features.ts`, a frozen copy of the encoder it was trained
  with. Encoder experiments therefore change only the candidate's inputs.
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

1. Proxy experiment: keep if `val_mse` drops by ≥ 0.0015 (three times the seed-to-seed
   noise of 0.0005 measured on the baseline), else revert.
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

## Findings so far (gen 1, 2,000 local games, 373k positions)

- Batch size was the big lever under a fixed budget: 64 → 2048 took val_mse
  0.1055 → 0.0971 (exp 1–4); 4096 gave nothing more.
- Width, depth, a smaller net, stronger L2, cosine decay, input standardisation,
  and bag-composition features all failed to clear the 0.0015 bar on this data.
  Standardising inputs actively hurt (0.106): the encoding is sparse and the
  zeros carry meaning.
- The training loop's allocation-free rewrite doubles throughput (10 epochs in
  the budget instead of 5) but the small net has converged by epoch 5 on this
  data, so it only pays once there is more data or a bigger net that helps.
- Conclusion: data-limited. Next generation of data (8,000 games from Actions)
  before more training experiments.

## Collision check (gen 1, 40 roots, `research/collisions.ts`)

- 83 complete actions per root; **96% share an encoding with at least one other
  action** (460 groups, mean size 6.9). The net's top choice is a forced tie at
  **70%** of roots (tie size ~5), so the shipped search breaks most of its
  decisions by enumeration order.
- The hand heuristic separates only 5% of those tie groups by > 0.5 pt: it pools
  the same way, so it is not the blend's tie-breaker.
- Most groups are near-equivalent (median shared-future spread 0.25 pt), but 4 of
  60 checked hide 1.7-3.2 pt differences with zero heuristic spread: which farm
  region a farmer lands in, which rotation of a tile next to a city, where an
  unclaimed-feature tile goes. Those are decisions no amount of training can fix
  with this encoding.
- Implication: the encoding sees only claimed features. Geometry that matters is
  invisible: unclaimed features and their adjacency to claimed ones, distinct
  empty cells per opening, fillability of specific openings, farm-to-city
  adjacency by ownership. Those are the next encoder experiments, judged on the
  benchmark regret first.

## Strength transfer (exp 4 candidate vs gen-0 reference)

win 0.490 vs 0.308, margin +2.05 vs -2.09, z = 3.8 over 400 seats. Promoted to the
shipped weights. The proxy improvement from batch size did carry to play.

## Regret vs MSE (gen 1b, local 60-root benchmark, 8 futures x 20 plies)

| evaluator | mean regret | pairwise acc | val_mse |
|---|---|---|---|
| hand heuristic | 0.66 | 96.5% | ~0.119 |
| net v1 (exp 4, shipped) | 1.05 | 92.3% | 0.097 |
| blend v1 | 0.73 | 96.8% | — |
| net v2 encoder (exp 17) | 0.84 | 91.9% | 0.108 |
| blend v2 | 0.68 | 97.5% | — |
| random | 3.0 | 50% | — |

The heuristic makes better move choices than the net despite a much worse
absolute error (Tesauro's point: errors that cancel across siblings do not hurt
selection). The v2 encoder, rejected on budgeted MSE, chooses better than v1.
Rule change: encoder and target experiments are judged on benchmark regret
(train pairs from the Actions benchmark, evaluate on the held-out local one),
with MSE reported, and promotion still by the strength gate. Label noise: the
half-split disagreement is 2.8 pts against a 6.1 pt root spread at 8 futures;
the Actions benchmark uses 12 futures x 30 plies.

## Residual target (exp 18, gen 1b)

r = z - H trained on the same data, deployed as H + alpha r: val_mse 0.1005 (vs 0.0999
for the plain value net), regret 0.87 at alpha 1 and 0.75 at alpha 0.5 (hand 0.66,
blend 0.73) on the 60-root benchmark. No better than blending; reverted. The
60-root benchmark is too small to separate 0.66 from 0.75 — the 1,600-root Actions
benchmark is needed for any of these calls.

## Encoder v2 strength (exp 17 candidate vs gen-0 reference)

win 0.485 vs 0.313, margin +2.46 vs -2.51, z = 3.6 — the same decisive margin the
shipped v1 net has over the reference (0.490/0.308, +2.05/-2.09), despite v2's
worse budgeted MSE (0.1076 vs 0.0999). Head-to-head v2 vs shipped v1 is running.
