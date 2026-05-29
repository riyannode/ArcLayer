#!/usr/bin/env bash
# Run analyzer bot. Agent ID from env or generic default.
set -euo pipefail
cd "$(dirname "$0")"

export AGENT_ROLE=analyzer
export ARCLAYER_AGENT_ID="${ARCLAYER_AGENT_ID_ANALYZER:-${ARCLAYER_AGENT_ID:-commerce-analyzer-01}}"
export ARCLAYER_API_KEY="${ARCLAYER_API_KEY_ANALYZER:-${ARCLAYER_API_KEY:-}}"
export X402_PAYER_PRIVATE_KEY="${BOT_PRIVATE_KEY_ANALYZER:-${X402_PAYER_PRIVATE_KEY:-}}"
export BOT_CONFIG="bot.config.analyzer.json"

exec node analyzer-bot.js
