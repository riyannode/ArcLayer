#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Load env vars from .env
source .env 2>/dev/null || true

export AGENT_ROLE=executor
export ARCLAYER_AGENT_ID="${ARCLAYER_AGENT_ID_EXECUTOR:-${ARCLAYER_AGENT_ID:-budu-executor}}"
export ARCLAYER_API_KEY="${ARCLAYER_API_KEY_EXECUTOR:-${ARCLAYER_API_KEY:-}}"
export X402_PAYER_PRIVATE_KEY="${BOT_PRIVATE_KEY_EXECUTOR:-${X402_PAYER_PRIVATE_KEY:-}}"
export PRIVATE_KEY="${BOT_PRIVATE_KEY_EXECUTOR:-${PRIVATE_KEY:-${X402_PAYER_PRIVATE_KEY:-}}}"
export UPSTREAM_ROLE="${UPSTREAM_ROLE:-evaluator}"
export UPSTREAM_AGENT_ID="${UPSTREAM_AGENT_ID_EVALUATOR:-${UPSTREAM_AGENT_ID:-}}"
export LLM_MODEL="${LLM_MODEL:-xiaomi/mimo-v2-flash}"
export LLM_API_KEY="${LLM_API_KEY_EXECUTOR:-${LLM_API_KEY:-}}"

exec node run-commerce-bot.js
