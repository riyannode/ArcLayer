#!/usr/bin/env bash
set -euo pipefail

BOT_DIR="/root/ArcLayer-pr204/examples/external-pm2-bots/market-agent-bridge"
PREVIEW_PREFIX="https://arcwork-git-codex-fix-x402-resourcesession-i-9b7e0f-gg-11dd9a68.vercel.app"
LOCK="/tmp/pr204-x402-validate.lock"
CHAIN_LOG="/tmp/pr204-chain.log"
EVENTS_JSON="/tmp/pr204-events.json"
VERIFIER_OUT="/tmp/pr204-verifier.out"

exec 9>"$LOCK"
flock -n 9 || {
  echo "BLOCKER: validation already running"
  exit 1
}

cd "$BOT_DIR"

set_env_value() {
  local key="$1"
  local value="$2"
  python3 - "$key" "$value" <<'PY'
from pathlib import Path
import sys

key, value = sys.argv[1], sys.argv[2]
p = Path(".env")
lines = p.read_text().splitlines() if p.exists() else []
out = []
seen = False

for line in lines:
    if line.startswith(f"{key}="):
        out.append(f"{key}={value}")
        seen = True
    else:
        out.append(line)

if not seen:
    out.append(f"{key}={value}")

p.write_text("\n".join(out).rstrip() + "\n")
PY
}

cleanup() {
  set +e
  cd "$BOT_DIR" 2>/dev/null || true
  set_env_value X402_AUTOPAY false 2>/dev/null || true
  pkill -f "oracle-bot.js" 2>/dev/null || true
  pkill -f "analyzer-bot.js" 2>/dev/null || true
  pkill -f "evaluator-bot.js" 2>/dev/null || true
  pkill -f "executor-bot.js" 2>/dev/null || true
}
trap cleanup EXIT

echo "== preflight stop bots =="
pm2 stop oracle-bot analyzer-bot evaluator-bot executor-bot 2>/dev/null || true
pkill -f "oracle-bot.js" 2>/dev/null || true
pkill -f "analyzer-bot.js" 2>/dev/null || true
pkill -f "evaluator-bot.js" 2>/dev/null || true
pkill -f "executor-bot.js" 2>/dev/null || true

echo "== env sanity =="
chmod 600 .env
set -a
source .env
set +a

if [[ "${ARCLAYER_BASE_URL:-}" != "$PREVIEW_PREFIX" ]]; then
  echo "BLOCKER: ARCLAYER_BASE_URL is not PR #204 preview"
  echo "ARCLAYER_BASE_URL=${ARCLAYER_BASE_URL:-<missing>}"
  exit 1
fi

if [[ "${MARKET_EXECUTION_MODE:-}" != "DRY_RUN" ]]; then
  echo "BLOCKER: MARKET_EXECUTION_MODE must stay DRY_RUN"
  exit 1
fi

if [[ "${PROTOCOL_TX_MODE:-}" != "ARC_TESTNET" ]]; then
  echo "BLOCKER: PROTOCOL_TX_MODE must be ARC_TESTNET"
  exit 1
fi

if [[ -z "${ARCLAYER_API_KEY:-}" || -z "${A2A_LIVE_EVENTS_TOKEN:-}" || -z "${X402_PAYER_PRIVATE_KEY:-}" ]]; then
  echo "BLOCKER: required secret env missing"
  exit 1
fi

grep -E '^(ARCLAYER_BASE_URL|MARKET_EXECUTION_MODE|PROTOCOL_TX_MODE|X402_AUTOPAY|X402_AUTOPAY_REQUIRED|X402_SCOPE|ARC_RPC_URL|EVALUATOR_MIN_CONFIDENCE|EVALUATOR_MAX_SPREAD_BPS|EVALUATOR_ALLOW_WIDE_SPREAD)=' .env
awk -F= '/^(ARCLAYER_API_KEY|A2A_LIVE_EVENTS_TOKEN|X402_PAYER_PRIVATE_KEY)=/ {print $1"=<set>"}' .env

echo "== enable x402 only for this guarded run =="
set_env_value X402_AUTOPAY true
set -a
source .env
set +a

rm -rf .x402-locks
mkdir -p .x402-locks

rm -f "$CHAIN_LOG" "$EVENTS_JSON" "$VERIFIER_OUT"

echo "== run one-entrypoint oracle chain =="
timeout 240s env RUN_FOREVER=false STARTUP_DELAY_MS=0 node oracle-bot.js | tee "$CHAIN_LOG"
echo "== chain summary =="
grep -Ei 'selected session|skip session|oracle-chain|analyzer|evaluator|executor|approved|rejected|x402|tx=0x|receipt_reference|x402_payment_proof|live-event|payment_in_flight|already_paid|rail_session_not_found|Missing analyzer output' "$CHAIN_LOG" | tail -250 || true

SESSION_ID="$(
  grep -oE 'session=btc15m_[0-9]+' "$CHAIN_LOG" \
    | tail -n1 \
    | cut -d= -f2 \
    || true
)"

if [[ -z "${SESSION_ID:-}" ]]; then
  echo "VERDICT=FAILED"
  echo "REASON=no_session_in_chain_log"
  exit 1
fi

echo "SESSION_ID=$SESSION_ID"

echo "== fetch bridge events for session =="
curl -sS \
  -H "authorization: Bearer $ARCLAYER_API_KEY" \
  "$ARCLAYER_BASE_URL/api/agent-bridge/events?limit=500" \
  -o "$EVENTS_JSON"

echo "== executor x402 rows =="
jq --arg s "$SESSION_ID" '
  [
    (.events // [])[]
    | select((.sessionId // .session_id // .payload.unlockedSessionId) == $s)
    | select(
        (.role // .metadata.role // "") == "executor"
        and (.type // .eventType // .event_type // "") == "receipt_reference"
        and (.payload.source // "") == "x402-autopay"
        and (.payload.scope // "") == "external_trace"
        and (.payload.transaction // "" | test("^0x[0-9a-fA-F]{64}$"))
      )
  ]
  | {
      session: $s,
      executorX402Count: length,
      txs: map({
        tx: .payload.transaction,
        paymentId: .payload.paymentId,
        createdAt: (.createdAt // .created_at),
        payloadHash: (.payloadHash // .payload_hash)
      })
    }
' "$EVENTS_JSON"

EXECUTOR_X402_COUNT="$(
  jq -r --arg s "$SESSION_ID" '
    [
      (.events // [])[]
      | select((.sessionId // .session_id // .payload.unlockedSessionId) == $s)
      | select(
          (.role // .metadata.role // "") == "executor"
          and (.type // .eventType // .event_type // "") == "receipt_reference"
          and (.payload.source // "") == "x402-autopay"
          and (.payload.scope // "") == "external_trace"
          and (.payload.transaction // "" | test("^0x[0-9a-fA-F]{64}$"))
        )
    ] | length
  ' "$EVENTS_JSON"
)"

if [[ "$EXECUTOR_X402_COUNT" -gt 1 ]]; then
  echo "VERDICT=BLOCKER"
  echo "REASON=executor_x402_count_gt_1"
  exit 1
fi

if [[ "$EXECUTOR_X402_COUNT" -eq 0 ]]; then
  echo "VERDICT=FAILED"
  echo "REASON=no_executor_x402_tx"
  exit 1
fi

TX="$(
  jq -r --arg s "$SESSION_ID" '
    [
      (.events // [])[]
      | select((.sessionId // .session_id // .payload.unlockedSessionId) == $s)
      | select(
          (.role // .metadata.role // "") == "executor"
          and (.type // .eventType // .event_type // "") == "receipt_reference"
          and (.payload.source // "") == "x402-autopay"
          and (.payload.scope // "") == "external_trace"
          and (.payload.transaction // "" | test("^0x[0-9a-fA-F]{64}$"))
        )
    ]
    | sort_by(.createdAt // .created_at // "")
    | last
    | .payload.transaction
  ' "$EVENTS_JSON"
)"

echo "TX=$TX"

echo "== run full lifecycle verifier =="
export TX
export SESSION_ID
export RPC="${ARC_RPC_URL:-https://rpc.drpc.testnet.arc.network}"
export USDC="${USDC_ADDRESS:-0x3600000000000000000000000000000000000000}"

bash scripts/verify-x402-full-lifecycle.sh | tee "$VERIFIER_OUT"
