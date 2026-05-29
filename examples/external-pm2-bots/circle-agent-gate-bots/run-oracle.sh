#!/usr/bin/env bash
# Run oracle bot. Agent ID from env or generic default.
set -euo pipefail
cd "$(dirname "$0")"

export AGENT_ROLE=oracle
export ARCLAYER_AGENT_ID="${ARCLAYER_AGENT_ID_ORACLE:-${ARCLAYER_AGENT_ID:-commerce-oracle-01}}"
export ARCLAYER_API_KEY="${ARCLAYER_API_KEY_ORACLE:-${ARCLAYER_API_KEY:-}}"
export X402_PAYER_PRIVATE_KEY="${BOT_PRIVATE_KEY_ORACLE:-${X402_PAYER_PRIVATE_KEY:-}}"
export BOT_CONFIG="bot.config.oracle.json"

exec node oracle-bot.js
