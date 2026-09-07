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
