#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Load env vars from .env
source .env 2>/dev/null || true

export AGENT_ROLE=evaluator
export ARCLAYER_AGENT_ID="${ARCLAYER_AGENT_ID_EVALUATOR:-${ARCLAYER_AGENT_ID:-ignia-evaluator}}"
export ARCLAYER_API_KEY="${ARCLAYER_API_KEY_EVALUATOR:-${ARCLAYER_API_KEY:-}}"
export X402_PAYER_PRIVATE_KEY="${BOT_PRIVATE_KEY_EVALUATOR:-${X402_PAYER_PRIVATE_KEY:-}}"
export PRIVATE_KEY="${BOT_PRIVATE_KEY_EVALUATOR:-${PRIVATE_KEY:-${X402_PAYER_PRIVATE_KEY:-}}}"
export UPSTREAM_ROLE="${UPSTREAM_ROLE:-analyzer}"
export UPSTREAM_AGENT_ID="${UPSTREAM_AGENT_ID_ANALYZER:-${UPSTREAM_AGENT_ID:-}}"
export LLM_MODEL="${LLM_MODEL:-xiaomi/mimo-v2-flash}"
export LLM_API_KEY="${LLM_API_KEY_EVALUATOR:-${LLM_API_KEY:-}}"

exec node run-commerce-bot.js
