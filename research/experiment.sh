#!/usr/bin/env bash
# Run one autoresearch experiment against the frozen harness and record it.
#
#   research/experiment.sh "<description>" [--kind train|features|search] [--strength] [--gen N]
#
# The working tree is the experiment: edit research/train.ts (or the encoder, or
# npc.ts) first, then call this. It trains under the fixed budget, compares the
# metric with research/best.json, optionally runs the strength eval, prints the
# verdict, and either commits the change (KEEP) or reverts the experiment files
# (REVERT). Every run appends a row to research/results.tsv.
set -euo pipefail
cd "$(dirname "$0")/.."
DESC="${1:?description}"; shift || true
KIND="train"; STRENGTH=0; GEN="${GEN:-1}"; BUDGET="${BUDGET:-90}"; DATA="${DATA:-data/research}"
while [ $# -gt 0 ]; do case "$1" in --kind) KIND="$2"; shift 2;; --strength) STRENGTH=1; shift;; --gen) GEN="$2"; shift 2;; *) echo "unknown arg $1"; exit 2;; esac; done
BEST=research/best.json
[ -f "$BEST" ] || echo '{"val_mse": 9, "strength_win": 0}' > "$BEST"
id=$(( $(wc -l < research/results.tsv) ))  # header is row 0
mkdir -p "$DATA"
if [ "$KIND" = "features" ]; then
  echo "== re-encoding (encoder changed)"; npx tsx research/prepare.ts "$DATA"/../gen*/rec-*.json --out "$DATA" 2>/dev/null | tail -1
fi
echo "== exp $id: $DESC (kind $KIND, budget ${BUDGET}s)"
metric=$(npx tsx research/train.ts --data "$DATA" --budget "$BUDGET" --out "$DATA/candidate.ts" 2> "$DATA/exp-$id-train.log" | sed -n 's/^METRIC val_mse=//p')
best_mse=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$BEST','utf8')).val_mse)")
echo "   val_mse $metric (best $best_mse)"
strength="-"
verdict="REVERT"
improved=$(node -e "console.log(($best_mse - $metric) >= 0.0015 ? 1 : 0)")
if [ "$STRENGTH" = "1" ] || { [ "$improved" = "1" ] && [ "$KIND" != "train" ]; }; then
  echo "== strength eval"
  strength=$(npx tsx research/eval.ts --candidate "$DATA/candidate.ts" --games "${GAMES:-80}" 2> "$DATA/exp-$id-eval.log" | sed -n 's/^STRENGTH //p')
  echo "   $strength"
  z=$(echo "$strength" | sed -n 's/.* z=\([-0-9.]*\).*/\1/p'); mg=$(echo "$strength" | sed -n 's/.* margin=\([-0-9.]*\) .*/\1/p'); rmg=$(echo "$strength" | sed -n 's/.*ref_margin=\([-0-9.]*\).*/\1/p')
  if node -e "process.exit(($z > 1.0 && $mg > $rmg) ? 0 : 1)"; then verdict="KEEP"; fi
  # A proxy-only improvement that fails the strength bar is still kept as the proxy
  # best when the change is confined to training (it cannot make the shipped bot worse
  # until weights are promoted), but not for feature/search changes.
  if [ "$verdict" = "REVERT" ] && [ "$KIND" = "train" ] && [ "$improved" = "1" ]; then verdict="KEEP"; fi
else
  [ "$improved" = "1" ] && verdict="KEEP"
fi
commit="-"
if [ "$verdict" = "KEEP" ]; then
  node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync('$BEST','utf8'));b.val_mse=$metric;b.exp=$id;b.desc=$(node -e "console.log(JSON.stringify('$DESC'))");if('$strength'!=='-')b.strength='$strength';fs.writeFileSync('$BEST',JSON.stringify(b,null,2))"
  cp "$DATA/candidate.ts" research/best-candidate.ts
  git add research/train.ts research/best.json research/best-candidate.ts src/server/features.ts src/server/npc.ts src/server/net.ts research/results.tsv 2>/dev/null || true
fi
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$GEN" "$KIND" "$DESC" "$metric" "$strength" "$verdict" "pending" >> research/results.tsv
if [ "$verdict" = "KEEP" ]; then
  git add research/results.tsv
  git commit -q -m "autoresearch #$id: $DESC (val_mse $metric${strength:+, $strength})

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E5Q7DMm3xNPParJnPc1D2x"
  commit=$(git rev-parse --short HEAD)
  sed -i "\$s/\tpending\$/\t$commit/" research/results.tsv
  git add research/results.tsv && git commit -q --amend --no-edit
else
  git checkout -q -- research/train.ts src/server/features.ts src/server/npc.ts src/server/net.ts
  git add research/results.tsv && git commit -q -m "autoresearch #$id: $DESC — reverted (val_mse $metric)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E5Q7DMm3xNPParJnPc1D2x"
  commit=$(git rev-parse --short HEAD)
  sed -i "\$s/\tpending\$/\t$commit/" research/results.tsv
  git add research/results.tsv && git commit -q --amend --no-edit
fi
echo "== exp $id: $verdict ($commit)"
