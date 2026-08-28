#!/usr/bin/env bash
set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_pid=""
worker_pid=""

stop_services() {
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
  fi
  if [[ -n "$worker_pid" ]]; then
    kill "$worker_pid" 2>/dev/null || true
  fi
  wait "$api_pid" "$worker_pid" 2>/dev/null || true
}

trap stop_services EXIT INT TERM

cd "$backend_dir"
uv run uvicorn api.main:app --reload --host 0.0.0.0 --port 8000 &
api_pid=$!

(
  cd "$backend_dir/livekit-worker"
  uv run python -m grouptalk_livekit_worker.agent dev
) &
worker_pid=$!

echo "FastAPI PID=$api_pid, LiveKit worker PID=$worker_pid"
echo "Readiness: http://localhost:8000/health/ready"

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$worker_pid" 2>/dev/null; do
  sleep 1
done

echo "API 또는 worker가 종료되어 나머지 서비스도 종료합니다." >&2
exit 1
