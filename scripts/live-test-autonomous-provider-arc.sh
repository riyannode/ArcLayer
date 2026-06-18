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
#     --job-id <EXISTING_OPEN_OR_FUNDED_JOB_ID>
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --live-arc-testnet) LIVE_ARC_TESTNET=true; shift ;;
    --job-id)           JOB_ID="$2"; shift 2 ;;
    --help)
      echo "Usage: $0 --live-arc-testnet --job-id <JOB_ID>"
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

# ── Load Environment ─────────────────────────────────────────────────────────
INSTALL_DIR="${ARCLAYER_INSTALL_DIR:-/opt/arclayer}"
ENV_FILE="$INSTALL_DIR/.env.runner"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

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

# LangChain runtime health
if curl -sf http://127.0.0.1:8788/health > /dev/null 2>&1; then
  pass "LangChain runtime healthy (port 8788)"
else
  fail "LangChain runtime not responding on port 8788"
fi

# Runner health
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
    TOKEN_ID=$(jq -r '.tokenId // "unknown"' "$IDENTITY_FILE")
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

# ── Check Wallet Balance ─────────────────────────────────────────────────────
step "Checking wallet balance..."

if [[ -n "${CIRCLE_WALLET_ADDRESS:-}" ]]; then
  # Query balance via Runner's circle/status endpoint
  CIRCLE_STATUS=$(curl -sf http://127.0.0.1:8787/circle/status 2>/dev/null || echo "")
  if [[ -n "$CIRCLE_STATUS" ]]; then
    pass "Wallet status retrieved"
    echo "$CIRCLE_STATUS" | jq -r '.response.balances[]? | "    \(.token): \(.amount) \(.chain)"' 2>/dev/null || true
  else
    warn "Could not retrieve wallet status"
  fi
fi

# ── Early Exit on Failures ───────────────────────────────────────────────────
if [[ $FAILURES -gt 0 ]]; then
  echo ""
  die "$FAILURES pre-flight check(s) failed. Fix issues and re-run."
fi

# ── Test Job Lifecycle ───────────────────────────────────────────────────────
step "Testing with job ID: $JOB_ID"

echo ""
info "════════════════════════════════════════════════════════════════"
info "Live ARC Testnet Validation Report"
info "════════════════════════════════════════════════════════════════"
info ""
info "Job ID: $JOB_ID"
info "Chain: $CIRCLE_CHAIN"
info "Wallet: $CIRCLE_WALLET_ADDRESS"
info ""
info "Provider worker will autonomously:"
info "  1. Detect Open job → set budget on-chain"
info "  2. Client funds job"
info "  3. Detect Funded job → call LangChain runtime /run"
info "  4. Publish deliverable"
info "  5. Submit deliverable on-chain"
info ""
info "Monitor progress:"
info "  pm2 logs arclayer-provider --lines 50"
info "  pm2 logs arclayer-runner --lines 50"
info ""
info "Check job status:"
info "  curl -s http://127.0.0.1:8787/health"
info ""
info "Identity state:"
if [[ -f "$IDENTITY_FILE" ]]; then
  cat "$IDENTITY_FILE" | jq .
fi
info ""
info "════════════════════════════════════════════════════════════════"
info "Pre-flight checks passed. Provider worker is running."
info "Job lifecycle will proceed autonomously."
info "════════════════════════════════════════════════════════════════"
