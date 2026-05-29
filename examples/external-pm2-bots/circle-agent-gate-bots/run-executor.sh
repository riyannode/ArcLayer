#!/usr/bin/env bash
# Run executor bot. Agent ID from env or generic default.
set -euo pipefail
cd "$(dirname "$0")"

export AGENT_ROLE=executor
export ARCLAYER_AGENT_ID="${ARCLAYER_AGENT_ID_EXECUTOR:-${ARCLAYER_AGENT_ID:-commerce-executor-01}}"
export ARCLAYER_API_KEY="${ARCLAYER_API_KEY_EXECUTOR:-${ARCLAYER_API_KEY:-}}"
export X402_PAYER_PRIVATE_KEY="${BOT_PRIVATE_KEY_EXECUTOR:-${X402_PAYER_PRIVATE_KEY:-}}"
export UPSTREAM_AGENT_ID="${UPSTREAM_AGENT_ID_EVALUATOR:-${UPSTREAM_AGENT_ID:-}}"
export UPSTREAM_ROLE="${UPSTREAM_ROLE:-evaluator}"
export LLM_MODEL="${LLM_MODEL:-xiaomi/mimo-v2-flash}"
export LLM_API_KEY="${LLM_API_KEY_EXECUTOR:-${LLM_API_KEY:-}}"
export BOT_CONFIG="bot.config.executor.json"

exec node run-commerce-bot.js
