#!/usr/bin/env bash
# Run evaluator bot. Agent ID from env or generic default.
set -euo pipefail
cd "$(dirname "$0")"

export AGENT_ROLE=evaluator
export ARCLAYER_AGENT_ID="${ARCLAYER_AGENT_ID_EVALUATOR:-${ARCLAYER_AGENT_ID:-commerce-evaluator-01}}"
export ARCLAYER_API_KEY="${ARCLAYER_API_KEY_EVALUATOR:-${ARCLAYER_API_KEY:-}}"
export X402_PAYER_PRIVATE_KEY="${BOT_PRIVATE_KEY_EVALUATOR:-${X402_PAYER_PRIVATE_KEY:-}}"
export UPSTREAM_AGENT_ID="${UPSTREAM_AGENT_ID_ANALYZER:-${UPSTREAM_AGENT_ID:-}}"
export UPSTREAM_ROLE="${UPSTREAM_ROLE:-analyzer}"
export LLM_MODEL="${LLM_MODEL:-xiaomi/mimo-v2-flash}"
export LLM_API_KEY="${LLM_API_KEY_EVALUATOR:-${LLM_API_KEY:-}}"
export BOT_CONFIG="bot.config.evaluator.json"

exec node run-commerce-bot.js
