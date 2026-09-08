#!/usr/bin/env bash
# Run the head-to-head match queue (research/queue.json) on this machine, several
# matches at a time, and push the results to the `mac-results` branch so the
# research loop elsewhere can read them. Safe to re-run: finished jobs are skipped.
#
#   research/worker.sh              # parallelism = number of CPU cores
#   research/worker.sh 8            # or pick it
#   research/worker.sh 8 --no-push  # keep results local
#
# Needs: git, Node 22+, `npm ci` done once. Works on macOS and Linux (no GNU-only
# tools). Each match prints one STRENGTH line; a full 320-games-per-size job is
# 1,600 seats and takes ~45 min per core on an M-series Mac.
set -euo pipefail
cd "$(dirname "$0")/.."
PAR="${1:-$( (sysctl -n hw.ncpu 2>/dev/null || nproc) )}"
PUSH=1; [ "${2:-}" = "--no-push" ] && PUSH=0
mkdir -p research/mac-results data/research
echo "== worker: $PAR parallel matches on $(hostname) ($(uname -m)), node $(node -v)"

# One job per line: id<TAB>candidate<TAB>games<TAB>seed<TAB>args (JSON array)
QUEUE="${QUEUE:-research/queue.json}"
node -e '
const q = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).jobs;
for (const j of q) console.log([j.id, j.candidate, j.games, j.seed, JSON.stringify(j.args ?? [])].join("\t"));
' "$QUEUE" > research/mac-results/.jobs.tsv

run_one() {
  IFS=$'\t' read -r id cand games seed argsjson <<< "$1"
  out="research/mac-results/$id.out"
  if [ -s "$out" ] && grep -q "^STRENGTH" "$out"; then echo "-- $id: done already"; return 0; fi
  # Turn the JSON array of extra args back into positional args (bash 3.2 friendly).
  extra=()
  while IFS= read -r line; do extra+=("$line"); done < <(node -e 'for (const a of JSON.parse(process.argv[1])) console.log(a)' "$argsjson")
  echo "-> $id: $games games/size, seed $seed ${extra[*]:-}"
  start=$(date +%s)
  if npx tsx research/eval.ts --candidate "$cand" --games "$games" --seed "$seed" "${extra[@]}" > "$out.tmp" 2> "research/mac-results/$id.log"; then
    mv "$out.tmp" "$out"
    echo "<- $id ($(( ($(date +%s) - start) / 60 )) min): $(cat "$out")"
  else
    echo "!! $id failed; see research/mac-results/$id.log"; rm -f "$out.tmp"
  fi
}
export -f run_one

xargs -P "$PAR" -I{} bash -c 'run_one "$@"' _ {} < research/mac-results/.jobs.tsv

echo "== all jobs finished"
grep -H "^STRENGTH" research/mac-results/*.out | sed 's#research/mac-results/##; s#\.out:# #'

if [ "$PUSH" = "1" ]; then
  git add research/mac-results/*.out research/mac-results/*.log
  git -c user.name="mac-worker" -c user.email="mac-worker@users.noreply.github.com" commit -q -m "mac-results: $(date -u +'%Y-%m-%d %H:%M UTC') from $(hostname)" || echo "nothing new to commit"
  git push -q origin HEAD:mac-results && echo "== pushed to origin/mac-results"
fi
