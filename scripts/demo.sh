#!/usr/bin/env bash
set -euo pipefail

# ── Long Tail Demo ──────────────────────────────────────────────────────────
#
# One command. Fresh database, server, full Durable MCP process.
#
#   npm run demo
#
# ────────────────────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo ""
echo "  Long Tail — Demo"
echo "  ═════════════════════════════════════════════════════════════"
echo ""

# ── 1. Fresh database ────────────────────────────────────────────────────────

echo "  [1/4] Resetting database ..."
docker compose down -v --remove-orphans > /dev/null 2>&1 || true
docker compose up -d > /dev/null 2>&1
echo "  [1/4] Database ready"

# ── 2. Start server ─────────────────────────────────────────────────────────

echo "  [2/4] Starting server ..."
npx tsx index.ts > /tmp/long-tail-demo.log 2>&1 &
SERVER_PID=$!

# Wait for health endpoint
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "  ✗ Server crashed. Logs:"
    tail -20 /tmp/long-tail-demo.log
    exit 1
  fi
  sleep 1
done

if ! curl -sf http://localhost:3000/health > /dev/null 2>&1; then
  echo "  ✗ Server did not start within 30s"
  tail -20 /tmp/long-tail-demo.log
  exit 1
fi

echo "  [2/4] Server running (pid $SERVER_PID)"

# Wait for seed to complete
sleep 3
echo "  [3/4] Workflows seeded"

# ── 3. Run process ──────────────────────────────────────────────────────────

echo "  [4/4] Running process ..."
echo ""
npx tsx scripts/process.ts
EXIT_CODE=$?

# ── 4. Done ─────────────────────────────────────────────────────────────────

if [ $EXIT_CODE -eq 0 ]; then
  echo "  Server still running at http://localhost:3000"
  echo "  Dashboard: http://localhost:3000/"
  echo ""
  echo "  Press Ctrl+C to stop"
  echo ""
  wait "$SERVER_PID" 2>/dev/null || true
else
  echo "  ✗ Process failed (exit code $EXIT_CODE)"
  exit $EXIT_CODE
fi
