#!/usr/bin/env bash
set -euo pipefail

EVIDENCE=${1:?evidence directory from launch.sh}
PID=$(cat "$EVIDENCE/server.pid")

if kill -0 "$PID" 2>/dev/null; then
  kill -- -"$PID" 2>/dev/null || kill "$PID" 2>/dev/null || true
  for _ in $(seq 1 20); do
    if ! kill -0 "$PID" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 -- -"$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null || true
  fi
fi

SOURCE=$(cat "$EVIDENCE/source" 2>/dev/null || true)
ROOT=$(cat "$EVIDENCE/root" 2>/dev/null || true)
if [[ -n "$SOURCE" && -n "$ROOT" && -d "$ROOT" ]]; then
  git -C "$SOURCE" worktree remove --force "$ROOT"
fi

printf 'stopped %s\nevidence kept at %s\n' "$PID" "$EVIDENCE"
