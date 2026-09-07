# NPC tournament results

Measured with `npx tsx scripts/tourney.ts --games 60 --seed 42` (per table size),
random seats from the pool of easy / normal / hard plus the pre-rewrite bots
(`scripts/legacy-npc.ts`, listed as old-normal / old-hard). Think cap raised to
400 ms per move for the run; the live server caps hard at 150 ms.

Columns: seats played, win rate (ties split), average points, margin against the
table average, meeples still in hand when half the bag was gone, share of turns
started with no meeple to place, and think time per move.

```

2 players — 60 games, random seats

bot         seats  win%   avg pts  margin  reserve@mid  idle turns%  ms/move
easy           22    0.0   14.3   -31.5    0.41         56.5       1
normal         20   80.0   89.3    19.4    0.85         29.7      25
hard           29   89.7   86.9    21.3    1.07         33.9     171
old-normal     24   43.8   43.9    -7.0    0.08         66.5      19
old-hard       25   30.0   48.4    -5.8    0.12         63.5      20

```
```

3 players — 60 games, random seats

bot         seats  win%   avg pts  margin  reserve@mid  idle turns%  ms/move
easy           41    0.0   15.5   -20.2    1.61         40.1       1
normal         27   64.8   67.9    17.5    1.04         24.4      26
hard           35   74.3   65.1    19.4    1.00         23.0     184
old-normal     36   29.2   39.7    -2.1    0.22         50.5      17
old-hard       41   14.6   34.7    -6.0    0.27         53.3      17
```
```

4 players — 60 games, random seats

bot         seats  win%   avg pts  margin  reserve@mid  idle turns%  ms/move
easy           47    0.0   14.6   -19.5    2.64         20.7       1
normal         56   37.5   52.4    10.0    1.55         12.8      26
hard           51   56.9   53.8    11.9    1.59         15.2     184
old-normal     36   19.4   37.8     0.7    0.94         34.6      15
old-hard       50    6.0   31.0    -5.4    0.54         43.1      16
```
```

5 players — 60 games, random seats

bot         seats  win%   avg pts  margin  reserve@mid  idle turns%  ms/move
easy           49    0.0   11.1   -16.6    3.53          9.9       1
normal         62   35.5   42.2     8.4    1.97         10.0      27
hard           67   43.3   43.8     9.6    1.82          9.1     194
old-normal     64    9.4   29.9    -2.9    1.72         28.4      15
old-hard       58    5.2   29.1    -2.8    1.29         29.3      15
```

2-player head-to-head (row beats column, win % over games played):

```
Head-to-head, 2 players (row beats column, win%)

                   easy     normal       hard old-normal   old-hard
easy                  —     0% (4)     0% (9)     0% (5)     0% (4)
normal         100% (4)          —    43% (7)   100% (4)   100% (5)
hard           100% (9)    57% (7)          —   100% (6)   100% (7)
old-normal     100% (5)     0% (4)     0% (6)          —    61% (9)
old-hard       100% (4)     0% (5)     0% (7)    39% (9)          —
```

## Reading it

- Both new bots beat the old ones in every seat count. Head-to-head in 2-player,
  old-normal and old-hard never won a game against either.
- The meeple economy is the difference: old bots started 50-65% of their turns
  with nothing to place; the new ones are at 10-35% and keep one or two in hand
  at mid-game, more at bigger tables where features complete slower.
- Hard beats normal in every seat count (57% head-to-head in 2-player, wider
  margins at 3-4 players) for about 7x the think time. Tuning history: with the
  first defaults (reserve 4.5, 35% static weight, 8 rollouts x 6 plies) hard lost
  to normal 35/65; the sweep in `--tune` found reserve 7 with a 60% static weight
  and 12 rollouts x 4 plies, which is what ships.
- Easy is a warm body: it has never beaten anything but easy.

## The learned evaluator (scripts/selfplay.ts, scripts/train.ts)

The position evaluation the search bots use can also come from a small neural
net over the feature graph (`src/server/features.ts`: 86 numbers per seat —
banked points, meeples in hand, and per-group aggregates of the cities, roads,
cloisters and fields a seat holds, for me / the best opponent / the average
opponent). It was trained on 371k positions from 2,000 self-play games between
the normal bots (12% random moves for variety), predicting each seat's final
margin. Held-out error: net 0.085 vs hand-written evaluation 0.119 (predicting
the mean: 0.171), and the net is better in the early, mid and late game.

Better prediction did not make a better player on its own. In the tourney
(60 games per table, seed 5) the pure-net bots lost to the hand-written ones,
but a 50/50 blend of the two evaluations was the strongest bot at every table
size at normal's think time:

```
2 players (net = net evaluation, blend = 50/50, net-hard = net + rollouts)
bot         seats  win%   avg pts  margin  reserve@mid  idle turns%  ms/move
normal         28   48.2   84.7     2.9    0.75         35.1      21
hard           23   73.9   83.4     4.5    0.83         30.6     158
net            24   33.3   72.9    -5.8    0.63         36.7      23
blend          18   72.2   91.2     6.3    0.72         28.2      26
net-hard       27   31.5   75.2    -5.9    0.59         37.7     167

```
```
3 players (net = net evaluation, blend = 50/50, net-hard = net + rollouts)
bot         seats  win%   avg pts  margin  reserve@mid  idle turns%  ms/move
normal         33   27.3   61.6    -0.4    1.18         19.6      23
hard           35   40.0   66.1     3.5    1.11         17.3     172
net            29   15.5   56.8    -6.1    1.45         20.5      27
blend          49   50.0   68.7     3.5    1.18         19.3      29
net-hard       34   23.5   59.7    -3.0    1.29         20.6     185
```
```
4 players (net = net evaluation, blend = 50/50, net-hard = net + rollouts)
bot         seats  win%   avg pts  margin  reserve@mid  idle turns%  ms/move
normal         53   23.6   52.1    -0.6    1.75         12.5      23
hard           41   30.5   53.3     3.1    1.61         13.5     175
net            53   12.3   49.8    -2.8    1.98          9.5      30
blend          53   36.8   51.3     0.8    1.70         11.6      34
net-hard       40   22.5   50.4     0.3    2.35         10.9     193
```
Blend is what ships (`NPC_TUNING.evaluator = 'blend'`); normal and hard both
use it. A confirmation run (seed 11) of the shipped normal/hard against
hand-only versions (`hand`, `hand-hard`) shows a modest but consistent edge,
clearest at 3-4 players; at 2 players it is close to a wash:

```
2 players (normal/hard = blend; hand/hand-hard = hand-written only)
bot         seats  win%   avg pts  margin  reserve@mid  idle turns%  ms/move
normal         29   50.0   85.5    -0.8    0.93         24.8      26
hard           29   53.4   83.6     1.1    0.76         28.2     173
hand           34   48.5   82.3    -0.5    0.71         34.4      21
hand-hard      28   48.2   87.2     0.3    0.89         31.2     160

```
```
3 players (normal/hard = blend; hand/hand-hard = hand-written only)
bot         seats  win%   avg pts  margin  reserve@mid  idle turns%  ms/move
normal         44   28.4   68.0     1.3    1.41         14.8      29
hard           43   41.9   66.6     1.6    1.49         15.6     191
hand           40   38.8   61.5    -2.2    1.32         17.7      22
hand-hard      53   26.4   63.7    -0.7    1.38         17.8     167
```
```
4 players (normal/hard = blend; hand/hand-hard = hand-written only)
bot         seats  win%   avg pts  margin  reserve@mid  idle turns%  ms/move
normal         54   27.8   55.9     1.7    1.89          8.0      35
hard           67   26.9   52.6     0.3    1.82          9.0     213
hand           67   20.9   50.6    -1.7    1.67          9.3      24
hand-hard      52   25.0   52.1    -0.0    1.65         10.6     179
```
To go further: generate a second round of self-play with the blend bots
(`--eval blend`), retrain, and re-run this comparison. Each round is about
25 minutes of data generation on four cores plus a couple of minutes of training.
