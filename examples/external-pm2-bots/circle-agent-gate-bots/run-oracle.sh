#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Load env vars from .env
source .env 2>/dev/null || true

export AGENT_ROLE=oracle
export ARCLAYER_AGENT_ID="${ARCLAYER_AGENT_ID_ORACLE:-${ARCLAYER_AGENT_ID:-hermes-oracle}}"
export ARCLAYER_API_KEY="${ARCLAYER_API_KEY_ORACLE:-${ARCLAYER_API_KEY:-}}"
export X402_PAYER_PRIVATE_KEY="${BOT_PRIVATE_KEY_ORACLE:-${X402_PAYER_PRIVATE_KEY:-}}"
export PRIVATE_KEY="${BOT_PRIVATE_KEY_ORACLE:-${PRIVATE_KEY:-${X402_PAYER_PRIVATE_KEY:-}}}"
export LLM_MODEL="${LLM_MODEL:-deepseek/deepseek-v4-flash}"
export LLM_API_KEY="${LLM_API_KEY_ORACLE:-${LLM_API_KEY:-}}"
export LLM_BASE_URL="${LLM_BASE_URL:-https://api.pioneer.ai/v1}"
export BOT_CONFIG="${BOT_CONFIG:-bot.config.oracle.json}"

exec node run-commerce-bot.js
