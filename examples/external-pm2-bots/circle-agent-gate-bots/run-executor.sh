#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

source .env 2>/dev/null || true

export AGENT_ROLE=executor
export ARCLAYER_AGENT_ID=budu-executor
export ARCLAYER_API_KEY="${ARCLAYER_API_KEY_EXECUTOR:-}"
export X402_PAYER_PRIVATE_KEY="${BOT_PRIVATE_KEY_EXECUTOR:-}"
export PRIVATE_KEY="${BOT_PRIVATE_KEY_EXECUTOR:-}"
export LLM_MODEL="mock-llm"

exec node run-buyer-hi-freq.js
