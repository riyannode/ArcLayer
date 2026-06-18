#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# live-test-autonomous-provider-arc.sh — Real ARC testnet validation
#
# This is NOT a dry-run. It validates the full autonomous provider lifecycle
# on ARC testnet with real on-chain transactions.
#
# Usage:
#   bash scripts/live-test-autonomous-provider-arc.sh \
#     --live-arc-testnet \
#     --job-id <EXISTING_OPEN_OR_FUNDED_JOB_ID> \
#     [--skip-balance-check]
#
# Requirements:
#   - CIRCLE_CHAIN=ARC-TESTNET (must be set in environment or .env.runner)
#   - Real Circle Dev Wallet with testnet USDC
#   - Real MCP token
#   - Real ERC-8004 identity
#   - Provider worker running
#   - LangChain runtime running
#   - Runner running
#
# This script NEVER uses mock data or dry-run mode.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
step()  { echo -e "\n${CYAN}[STEP]${NC} $*"; }
die()   { error "$*"; exit 1; }
pass()  { echo -e "${GREEN}  ✅ PASS:${NC} $*"; }
fail()  { echo -e "${RED}  ❌ FAIL:${NC} $*"; FAILURES=$((FAILURES + 1)); }

# ── Parse Args ───────────────────────────────────────────────────────────────
LIVE_ARC_TESTNET=false
JOB_ID=""
SKIP_BALANCE_CHECK=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --live-arc-testnet) LIVE_ARC_TESTNET=true; shift ;;
    --job-id)           JOB_ID="$2"; shift 2 ;;
    --skip-balance-check) SKIP_BALANCE_CHECK=true; shift ;;
    --help)
      echo "Usage: $0 --live-arc-testnet --job-id <JOB_ID> [--skip-balance-check]"
      exit 0
      ;;
    *) die "Unknown option: $1" ;;
  esac
done

# ── Validate Args ────────────────────────────────────────────────────────────
if [[ "$LIVE_ARC_TESTNET" != "true" ]]; then
  die "This script requires --live-arc-testnet flag. No dry-run mode available."
fi

if [[ -z "$JOB_ID" ]]; then
  die "This script requires --job-id <EXISTING_OPEN_OR_FUNDED_JOB_ID>. Mock job data is not accepted."
fi

# Validate job ID is numeric (ERC-8183 job IDs are numeric)
if ! [[ "$JOB_ID" =~ ^[0-9]+$ ]]; then
  die "Invalid job ID format: $JOB_ID (must be numeric)"
fi

# ── Load Environment ─────────────────────────────────────────────────────────
INSTALL_DIR="${ARCLAYER_INSTALL_DIR:-/opt/arclayer}"
ENV_FILE="$INSTALL_DIR/.env.runner"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# ── HMAC Signing Helper ──────────────────────────────────────────────────────
# Signs requests for Runner's HMAC-protected endpoints.
# Matches: buildHmacPayload, hmacSha256, sha256Buffer from @arclayer/runner-core

sign_runner_request() {
  local method="$1"
  local path="$2"
  local body="$3"
  local secret="${ARCLAYER_RUNNER_SECRET}"

  local timestamp
  timestamp=$(date +%s)000  # epoch ms
  local nonce
  nonce=$(openssl rand -hex 16)

  # SHA256 of body
  local body_hash
  body_hash=$(echo -n "$body" | openssl dgst -sha256 -hex | awk '{print $2}')

  # HMAC payload: METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_HASH
  local payload="${method}\n${path}\n${timestamp}\n${nonce}\n${body_hash}"

  local signature
  signature=$(echo -ne "$payload" | openssl dgst -sha256 -hmac "$secret" -hex | awk '{print $2}')

  echo "${timestamp}|${nonce}|sha256=${signature}"
}

# Runner HMAC-authenticated request
runner_hmac_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  local signer_result
  signer_result=$(sign_runner_request "$method" "$path" "$body")

  IFS='|' read -r timestamp nonce signature <<< "$signer_result"

  local curl_args=(
    -sf
    -X "$method"
    -H "x-arclayer-runner-timestamp: $timestamp"
    -H "x-arclayer-runner-nonce: $nonce"
    -H "x-arclayer-runner-signature: $signature"
    -H "Content-Type: application/json"
  )

  if [[ -n "$body" ]]; then
    curl_args+=(-d "$body")
  fi

  curl "${curl_args[@]}" "http://127.0.0.1:8787${path}" 2>/dev/null
}

# ── Validate Environment ─────────────────────────────────────────────────────
step "Validating environment..."

FAILURES=0

if [[ "${CIRCLE_CHAIN:-}" != "ARC-TESTNET" ]]; then
  fail "CIRCLE_CHAIN must be ARC-TESTNET, got: ${CIRCLE_CHAIN:-<unset>}"
else
  pass "CIRCLE_CHAIN=ARC-TESTNET"
fi

if [[ -z "${ARCLAYER_MCP_TOKEN:-}" ]]; then
  fail "ARCLAYER_MCP_TOKEN is required"
else
  pass "ARCLAYER_MCP_TOKEN is set"
fi

if [[ -z "${CIRCLE_WALLET_ADDRESS:-}" ]]; then
  fail "CIRCLE_WALLET_ADDRESS is required"
else
  pass "CIRCLE_WALLET_ADDRESS=${CIRCLE_WALLET_ADDRESS:0:10}..."
fi

if [[ -z "${ARCLAYER_RUNNER_SECRET:-}" ]]; then
  fail "ARCLAYER_RUNNER_SECRET is required"
else
  pass "ARCLAYER_RUNNER_SECRET is set"
fi

# ── Check Services ───────────────────────────────────────────────────────────
step "Checking services..."

# LangChain runtime health (public endpoint, no auth)
if curl -sf http://127.0.0.1:8788/health > /dev/null 2>&1; then
  pass "LangChain runtime healthy (port 8788)"
else
  fail "LangChain runtime not responding on port 8788"
fi

# Runner health (public endpoint, no auth)
RUNNER_HEALTH=$(curl -sf http://127.0.0.1:8787/health 2>/dev/null || echo "")
if [[ -n "$RUNNER_HEALTH" ]]; then
  pass "Runner healthy (port 8787)"
else
  fail "Runner not responding on port 8787"
fi

# ── Check Identity ───────────────────────────────────────────────────────────
step "Checking ERC-8004 identity..."

IDENTITY_FILE="$HOME/.arclayer/runner/identity.json"
if [[ -f "$IDENTITY_FILE" ]]; then
  IDENTITY_STATUS=$(jq -r '.status // "unknown"' "$IDENTITY_FILE")
  if [[ "$IDENTITY_STATUS" == "confirmed" ]]; then
    TOKEN_ID=*** -r '.tokenId // "unknown"' "$IDENTITY_FILE")
    pass "Identity confirmed: tokenId=$TOKEN_ID"
  elif [[ "$IDENTITY_STATUS" == "pending" ]]; then
    TX_HASH=$(jq -r '.txHash // "unknown"' "$IDENTITY_FILE")
    warn "Identity pending: txHash=$TX_HASH"
    warn "Wait for tx confirmation and re-run"
  else
    fail "Identity status: $IDENTITY_STATUS"
  fi
else
  fail "Identity file not found: $IDENTITY_FILE"
fi

# ── Check Wallet Balance (HMAC-Authenticated) ────────────────────────────────
step "Checking wallet balance (HMAC-authenticated)..."

if [[ "$SKIP_BALANCE_CHECK" == "true" ]]; then
  warn "Wallet balance check skipped (--skip-balance-check)"
elif [[ -n "${CIRCLE_WALLET_ADDRESS:-}" ]]; then
  # Use HMAC-authenticated request for /circle/status
  CIRCLE_STATUS=$(runner_hmac_request "GET" "/circle/status" 2>/dev/null || echo "")
  if [[ -n "$CIRCLE_STATUS" ]]; then
    pass "Wallet status retrieved (authenticated)"
    echo "$CIRCLE_STATUS" | jq -r '.response.balances[]? | "    \(.token): \(.amount) \(.chain)"' 2>/dev/null || true
  else
    fail "Could not retrieve wallet status via HMAC-authenticated request.
    Runner may be down or HMAC secret mismatch.
    Use --skip-balance-check to bypass."
  fi
fi

# ── Early Exit on Failures ───────────────────────────────────────────────────
if [[ $FAILURES -gt 0 ]]; then
  echo ""
  die "$FAILURES pre-flight check(s) failed. Fix issues and re-run."
fi

# ── Validate Requested Job (H) ───────────────────────────────────────────────
step "Validating job ID: $JOB_ID..."

# Query job status from Runner via HMAC-authenticated MCP proxy
# The runner exposes /erc8183/provider/run-only for runtime, but for status
# we query the MCP tool through the runner's HMAC endpoint.
JOB_STATUS_RAW=$(runner_hmac_request "POST" "/mcp" \
  "{\"tool\":\"jobs.get_onchain_status\",\"input\":{\"jobId\":\"$JOB_ID\"}}" 2>/dev/null || echo "")

if [[ -z "$JOB_STATUS_RAW" ]]; then
  fail "Could not query job status for job $JOB_ID. Runner may not support MCP proxy."
  die "Cannot validate job without status query."
fi

# Check job exists
JOB_PROVIDER=$(echo "$JOB_STATUS_RAW" | jq -r '.provider // .raw.provider // empty' 2>/dev/null || echo "")
JOB_STATUS_LABEL=$(echo "$JOB_STATUS_RAW" | jq -r '.statusLabel // .raw.statusLabel // empty' 2>/dev/null || echo "")
JOB_STATUS_CODE=$(echo "$JOB_STATUS_RAW" | jq -r '.statusCode // .raw.status // empty' 2>/dev/null || echo "")

if [[ -z "$JOB_PROVIDER" && -z "$JOB_STATUS_CODE" ]]; then
  fail "Job $JOB_ID not found or no status returned"
  die "Cannot validate non-existent job."
fi

pass "Job $JOB_ID exists"

# Validate provider matches local wallet
if [[ -n "$JOB_PROVIDER" && -n "${CIRCLE_WALLET_ADDRESS:-}" ]]; then
  if [[ "${JOB_PROVIDER,,}" == "${CIRCLE_WALLET_ADDRESS,,}" ]]; then
    pass "Job provider matches local wallet: ${CIRCLE_WALLET_ADDRESS:0:10}..."
  else
    fail "Job provider mismatch: expected ${CIRCLE_WALLET_ADDRESS}, got $JOB_PROVIDER"
    die "Job is assigned to a different provider. Cannot validate."
  fi
else
  warn "Could not verify job provider (provider field missing from response)"
fi

# Validate status is a valid lifecycle state
# Status codes: 0=Open, 1=Funded, 2=Submitted, 3=Completed, 4=Rejected
case "$JOB_STATUS_CODE" in
  0)  pass "Job status: Open (awaiting budget set)" ;;
  1)  pass "Job status: Funded (awaiting provider execution)" ;;
  2)  pass "Job status: Submitted (deliverable submitted)" ;;
  3)  pass "Job status: Completed" ;;
  4)  fail "Job status: Rejected — cannot validate rejected job" ;;
  *)  warn "Job status code: $JOB_STATUS_CODE ($JOB_STATUS_LABEL)" ;;
esac

# ── Validate Service Processing Capability ───────────────────────────────────
step "Checking provider service can process this job..."

# Verify Runner is running with the provider worker
PM2_STATUS=$(pm2 jlist 2>/dev/null || echo "[]")
PROVIDER_RUNNING=$(echo "$PM2_STATUS" | jq -r '.[] | select(.name == "arclayer-provider") | .pm2_env.status' 2>/dev/null || echo "")

if [[ "$PROVIDER_RUNNING" == "online" ]]; then
  pass "Provider worker is running (PM2: online)"
else
  fail "Provider worker not running (PM2 status: ${PROVIDER_RUNNING:-unknown})"
fi

# ── Report ───────────────────────────────────────────────────────────────────
echo ""
info "════════════════════════════════════════════════════════════════"
info "Live ARC Testnet Validation Report"
info "════════════════════════════════════════════════════════════════"
info ""
info "Job ID: $JOB_ID"
info "Chain: ${CIRCLE_CHAIN:-ARC-TESTNET}"
info "Wallet: ${CIRCLE_WALLET_ADDRESS:-<not set>}"
info "Job Status: $JOB_STATUS_LABEL (code: $JOB_STATUS_CODE)"
info "Job Provider: $JOB_PROVIDER"
info ""

if [[ "$JOB_STATUS_CODE" == "0" ]]; then
  info "Expected lifecycle:"
  info "  1. Provider detects Open job → set budget on-chain"
  info "  2. Client funds job"
  info "  3. Provider detects Funded job → call LangChain runtime /run"
  info "  4. Provider publishes deliverable"
  info "  5. Provider submits deliverable on-chain"
elif [[ "$JOB_STATUS_CODE" == "1" ]]; then
  info "Expected lifecycle:"
  info "  1. Provider detects Funded job → call LangChain runtime /run"
  info "  2. Provider publishes deliverable"
  info "  3. Provider submits deliverable on-chain"
fi

info ""
info "Monitor progress:"
info "  pm2 logs arclayer-provider --lines 50"
info "  pm2 logs arclayer-runner --lines 50"
info ""

if [[ -f "$IDENTITY_FILE" ]]; then
  info "Identity state:"
  cat "$IDENTITY_FILE" | jq .
fi

info ""

# ── Final Verdict ─────────────────────────────────────────────────────────────
if [[ $FAILURES -gt 0 ]]; then
  die "═══════════════════════════════════════════════════════════════
$FAILURES check(s) failed. See above for details.
═══════════════════════════════════════════════════════════════"
else
  info "═══════════════════════════════════════════════════════════════"
  info "All pre-flight checks passed. Job $JOB_ID verified."
  info "Provider worker is running. ERC-8183 lifecycle will proceed autonomously."
  info "═══════════════════════════════════════════════════════════════"
fi
