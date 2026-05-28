#!/bin/bash
# ──────────────────────────────────────────────────────────────
# x402 Circle Gateway Stress Test Runner
# ──────────────────────────────────────────────────────────────
# Usage:
#   HI_FREQ_ENABLED=true ./run-stress.sh                    # default: 1s interval, infinite
#   HI_FREQ_ENABLED=true ./run-stress.sh 500 100            # 500ms interval, 100 payments
#   HI_FREQ_ENABLED=true PAY_INTERVAL=200 ./run-stress.sh   # 200ms interval
# ──────────────────────────────────────────────────────────────

set -euo pipefail
cd "$(dirname "$0")"

# Load env
if [ -f .env ]; then
  set -a; source .env; set +a
fi

# ─── Safety guard: require explicit opt-in ────────────────────
if [[ "${HI_FREQ_ENABLED:-false}" != "true" ]]; then
  echo "ERROR: HI_FREQ_ENABLED=true is required to run x402 stress payments"
  echo "Refusing to start stress test to avoid accidental real payments."
  exit 1
fi

# Args
PAY_INTERVAL="${1:-${PAY_INTERVAL:-1000}}"
MAX_PAYMENTS="${2:-${MAX_PAYMENTS:-0}}"

# Validate
if [ -z "${UPSTREAM_AGENT_ID:-}" ]; then
  echo "ERROR: UPSTREAM_AGENT_ID required"
  echo "Set in .env or pass as env var"
  exit 1
fi

export PAY_INTERVAL MAX_PAYMENTS

echo "╔══════════════════════════════════════════════╗"
echo "║         x402 STRESS TEST                     ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Role:         ${AGENT_ROLE:-analyzer}"
echo "║  Upstream:     ${UPSTREAM_AGENT_ID}"
echo "║  Interval:     ${PAY_INTERVAL}ms"
echo "║  Max payments: ${MAX_PAYMENTS:-infinite}"
echo "╚══════════════════════════════════════════════╝"
echo ""

exec node stress-x402.js
