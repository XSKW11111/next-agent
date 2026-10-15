#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR=$(cd "$(dirname "$0")" && pwd)
APP_ROOT=${APP_ROOT:-$(cd "$SKILL_DIR/../../.." && pwd)}
PORT=${VERIFY_PORT:-4173}
RUN_ID=${RUN_ID:-$(date +%Y%m%d%H%M%S)}
EVIDENCE=${EVIDENCE_DIR:-/tmp/next-agent-verify/$RUN_ID}

if [[ ! -f "$APP_ROOT/src/app/chat-panel.tsx" ]]; then
  echo "APP_ROOT ($APP_ROOT) has no src/app/chat-panel.tsx." >&2
  echo "Point APP_ROOT at the checkout whose page is the support chat." >&2
  exit 1
fi

if [[ -e "$EVIDENCE" ]]; then
  echo "evidence directory $EVIDENCE already exists. Set a new RUN_ID." >&2
  exit 1
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is already in use. Set VERIFY_PORT to a free port." >&2
  exit 1
fi

mkdir -p "$EVIDENCE/evidence"
RUN_APP="$(dirname "$APP_ROOT")/next-agent-verify-$RUN_ID"
printf '%s\n' "$RUN_APP" >"$EVIDENCE/root"
printf '%s\n' "$APP_ROOT" >"$EVIDENCE/source"

cleanup_failed_launch() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    if [[ -f "$EVIDENCE/server.pid" ]]; then
      local pid
      pid=$(cat "$EVIDENCE/server.pid")
      kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    fi
    git -C "$APP_ROOT" worktree remove --force "$RUN_APP" >/dev/null 2>&1 || true
  fi
}
trap cleanup_failed_launch EXIT

git -C "$APP_ROOT" worktree add --detach "$RUN_APP" HEAD
git -C "$RUN_APP" rev-parse HEAD >"$EVIDENCE/revision"
npm ci --prefix "$RUN_APP"
if [[ -f "$APP_ROOT/.env" ]]; then
  install -m 600 "$APP_ROOT/.env" "$RUN_APP/.env.local"
fi
printf '%s\n' "$PORT" >"$EVIDENCE/port"

set -m
(
  cd "$RUN_APP"
  exec npx next dev --hostname 127.0.0.1 --port "$PORT"
) >"$EVIDENCE/server.log" 2>&1 &
SERVER_PID=$!
printf '%s\n' "$SERVER_PID" >"$EVIDENCE/server.pid"

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true'; then
    trap - EXIT
    printf '%s\n' "$EVIDENCE"
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "next dev exited before it was ready. Log: $EVIDENCE/server.log" >&2
    exit 1
  fi
  sleep 0.5
done

echo "next dev did not answer /api/health on port $PORT. Log: $EVIDENCE/server.log" >&2
exit 1
