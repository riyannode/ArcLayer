#!/usr/bin/env bash
# Run executor bot. Agent ID from env or generic default.
set -euo pipefail
cd "$(dirname "$0")"

export AGENT_ROLE=executor
export ARCLAYER_AGENT_ID="${ARCLAYER_AGENT_ID_EXECUTOR:-${ARCLAYER_AGENT_ID:-commerce-executor-01}}"
export ARCLAYER_API_KEY="${ARCLAYER_API_KEY_EXECUTOR:-${ARCLAYER_API_KEY:-}}"
export X402_PAYER_PRIVATE_KEY="${BOT_PRIVATE_KEY_EXECUTOR:-${X402_PAYER_PRIVATE_KEY:-}}"
export BOT_CONFIG="bot.config.executor.json"

exec node executor-bot.js
