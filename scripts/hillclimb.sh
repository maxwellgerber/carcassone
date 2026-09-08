#!/usr/bin/env bash
# One round of the learned-evaluator hill climb, end to end:
#   1. self-play with the current best bot (SHARDS parallel processes)
#   2. train a candidate net on the fresh data plus the previous round's data
#   3. gate: the candidate must beat the incumbent in a tourney
#   4. keep it (weights + report committed) or discard it
#
#   scripts/hillclimb.sh [rounds]        # default: run forever
#   GAMES=500 SHARDS=4 GATE_GAMES=80 EPOCHS=14 HIDDEN=64,32 scripts/hillclimb.sh 3
#
# Everything it produces lands in "$D"/ (gitignored) and "$LOG" (committed).
set -euo pipefail
cd "$(dirname "$0")/.."
ROUNDS="${1:-0}"
GAMES="${GAMES:-500}"; SHARDS="${SHARDS:-4}"; GATE_GAMES="${GATE_GAMES:-80}"; EPOCHS="${EPOCHS:-14}"; HIDDEN="${HIDDEN:-64,32}"
EPSILON="${EPSILON:-0.12}"; KEEP_PREV="${KEEP_PREV:-1}"; PUSH="${PUSH:-1}"; D="${DATA:-data}"; LOG="${REPORT:-docs/hillclimb.md}"
mkdir -p "$D"
round=$(( $(ls "$D"/round-*.done 2>/dev/null | wc -l) + 1 ))
while [ "$ROUNDS" = "0" ] || [ "$round" -le "$ROUNDS" ]; do
  tag="round-$round"; seedbase=$(( round * 1000 ))
  echo "=== $tag: self-play ($SHARDS x $GAMES games, epsilon $EPSILON) $(date -u +%H:%M:%S)"
  pids=()
  for s in $(seq 1 "$SHARDS"); do
    npx tsx scripts/selfplay.ts --games "$GAMES" --seed $(( seedbase + s )) --epsilon "$EPSILON" --out "$D/$tag-$s.json" > "$D/$tag-$s.log" 2>&1 &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p"; done
  # Training set: this round, plus the previous round when there is one (the net
  # should not forget how the previous bot played, and more data is more data).
  files=("$D"/$tag-*.json)
  prev=$(( round - 1 ))
  if [ "$KEEP_PREV" = "1" ] && ls "$D"/round-$prev-*.json >/dev/null 2>&1; then files+=("$D"/round-$prev-*.json); fi
  echo "=== $tag: train on ${#files[@]} files $(date -u +%H:%M:%S)"
  cp src/server/weights.ts "$D/$tag-incumbent.ts"
  npx tsx scripts/train.ts "${files[@]}" --epochs "$EPOCHS" --hidden "$HIDDEN" --out "$D/$tag-candidate.ts" > "$D/$tag-train.log" 2>&1
  tail -6 "$D/$tag-train.log"
  echo "=== $tag: gate ($GATE_GAMES games at 2p and 3p) $(date -u +%H:%M:%S)"
  # The tourney needs the candidate as a distinct bot: install it under a second name.
  cp "$D/$tag-candidate.ts" src/server/weights-candidate.ts
  sed -i 's/export const WEIGHTS/export const WEIGHTS_CANDIDATE/' src/server/weights-candidate.ts
  npx tsx scripts/tourney.ts --players 2 --games "$GATE_GAMES" --seed $(( seedbase + 77 )) --bots blend,cand,blend-hard,cand-hard --out "$D/$tag-gate2.json" > "$D/$tag-gate2.txt" 2> "$D/$tag-gate2.log" &
  g2=$!
  npx tsx scripts/tourney.ts --players 3 --games "$GATE_GAMES" --seed $(( seedbase + 78 )) --bots blend,cand,blend-hard,cand-hard --out "$D/$tag-gate3.json" > "$D/$tag-gate3.txt" 2> "$D/$tag-gate3.log" &
  g3=$!
  wait $g2; wait $g3
  verdict=$(npx tsx scripts/gate.ts "$D/$tag-gate2.json" "$D/$tag-gate3.json")
  echo "=== $tag: $verdict"
  {
    echo; echo "## $tag — $(date -u +'%Y-%m-%d %H:%M UTC')"; echo
    echo "Self-play: $SHARDS x $GAMES games (epsilon $EPSILON); trained on ${#files[@]} files, $EPOCHS epochs, hidden $HIDDEN."; echo
    echo '```'; grep -E "baseline|epoch $EPOCHS/|early|mid|late" "$D/$tag-train.log"; echo '```'; echo
    echo "Gate ($GATE_GAMES games each; cand = candidate, blend = incumbent):"; echo
    for n in 2 3; do echo '```'; sed -n '/^bot /,/^$/p' "$D/$tag-gate$n.txt" | sed "1i $n players"; echo '```'; done
    echo; echo "**Verdict: $verdict**"
  } >> "$LOG"
  if [[ "$verdict" == KEEP* ]]; then
    cp "$D/$tag-candidate.ts" src/server/weights.ts
    git add src/server/weights.ts "$LOG"
    git commit -q -m "Hill climb $tag: new evaluator weights ($verdict)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E5Q7DMm3xNPParJnPc1D2x"
    [ "$PUSH" = "1" ] && git push -q origin HEAD:master || true
  else
    git add "$LOG"
    git commit -q -m "Hill climb $tag: candidate rejected ($verdict)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E5Q7DMm3xNPParJnPc1D2x"
    [ "$PUSH" = "1" ] && git push -q origin HEAD:master || true
  fi
  rm -f src/server/weights-candidate.ts
  touch "$D/$tag.done"
  round=$(( round + 1 ))
done
