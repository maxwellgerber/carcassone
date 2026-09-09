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

## Held-out benchmark (400 roots from the Actions run, 12 futures x 30 plies)

Label half-split disagreement 2.84 pts against a 6.99 pt root spread.

| evaluator | mean regret | pairwise acc | big misses (>1 pt, >2 SE) |
|---|---|---|---|
| random | 3.61 | 48% | 122/400 |
| net v1 (shipped weights) | 1.63 | 83.7% | 34 |
| hand | 1.30 | 89.8% | 23 |
| blend v1 (shipped) | 1.22 | 90.7% | 18 |
| net v2 encoder (exp 17) | 1.26 | 90.4% | 19 |
| blend v2 | 1.16 | 92.0% | 18 |
| net v1 + pairwise loss (exp 21) | 1.23 | 91.2% | 18 |
| blend v1 + pairwise | 1.15 | 91.5% | 16 |

Pairwise supervision from 1,200 labelled roots takes the net alone from 1.63 to
1.23 (the hand heuristic's level) with a barely changed MSE (0.1004 vs 0.0999),
which is the "supervise differences between moves" effect directly. The v2
encoder gives a similar gain through the other route. Both were rejected by the
MSE rule; from here, target and encoder experiments are kept on paired held-out
regret (`experiment.sh --metric regret`, keep if the blend's regret falls by more
than two standard errors of the paired difference).

Head-to-head, v2 candidate vs shipped v1 (seed 5151, 400 seats): win 0.423 vs 0.374,
margin +0.41 vs -0.45, z = 1.0. A small edge, not enough for promotion on its own;
v2 combined with the pairwise loss is being measured.

## Blend weight (strength, head-to-head vs shipped 0.5)

Net weight 0.75: win 0.278 vs 0.523, margin -4.88 vs +4.88, z = -5.2. Against the
frozen reference it had looked identical to 0.5 (both 0.49 win) — the reference is
too weak to separate them; head-to-heads decide. The heuristic's share in the
blend matters a lot; 0.25 is being tested next.

Net weight 0.25 vs shipped 0.5, head-to-head (seed 7171, 400 seats): win 0.627 vs
0.171, margin +9.70 vs -9.80, z = 10.5. The single largest effect in the study so
far. Sweeping 0.0 (pure heuristic) and 0.1 to find the optimum before promoting.

## Encoder v2 + pairwise (exp 28, pairs re-encoded)

Blend regret 1.144, Δ -0.075 ± 0.076 vs shipped: the same size of effect as v2
alone (-0.063) and pairwise alone (-0.066), none of them 2 SE on 400 roots.
Reverted.

## The benchmark is biased toward the evaluator that labelled it

Held-out regret of the shipped net at blend weight 0.25 is -0.021 ± 0.068 vs 0.5,
and +0.066 at 0.1 — flat — while head-to-head strength moves by z = 10 (0.25
wins 0.627 vs 0.171). The labels are 30-ply continuations valued by the
blend-0.5 evaluator itself, so any evaluator that agrees with blend-0.5 looks
good on them. Fix: label with terminal outcomes (continuations to the end of the
game). A 16 x 40-root run with plies=400 is queued (seed 300); the 30-ply sets
stay as a secondary signal.

Blend sweep, head-to-head vs shipped 0.5 (400 seats each, 2p + 3p):

| net weight | win | ref win | margin | z |
|---|---|---|---|---|
| 0.00 (pure heuristic) | 0.464 | 0.338 | +4.0 | 2.6 |
| 0.10 | 0.495 | 0.306 | +4.6 | 3.9 |
| 0.25 | 0.627 | 0.171 | +9.7 | 10.5 |
| 0.50 | — shipped — | | | |
| 0.75 | 0.278 | 0.523 | -4.9 | -5.2 |

Promoted: NPC_TUNING.blendNet = 0.25. Even the bare heuristic beat the 0.5 blend,
so the net at 0.5 was over-weighted; at 0.25 it adds a lot. Head-to-heads at
0.15 and 0.35 against the new default are next to locate the optimum.

Fine bracket vs the new 0.25 default: 0.15 → margin -0.20 (z -0.55), 0.35 → -0.29
(z -0.88). Flat within noise on either side; 0.25 stays.

## Candidates at blend 0.25, head-to-head vs the promoted bot

- encoder v2 (exp 17): win 0.433 vs 0.369, margin +0.55, z = 1.3 — below the gate.
- pairwise-trained net (exp 29, 2,400 roots): win 0.443 vs 0.356, margin +0.68,
  z = 1.8 — passes; promoted to the shipped weights. The recipe (value loss plus a
  pairwise difference loss every fourth batch) lives in research/patches
  (pairwise.patch) and is applied per experiment; the effect on 30-ply regret was
  small (-0.03 ± 0.04) but strength agrees in sign.

## Terminal-outcome benchmark (640 roots, 12 futures to game end)

Label half-split disagreement 4.69 pts vs 9.14 root spread (noisier than 30-ply,
as expected). Regret: hand 2.67, net v1 2.53, blend 0.5 2.36, blend 0.25 2.45
(+0.09 ± 0.07), shipped pairwise net alone 2.33, its blend 0.25 2.40. It does
not reproduce the head-to-head ordering (0.25 over 0.5 at z = 10). Conclusion:
per-root regret with a dozen futures is an order of magnitude less sensitive
than 400 games of self-play, which aggregate ~30,000 decisions. From here the
benchmark is training data (pairwise supervision, where it demonstrably helped:
exp 29 promoted on strength) and strength head-to-heads are the only gate.

## Heuristic knob: reserveValue (head-to-head vs shipped 7, blend 0.25)

5 → margin -1.07 (z -0.84); 9 → -0.28 (z 0.06). 7 stays.

## Encoder v2 + pairwise, trained on 18k games (gen1b + gen2), vs shipped

win 0.406 vs 0.395, margin +0.55, z = 0.22. The v2 encoder still does not turn
into strength, with or without pairwise supervision. Parked; the next lever is
the search side of the hard bot (rollout blend, static weight, shortlist size),
measured hard-vs-hard.

## Gen 2 round (18k games incl. 8k by the promoted bot, v1 encoder + pairwise) vs shipped

win 0.411 vs 0.367, margin +0.52, z = 0.87. Positive but under the gate. Net-side
changes are now worth about half a point each, consistent with the net being a
quarter of the blend; the heuristic's own terms are the bigger surface.

## Hard bot search: static weight (hard-vs-hard, 340 seats)

0.8 → win 0.385 vs 0.436, margin -0.11; 0.4 → 0.395 vs 0.427, margin +0.46. Flat;
0.6 stays. Next: rollouts 24 and shortlist 8 under the same 150 ms cap.

## Heuristic knob: opponent weighting (head-to-head vs shipped 0.7)

1.0 (strongest opponent only) → margin +0.18, z -0.22. 0.4 (leaning on the
average opponent) → win 0.434 vs 0.369, margin +1.23, z = 1.33. Promoted to 0.4;
bracketing with 0.0 and 0.2 against the new default.

Bracket vs 0.4: 0.0 → margin -0.09 (z -1.3), 0.2 → +0.14 (z 0.1). 0.4 stays.
Hard rollouts 24 vs 12 under the same cap: +0.72, z 0.4 (flat).

## Does the shipped bot beat the bare heuristic? (direct, seed 6161, 400 seats)

Pure heuristic (net weight 0, same knobs) vs shipped: 29.5% vs 50.5%, margin
-3.18 vs +3.18, z = -4.4. Yes: the learned quarter of the blend is worth about
three points a game over the heuristic alone.

## Running matches on another machine (research/worker.sh)

`research/queue.json` lists head-to-head jobs; `research/worker.sh [parallel]` runs
them P at a time on any machine with git and Node 22, writes one STRENGTH line
per job to `research/mac-results/<id>.out`, and pushes the results to the
`mac-results` branch. Finished jobs are skipped on re-runs, so it can be
stopped and restarted. Candidate weights live in `research/candidates/`.

## Mac run (12 cores, 2p only: 320 games = 640 seats per match, seeds 7001–7012)

Max ran `research/worker.sh` on an M4 and stopped it after the 2-player sets; the
raw tourney JSONs are on the `mac-results` branch (`eval-<pid>-2p.json`, matched to
jobs by seed = job seed + 2). Gate on the 2p files alone:

| candidate vs shipped | win | ref win | margin | z |
|---|---|---|---|---|
| **v2 encoder net (exp17)** | 56.1% | 43.6% | +1.46 | **3.19** |
| **blend 0.30** | 55.8% | 43.9% | +1.15 | **3.03** |
| farmOpenFactor 0.6 | 53.2% | 46.9% | +0.48 | 1.58 |
| reserveDecay 0.7 | 52.8% | 46.9% | +0.83 | 1.51 |
| blend 0.20 | 52.4% | 47.4% | +0.33 | 1.27 |
| oppBestWeight 0.3 | 52.0% | 48.0% | +0.86 | 1.03 |
| reserveDecay 0.5 | 51.4% | 48.6% | -0.04 | 0.71 |
| reserveValue 8 | 50.2% | 49.8% | +0.08 | 0.08 |
| gen2 pairwise net (v1) | 49.4% | 50.7% | -0.11 | -0.32 |
| oppBestWeight 0.5 | 49.4% | 50.6% | -0.04 | -0.32 |
| reserveValue 6 | 47.6% | 52.3% | -1.15 | -1.19 |

Two results clear the bar by a wide margin, and both had looked like +0.5, z ≈ 1
in the 400-seat container matches: the v2 encoder (three earlier tries all short of
the gate) and blend 0.30 (0.35 had been rejected). Caveats before promoting: these
are 2-player only, and with 11 tests at once one or two z ≈ 1.5 hits are expected
by chance. Both are being confirmed on fresh seeds at 2p+3p, separately and
combined, before anything ships. The 3 remaining queue jobs (farm 1.0, hard depth 6,
hard think 300) never started.

## Matches on GitHub Actions (.github/workflows/matches.yml)

The queue format is shared with the Mac worker. Each job is split into `shards`
runners that each play `games` per table size against the shipped bot with seed
`job.seed + 100·shard`; the bundle step pools the shards through `scripts/gate.ts`
and commits one line per job (plus the raw JSONs) to the `match-results` branch
under `results/<label>/`. 4 shards × 80 games = 1,600 seats per job, about an hour
of wall-clock at 20 parallel runners, and it costs nothing on a public repo.

## Confirmation round 1 on Actions (10 jobs × 1,600 seats, 2p+3p, seeds 9001–9010)

| candidate vs shipped (v1 exp29, blend 0.25) | win | ref win | margin | z |
|---|---|---|---|---|
| **v2 encoder net (exp17)** | 44.9% | 35.2% | +1.09 | **3.98** |
| **farmOpenFactor 0.6** | 46.6% | 33.1% | +1.41 | **5.54** |
| v2 encoder + blend 0.30 | 43.0% | 36.9% | +1.03 | 2.50 |
| hard depth 6 (hard-vs-hard) | 41.7% | 38.3% | +0.39 | 1.36 |
| blend 0.30 | 40.5% | 39.5% | +0.19 | 0.39 |
| reserveDecay 0.7 | 40.0% | 40.0% | +0.18 | 0.00 |
| oppBestWeight 0.3 | 38.9% | 41.1% | -0.05 | -0.92 |
| hard thinkMs 300 | 38.4% | 41.6% | -0.23 | -1.30 |
| blend 0.20 | 37.4% | 42.5% | -0.61 | -2.06 |
| farmOpenFactor 1.0 | 35.8% | 44.3% | -1.31 | -3.48 |

(Win rates pool 2p and 3p seats, so 40% is par.) The local 800-seat confirmations
agreed on the sign for every job they covered. Blend 0.30 was a 2p-only mirage:
flat at 2p+3p, and 0.20 is clearly worse, so 0.25 stays. The v2 encoder is real
and is now **promoted** (src/server/features.ts is the former research/encoder-v2.ts,
the v1 encoder is kept as research/encoder-v1.ts, weights are exp 17). Three
earlier 400-seat tries had put it at +0.5, z ≤ 1.3: the effect was there, the
matches were too small.

farmOpenFactor 0.6 beat 0.8 by the widest margin of anything measured so far
(farms are being over-valued while their cities are open), with 1.0 symmetric on the
losing side, so the bracket is clean. It was measured against the v1 net, so it is
re-tested on the promoted bot along with 0.5 and 0.4 (round 2) before shipping.

Workflow fix: the bundle step's glob `all/<id>-*p.json` also matched jobs whose id
extends another's (v2-encoder matched v2-encoder-blend-0.30); now `<id>-[0-9]*p.json`.

## Round 2 on Actions (vs the promoted v2 bot, 1,600 seats each, seeds 9101–9110)

| candidate vs shipped (v2 exp17, blend 0.25, farm 0.8) | win | ref win | margin | z |
|---|---|---|---|---|
| **farmOpenFactor 0.4** | 45.5% | 34.7% | +1.44 | **4.44** |
| farmOpenFactor 0.6 | 43.8% | 36.0% | +0.93 | 3.21 |
| farmOpenFactor 0.5 | 43.6% | 36.5% | +1.01 | 2.91 |
| **blend 0.35** | 43.9% | 36.0% | +1.00 | **3.22** |
| hard depth 6 | 41.5% | 38.6% | +0.31 | 1.19 |
| hard depth 3 | 40.4% | 39.6% | +0.30 | 0.31 |
| reserveValue 8 | 40.3% | 39.6% | +0.04 | 0.29 |
| v2 pairwise net (18k) | 38.6% | 41.4% | -0.61 | -1.14 |
| old shipped bot (v1 exp29) | 37.0% | 43.0% | -0.68 | -2.42 |
| blend 0.20 | 33.9% | 46.2% | -1.16 | -5.04 |

- The old bot loses to the new one head-to-head from the other side of the table
  too, so the encoder promotion is real, not a seed artefact.
- **farmOpenFactor 0.4 promoted** (shipped 0.8 → 0.4): the whole bracket 0.4–0.6
  clears the gate and 0.4 is the best point so far, so the bracket is extended
  downward next round (0.2, 0.0). The heuristic had been paying nearly full price
  for farms next to open cities; with v2 the net already sees "unclaimed / open
  city" signals, so the hand term double-counted.
- Blend 0.35 wins with the v2 net (z 3.22) where 0.30 was flat with the v1 net:
  a better net earns more weight. 0.20 loses badly either way. Re-tested on top of
  farm 0.4 with 0.45 next round.
- Hard depth 6 is +0.3 to +0.4 for the second time (z 1.2–1.4 each): promising,
  not yet proven; combined round-1/round-2 evidence is about z 1.8.
- The pairwise-trained v2 net loses to the value-trained one. Pairwise helped v1
  (exp 29) but not v2; parked.
- The bundle step's push failed on rounds 2 and 3 (shallow checkout never created
  the local branch, so it made an orphan commit); the verdicts were recovered
  from the job log and the workflow now fetches the branch explicitly.

## Round 3 on Actions: the remaining heuristic constants (1,600 seats each, seeds 9201–9208)

| candidate vs shipped | margin | z |
|---|---|---|
| reserveHorizon 12 (was 18) | +0.43 | 1.62 |
| chanceTilesPerEdge 7 (was 5) | +0.21 | 1.57 |
| roadGrowth 0.25 | -0.05 | -0.68 |
| cityGrowth 0.9 | -0.25 | -0.32 |
| chanceTilesPerEdge 4 | -0.40 | -0.32 |
| cityGrowth 0.3 | -0.25 | -0.91 |
| reserveHorizon 27 | -0.57 | -0.91 |
| roadGrowth 0.75 | -0.24 | -1.24 |

Nothing clears the gate with margin. The growth-per-open-edge constants (0.6 city,
0.5 road) are already at their optimum to within noise, and the completion-chance
shape is flat around 5 tiles per edge. Horizon 12 and tiles-per-edge 7 are weak
positives; parked as tie-break candidates for a later combined check rather than
shipped one at a time (with 8 tests per round, one z ≈ 1.6 is expected by chance).

## Round 4 on Actions (vs shipped with farm 0.4; 1,600 seats each, seeds 9301–9308)

| candidate vs shipped | margin | z |
|---|---|---|
| blend 0.45 | +0.62 | 1.34 |
| blend 0.35 | +0.28 | 1.09 |
| oppBestWeight 0.5 | +0.09 | 1.34 |
| hard depth 6 | +0.16 | -0.24 |
| hard staticWeight 0.5 | +0.10 | -0.68 |
| farmOpenFactor 0.2 | -0.06 | -0.14 |
| farmOpenFactor 0.0 | -0.33 | -1.62 |
| hard depth 8 | -0.74 | -2.88 |

- farmOpenFactor: 0.4 is the floor of the plateau (0.2 is flat, 0.0 loses), so
  0.4 stays.
- Blend: on top of the farm fix, 0.35 and 0.45 drop from z 3.2 to z 1.1–1.3. The
  v2 net had been partly compensating for the over-valued farms; with the hand
  term fixed there is less for it to correct. 0.45 gets one more look at double
  the seats before deciding.
- Hard search: depth 6 is flat on its third try (round-1/2 positives were noise),
  depth 8 is clearly worse under the same 150 ms cap (fewer rollouts per candidate).
  Depth 4 stays.
- Bookkeeping: research/train.ts now reads the feature files in chunks (the 26k-game
  v2 set is 2.5 GB, over Node's readFileSync limit).

## Gen 3 training (v2 encoder, 26k games: gen1 10k + gen2 8k + gen3 8k by the v2 bot)

The val set is a new 10% split of all 26k games, so these numbers are not
comparable with the gen1b baseline (0.0999); they are comparable with each other.

| run | budget | epochs | val_mse |
|---|---|---|---|
| [64,32] | 90 s | 0.8 | 0.09623 |
| [64,32] | 300 s | 2.5 | 0.09420 |
| [64,32] | 900 s | 7.3 | 0.09329 |
| [128,64] | 900 s | 3.2 | 0.09394 |

More epochs keep helping (the 90 s budget that the fast loop uses sees less than
one epoch of this set), with diminishing returns after ~5. The wider net is worse at
equal wall-clock and twice as slow to evaluate at play time; not pursued. The three
[64,32] nets go to head-to-head (rounds 5 and 6). Bookkeeping: `HIDDEN=128,64`
env override in train.ts.

## Round 5 on Actions (1,600 seats each, seeds 9401–9406)

| candidate vs shipped (exp17, blend 0.25, farm 0.4) | margin | z |
|---|---|---|
| **blend 0.45** (two independent halves pooled, 3,200 seats) | +0.89 | **3.67** |
| gen3 net 300 s + blend 0.35 | +0.68 | 2.40 |
| gen3 net 300 s | +0.49 | 2.21 |
| gen3 net 300 s + blend 0.45 | +0.60 | 1.79 |
| gen3 net 90 s | -0.10 | -1.42 |

**Blend 0.45 promoted** (0.25 → 0.45). Across rounds 4 and 5 it is +0.62, +0.71
and +1.07 on three independent seeds, 4,800 seats in all. The v2 net has earned
nearly half the evaluation; the v1 net never got past a quarter.

The gen 3 nets: 90 s (under one epoch) is worse than the shipped exp 17, 300 s is
better by half a point. Consistent with the training table: the net needs several
epochs of the 26k set to beat one trained on 10k. The 900 s net (best val error)
and the 300 s net are re-tested against the new blend-0.45 base in round 6, with 8
shards each for power, plus blend 0.55 to bracket the other side.

## Round 6 on Actions (vs shipped exp17 at blend 0.45; paired seeds, seeds 9501–9506)

| candidate | halves (margin, z) | pooled 3,200 seats |
|---|---|---|
| **gen3 net, 900 s** | +0.50 z 2.03 / +0.49 z 1.00 | +0.50, z 2.14 |
| gen3 net, 300 s | +0.74 z 3.40 / +0.07 z 0.34 | +0.40, z 2.64 |
| blend 0.55 | +0.59, z 0.85 | — |
| blend 0.65 | +0.26, z 0.86 | — |

**Gen 3 900 s net promoted** (exp 17 → gen3-v2-b900). Both gen 3 nets beat exp 17
by 0.4–0.5 points at ~3,200 seats each; the 900 s one is chosen for its steadier
halves and the better validation error, and the shipped candidate file follows it.
This is the first time a net trained on the promoted bot's own games has cleared
the gate: the gen 2 attempt (v1 encoder, 18k games) was +0.5 at z 0.9 with 400
seats, which in hindsight was probably real too.

Blend above 0.45 is flat, so 0.45 stays. Gen 4 self-play (8k games by the
blend-0.45 bot) is queued for the next training round.

## Round 7 on Actions (vs shipped gen3-b900, blend 0.45; 1,600 seats each, seeds 9601–9606)

| candidate | margin | z |
|---|---|---|
| **reserveHorizon 12** (2nd seed; round 3 was +0.43, z 1.62) | +0.13 | **2.19** |
| chanceTilesPerEdge 7 (2nd seed) | +0.16 | 0.62 |
| hard staticWeight 0.7 | -0.06 | -1.16 |
| hard rollouts 20 | -0.45 | -1.22 |
| reserveValue 6 | -0.24 | -1.23 |
| old shipped net (exp 17) | -0.69 | -1.87 |

The gen 3 promotion holds from the other side of the table. **reserveHorizon 12
promoted** (18 → 12): two independent 1,600-seat matches both clear the gate,
pooled about +0.3 points; meeples in hand stop counting for much once the deck
is under a dozen tiles rather than eighteen. Tiles-per-edge 7 did not repeat.
The hard bot's search knobs are at their optimum for the 150 ms cap: every
change to depth, rollouts, static weight or think time has been flat or worse.
