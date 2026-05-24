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
sleep 3

echo "== process audit =="
BOT_PROCS="oracle-bot.js|analyzer-bot.js|evaluator-bot.js|executor-bot.js"
SHELL_PID="$$"
echo "parent_shell_pid=${SHELL_PID}"
MATCHING_PIDS="$(pgrep -f "$BOT_PROCS" 2>/dev/null || true)"
if [[ -n "$MATCHING_PIDS" ]]; then
  echo "BLOCKER: stray bot processes still running after kill+wait"
  echo "pids=$MATCHING_PIDS"
  ps -o pid,cmd -p $MATCHING_PIDS 2>/dev/null || true
  echo "Kill them manually before retry."
  exit 1
fi
echo "all_bot_pids=clean"

rm -rf .x402-locks
mkdir -p .x402-locks

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

rm -f "$CHAIN_LOG" "$EVENTS_JSON" "$VERIFIER_OUT"

echo "== run one-entrypoint oracle chain =="
timeout 240s env RUN_FOREVER=false STARTUP_DELAY_MS=0 node oracle-bot.js | tee "$CHAIN_LOG" || true
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

echo "== role-count gates =="

count_events() {
  local role="$1"
  local type="$2"
  local scope_filter="${3:-}"
  jq -r --arg s "$SESSION_ID" --arg r "$role" --arg t "$type" --arg sc "$scope_filter" '
    def sid: (.sessionId // .session_id // .payload.unlockedSessionId // "");
    def role: (.role // .metadata.role // .payload.role // "");
    def typ: (.type // .eventType // .event_type // "");
    [
      (.events // [])[]
      | select(sid == $s)
      | select(role == $r)
      | select(typ == $t)
      | if ($sc != "") then select((.payload.source // "") == $sc) else . end
    ] | length
  ' "$EVENTS_JSON"
}

ANALYZER_RESOLVER_OUTPUT_COUNT="$(count_events analyzer resolver_output '')"
ANALYZER_X402_COUNT="$(count_events analyzer receipt_reference x402-autopay)"
EVALUATOR_EVALUATION_COUNT="$(count_events evaluator evaluation '')"
EVALUATOR_X402_COUNT="$(count_events evaluator receipt_reference x402-autopay)"
EXECUTOR_EXECUTION_INTENT_COUNT="$(count_events executor execution_intent '')"

echo "ANALYZER_RESOLVER_OUTPUT_COUNT=${ANALYZER_RESOLVER_OUTPUT_COUNT}"
echo "ANALYZER_X402_COUNT=${ANALYZER_X402_COUNT}"
echo "EVALUATOR_EVALUATION_COUNT=${EVALUATOR_EVALUATION_COUNT}"
echo "EVALUATOR_X402_COUNT=${EVALUATOR_X402_COUNT}"
echo "EXECUTOR_EXECUTION_INTENT_COUNT=${EXECUTOR_EXECUTION_INTENT_COUNT}"
echo "EXECUTOR_X402_COUNT=${EXECUTOR_X402_COUNT}"

# Detect duplicate x402 by role+scope
DUPLICATES="$(jq --arg s "$SESSION_ID" '
  def sid: (.sessionId // .session_id // .payload.unlockedSessionId // "");
  def role: (.role // .metadata.role // .payload.role // "");
  def typ: (.type // .eventType // .event_type // "");
  [
    (.events // [])[]
    | select(sid == $s)
    | select(typ == "receipt_reference" and (.payload.source // "") == "x402-autopay")
    | {role: role, scope: (.payload.scope // ""), tx: (.payload.txHash // .payload.transaction // ""), paymentId: (.payload.paymentId // "")}
  ]
  | group_by(.role + "|" + .scope)
  | map({key: (.[0].role + "|" + .[0].scope), count: length, txs: map(.tx)})
  | map(select(.count > 1))
' "$EVENTS_JSON")"
echo "DUPLICATE_X402_BY_ROLE_SCOPE=${DUPLICATES}"

BLOCKER=false
REASON=""

if [[ "$ANALYZER_RESOLVER_OUTPUT_COUNT" -ne 1 ]]; then
  BLOCKER=true
  REASON="${REASON}analyzer_resolver_output_count=${ANALYZER_RESOLVER_OUTPUT_COUNT} "
fi
if [[ "$ANALYZER_X402_COUNT" -gt 1 ]]; then
  BLOCKER=true
  REASON="${REASON}analyzer_x402_count=${ANALYZER_X402_COUNT} "
fi
if [[ "$EVALUATOR_EVALUATION_COUNT" -ne 1 ]]; then
  BLOCKER=true
  REASON="${REASON}evaluator_evaluation_count=${EVALUATOR_EVALUATION_COUNT} "
fi
if [[ "$EVALUATOR_X402_COUNT" -gt 1 ]]; then
  BLOCKER=true
  REASON="${REASON}evaluator_x402_count=${EVALUATOR_X402_COUNT} "
fi
if [[ "$EXECUTOR_EXECUTION_INTENT_COUNT" -ne 1 ]]; then
  BLOCKER=true
  REASON="${REASON}executor_execution_intent_count=${EXECUTOR_EXECUTION_INTENT_COUNT} "
fi

# Executor x402: 1 if evaluator approved, 0 if rejected
# We detect rejection by checking if evaluator evaluation has approved=false
EVALUATOR_APPROVED="$(jq -r --arg s "$SESSION_ID" '
  def sid: (.sessionId // .session_id // .payload.unlockedSessionId // "");
  def role: (.role // .metadata.role // .payload.role // "");
  def typ: (.type // .eventType // .event_type // "");
  [.events // [] | select(sid == $s and role == "evaluator" and typ == "evaluation")]
  | last
  | .payload.approved // false
' "$EVENTS_JSON")"

if [[ "$EVALUATOR_APPROVED" == "true" ]]; then
  if [[ "$EXECUTOR_X402_COUNT" -ne 1 ]]; then
    BLOCKER=true
    REASON="${REASON}executor_x402_count=${EXECUTOR_X402_COUNT}_expected_1 "
  fi
else
  if [[ "$EXECUTOR_X402_COUNT" -ne 0 ]]; then
    BLOCKER=true
    REASON="${REASON}executor_x402_count=${EXECUTOR_X402_COUNT}_expected_0_rejected "
  fi
fi

if [[ "$DUPLICATES" != "[]" && -n "$DUPLICATES" ]]; then
  BLOCKER=true
  REASON="${REASON}duplicate_x402_by_role_scope "
fi

if [[ "$BLOCKER" == "true" ]]; then
  echo "VERDICT=BLOCKER"
  echo "REASON=${REASON}"
  exit 1
fi

echo "VERDICT=PASS"
echo "REASON=all_role_counts_good"

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
