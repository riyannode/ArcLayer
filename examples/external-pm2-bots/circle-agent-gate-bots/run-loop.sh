#!/usr/bin/env bash
# Universal loop wrapper for circle commerce bots
# Usage: ./run-loop.sh [oracle|analyzer|evaluator|executor]
#
# Makes one-shot run-commerce-bot.js into a long-lived process.
# PM2 manages this process — no restart counter inflation.
#
# Environment:
#   LOOP_INTERVAL  — seconds between runs (default: 300 = 5 min)
#   LOOP_MAX_RUNS  — exit after N runs (default: 0 = infinite)
#   All other env vars from run-<role>.sh are inherited.

set -euo pipefail
cd "$(dirname "$0")"

ROLE="${1:?Usage: run-loop.sh [oracle|analyzer|evaluator|executor]}"
INTERVAL="${LOOP_INTERVAL:-300}"
MAX_RUNS="${LOOP_MAX_RUNS:-0}"

# Source role-specific env
ROLE_SCRIPT="run-${ROLE}.sh"
if [[ ! -f "$ROLE_SCRIPT" ]]; then
  echo "[loop] ERROR: ${ROLE_SCRIPT} not found"
  exit 1
fi

# Source shared .env first so ARCLAYER_API_KEY_ANALYZER etc are available
source .env 2>/dev/null || true

# Extract env vars from role script
set -a
source <(grep '^export ' "$ROLE_SCRIPT" | sed 's/^export //')
set +a

missing=0

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "[loop] ERROR: missing required env: $key"
    missing=1
  fi
}

require_env ARCLAYER_AGENT_ID
require_env ARCLAYER_API_KEY
require_env X402_PAYER_PRIVATE_KEY

if [[ "$ROLE" != "oracle" ]]; then
  require_env UPSTREAM_AGENT_ID
  require_env UPSTREAM_ROLE
fi

if [[ "$missing" -ne 0 ]]; then
  echo "[loop] refusing to start with incomplete env"
  exit 1
fi

echo "[loop] role=${ROLE} interval=${INTERVAL}s max_runs=${MAX_RUNS}"
echo "[loop] pid=$$ starting loop..."

run_count=0
while true; do
  run_count=$((run_count + 1))
  echo "[loop] === run #${run_count} ==="

  # Run the bot (one-shot)
  if node run-commerce-bot.js; then
    echo "[loop] run #${run_count} completed OK"
  else
    echo "[loop] run #${run_count} failed (exit=$?) — will retry"
  fi

  # Check max runs
  if [[ "$MAX_RUNS" -gt 0 && "$run_count" -ge "$MAX_RUNS" ]]; then
    echo "[loop] reached max_runs=${MAX_RUNS}, exiting"
    exit 0
  fi

  echo "[loop] sleeping ${INTERVAL}s..."
  sleep "$INTERVAL"
done
