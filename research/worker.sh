#!/usr/bin/env bash
# Thin wrapper: the match worker is research/worker.mjs (plain Node, portable).
#   research/worker.sh [parallel] [--no-push]
cd "$(dirname "$0")/.." && exec node research/worker.mjs "$@"
