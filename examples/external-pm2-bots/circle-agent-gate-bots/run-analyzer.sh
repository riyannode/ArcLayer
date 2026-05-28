#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Load env vars from .env
source .env 2>/dev/null || true

export AGENT_ROLE=analyzer
export ARCLAYER_AGENT_ID=apollo-analyzer
export ARCLAYER_API_KEY="${ARCLAYER_API_KEY_ANALYZER:-}"
export X402_PAYER_PRIVATE_KEY="${BOT_PRIVATE_KEY_ANALYZER:-}"
export PRIVATE_KEY="${BOT_PRIVATE_KEY_ANALYZER:-}"
export LLM_MODEL="${LLM_MODEL:-xiaomi/mimo-v2-flash}"
export LLM_API_KEY="${LLM_API_KEY:-}"

exec node run-buyer-hi-freq.js
