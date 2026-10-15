#!/usr/bin/env bash
set -euo pipefail

EVIDENCE=${1:?evidence directory from launch.sh}
PORT=$(cat "$EVIDENCE/port")
ROOT=$(cat "$EVIDENCE/root")
PID=$(cat "$EVIDENCE/server.pid")
REVISION=$(cat "$EVIDENCE/revision")

if ! kill -0 "$PID" 2>/dev/null; then
  echo "server pid $PID is not running" >&2
  exit 1
fi

HEALTH=$(curl -sf "http://127.0.0.1:$PORT/api/health")
if [[ "$HEALTH" != '{"ok":true}' ]]; then
  echo "health body was $HEALTH" >&2
  exit 1
fi

if ! grep -q "127.0.0.1:$PORT" "$EVIDENCE/server.log"; then
  echo "server log does not name 127.0.0.1:$PORT" >&2
  exit 1
fi

if [[ ! -f "$ROOT/src/app/chat-panel.tsx" ]]; then
  echo "root $ROOT lost the support chat page" >&2
  exit 1
fi

if [[ "$(git -C "$ROOT" rev-parse HEAD)" != "$REVISION" ]]; then
  echo "root $ROOT no longer matches recorded revision $REVISION" >&2
  exit 1
fi

printf 'ok pid=%s port=%s revision=%s root=%s\n' "$PID" "$PORT" "$REVISION" "$ROOT"
