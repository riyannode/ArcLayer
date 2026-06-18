#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# install-autonomous-provider.sh — One-command ARC testnet autonomous provider
#
# Usage:
#   bash install-autonomous-provider.sh \
#     --mcp-base-url https://... \
#     --mcp-token ... \
#     --runner-secret ... \
#     --openai-api-key ... \
#     --circle-api-key ... \
#     --circle-entity-secret ... \
#     --wallet-set-id ... \
#     --wallet-id ... \
#     --wallet-address 0x... \
#     --agent-name "my-provider" \
#     [--auto-mint-identity] \
#     [--repo-url https://github.com/riyannode/ArcLayer] \
#     [--install-dir /opt/arclayer]
#
# Requirements:
#   - Ubuntu 22.04+ / Debian 12+
#   - Root or sudo access
#   - ARC testnet USDC in wallet (https://faucet.circle.com)
#
# This script NEVER accepts or stores private keys.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/arclayer"
REPO_URL="https://github.com/riyannode/ArcLayer"
AUTO_MINT_IDENTITY=false
CIRCLE_CHAIN="ARC-TESTNET"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()   { error "$*"; exit 1; }

# ── Helpers ──────────────────────────────────────────────────────────────────

# Slugify agent name for use in env vars (no spaces, lowercase, alphanumeric + hyphens)
slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//'
}

# ── Parse Args ───────────────────────────────────────────────────────────────
MCP_BASE_URL=""
MCP_TOKEN=""
RUNNER_SECRET=""
OPENAI_API_KEY=""
CIRCLE_API_KEY=""
CIRCLE_ENTITY_SECRET=""
CIRCLE_WALLET_SET_ID=""
CIRCLE_WALLET_ID=""
CIRCLE_WALLET_ADDRESS=""
AGENT_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mcp-base-url)       MCP_BASE_URL="$2"; shift 2 ;;
    --mcp-token)          MCP_TOKEN="$2"; shift 2 ;;
    --runner-secret)      RUNNER_SECRET="$2"; shift 2 ;;
    --openai-api-key)     OPENAI_API_KEY="$2"; shift 2 ;;
    --circle-api-key)     CIRCLE_API_KEY="$2"; shift 2 ;;
    --circle-entity-secret) CIRCLE_ENTITY_SECRET="$2"; shift 2 ;;
    --wallet-set-id)      CIRCLE_WALLET_SET_ID="$2"; shift 2 ;;
    --wallet-id)          CIRCLE_WALLET_ID="$2"; shift 2 ;;
    --wallet-address)     CIRCLE_WALLET_ADDRESS="$2"; shift 2 ;;
    --agent-name)         AGENT_NAME="$2"; shift 2 ;;
    --auto-mint-identity) AUTO_MINT_IDENTITY=true; shift ;;
    --repo-url)           REPO_URL="$2"; shift 2 ;;
    --install-dir)        INSTALL_DIR="$2"; shift 2 ;;
    --help)
      echo "Usage: $0 --mcp-base-url URL --mcp-token TOKEN --runner-secret SECRET ..."
      echo "See script header for full argument list."
      exit 0
      ;;
    *) die "Unknown option: $1" ;;
  esac
done

# ── Validate Required Args ───────────────────────────────────────────────────
validate_required() {
  local name="$1" value="$2"
  if [[ -z "$value" ]]; then
    die "Missing required argument: --$name"
  fi
}

validate_required "mcp-base-url"       "$MCP_BASE_URL"
validate_required "mcp-token"          "$MCP_TOKEN"
validate_required "runner-secret"      "$RUNNER_SECRET"
validate_required "openai-api-key"     "$OPENAI_API_KEY"
validate_required "circle-api-key"     "$CIRCLE_API_KEY"
validate_required "circle-entity-secret" "$CIRCLE_ENTITY_SECRET"
validate_required "wallet-set-id"      "$CIRCLE_WALLET_SET_ID"
validate_required "wallet-id"          "$CIRCLE_WALLET_ID"
validate_required "wallet-address"     "$CIRCLE_WALLET_ADDRESS"
validate_required "agent-name"         "$AGENT_NAME"

# Validate ARC-TESTNET
if [[ "$CIRCLE_CHAIN" != "ARC-TESTNET" ]]; then
  die "CIRCLE_CHAIN must be ARC-TESTNET, got: $CIRCLE_CHAIN"
fi

# Validate wallet address format
if ! [[ "$CIRCLE_WALLET_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
  die "Invalid wallet address format: $CIRCLE_WALLET_ADDRESS"
fi

# Reject private key env vars
for var in PRIVATE_KEY DEPLOYER_KEY WALLET_PRIVATE_KEY; do
  if [[ -n "${!var:-}" ]]; then
    die "This script does not accept private keys. Unset $var and retry."
  fi
done

info "Starting ArcLayer autonomous provider installation"
info "Install dir: $INSTALL_DIR"
info "Agent name: $AGENT_NAME"
info "Wallet: $CIRCLE_WALLET_ADDRESS"
info "Chain: $CIRCLE_CHAIN"

# ── Step 1: Install System Dependencies ──────────────────────────────────────
info "Step 1: Installing system dependencies..."

apt-get update -qq
apt-get install -y -qq curl git jq > /dev/null 2>&1

# ── Step 2: Install Node.js 22 ───────────────────────────────────────────────
info "Step 2: Installing Node.js 22..."

if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VERSION" -ge 22 ]]; then
    info "Node.js $NODE_VERSION already installed"
  else
    warn "Node.js $NODE_VERSION found, need 22+. Installing..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs > /dev/null 2>&1
  fi
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs > /dev/null 2>&1
fi

info "Node.js $(node --version) installed"

# ── Step 3: Install pnpm ────────────────────────────────────────────────────
info "Step 3: Installing pnpm..."

if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm@latest > /dev/null 2>&1
fi

info "pnpm $(pnpm --version) installed"

# ── Step 4: Install PM2 ─────────────────────────────────────────────────────
info "Step 4: Installing PM2..."

if ! command -v pm2 &>/dev/null; then
  npm install -g pm2@latest > /dev/null 2>&1
fi

info "PM2 installed"

# ── Step 5: Clone/Update Repo ───────────────────────────────────────────────
info "Step 5: Setting up repository..."

if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating existing repo..."
  cd "$INSTALL_DIR"
  git fetch origin
  git checkout main
  git pull origin main
else
  info "Cloning repo..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

info "Repo at $(git rev-parse --short HEAD)"

# ── Step 6: Write Environment Files ─────────────────────────────────────────
info "Step 6: Writing environment files..."

# Slugify agent name for safe use in env vars
AGENT_ID="agent-$(slugify "$AGENT_NAME")"

cat > "$INSTALL_DIR/.env.runner" << RUNNEREOF
# ArcLayer Runner — autonomous provider configuration
# Generated by install-autonomous-provider.sh

# ── Runner Identity ─────────────────────────────────────────────────────
ARCLAYER_AGENT_ID=${AGENT_ID}
ARCLAYER_DEFAULT_ROLE=provider
ARCLAYER_RUNNER_SECRET=${RUNNER_SECRET}

# ── MCP Bridge ──────────────────────────────────────────────────────────
ARCLAYER_MCP_BASE_URL=${MCP_BASE_URL}
ARCLAYER_MCP_TOKEN=${MCP_TOKEN}

# ── Runtime ─────────────────────────────────────────────────────────────
ARCLAYER_RUNTIME_KIND=custom
ARCLAYER_RUNTIME_ENDPOINT=http://127.0.0.1:8788
ARCLAYER_RUNTIME_RUN_PATH=/run
ARCLAYER_RUNTIME_TIMEOUT_MS=120000

# ── Circle Wallet (Dev Wallet SDK) ──────────────────────────────────────
CIRCLE_API_KEY=${CIRCLE_API_KEY}
CIRCLE_ENTITY_SECRET=${CIRCLE_ENTITY_SECRET}
CIRCLE_WALLET_SET_ID=${CIRCLE_WALLET_SET_ID}
CIRCLE_WALLET_ID=${CIRCLE_WALLET_ID}
CIRCLE_WALLET_ADDRESS=${CIRCLE_WALLET_ADDRESS}
CIRCLE_CHAIN=ARC-TESTNET

# ── Identity Register ───────────────────────────────────────────────────
ARCLAYER_ALLOW_IDENTITY_REGISTER=true

# ── Runner HTTP ─────────────────────────────────────────────────────────
ARCLAYER_RUNNER_PORT=8787
ARCLAYER_RUNNER_HOST=127.0.0.1
RUNNEREOF

cat > "$INSTALL_DIR/.env.langchain-runtime" << RUNTIMEEOF
# LangChain Runtime Server
# Generated by install-autonomous-provider.sh

OPENAI_API_KEY=${OPENAI_API_KEY}
OPENAI_MODEL=gpt-4o
RUNTIME_PORT=8788
RUNTIME_HOST=127.0.0.1
RUNTIMEEOF

# Restrict permissions
chmod 600 "$INSTALL_DIR/.env.runner"
chmod 600 "$INSTALL_DIR/.env.langchain-runtime"

info "Environment files written"

# ── Step 7: Install Dependencies & Build ─────────────────────────────────────
info "Step 7: Installing dependencies and building..."

cd "$INSTALL_DIR"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

info "Building runner-core..."
pnpm --filter @arclayer/runner-core build

info "Building langchain-adapter..."
pnpm --filter @arclayer/langchain-adapter build

info "Building runner..."
pnpm --filter @arclayer/runner build

info "Building langchain-runtime-server..."
pnpm --filter langchain-runtime-server build

info "Build complete"

# ── Step 8: Ensure ERC-8004 Identity ────────────────────────────────────────
info "Step 8: Ensuring ERC-8004 identity..."

cd "$INSTALL_DIR"
IDENTITY_ARGS=(
  --agent-name "$AGENT_NAME"
  --role provider
  --description "ArcLayer autonomous provider agent"
  --capabilities "coding,analysis,delivery"
)

if [[ "$AUTO_MINT_IDENTITY" == "true" ]]; then
  IDENTITY_ARGS+=(--auto-register)
fi

# Load env for identity ensure
set -a
source "$INSTALL_DIR/.env.runner"
set +a

node packages/runner/dist/index.js identity ensure "${IDENTITY_ARGS[@]}" || {
  if [[ "$AUTO_MINT_IDENTITY" == "true" ]]; then
    die "Identity registration failed. Check wallet balance and try again."
  else
    warn "Identity not found. Run with --auto-mint-identity or register manually:"
    warn "  node packages/runner/dist/index.js identity ensure --agent-name $AGENT_NAME --auto-register"
  fi
}

# ── Step 9: Verify Prerequisites ─────────────────────────────────────────────
info "Step 9: Verifying prerequisites..."

# Check MCP token
if [[ -z "$MCP_TOKEN" ]]; then
  die "ARCLAYER_MCP_TOKEN is required"
fi

# Check wallet address
if [[ -z "$CIRCLE_WALLET_ADDRESS" ]]; then
  die "CIRCLE_WALLET_ADDRESS is required"
fi

info "Prerequisites verified"

# ── Step 10: Stop Existing PM2 Services ──────────────────────────────────────
info "Step 10: Configuring PM2 services..."

pm2 delete arclayer-langchain-runtime 2>/dev/null || true
pm2 delete arclayer-runner 2>/dev/null || true
pm2 delete arclayer-provider 2>/dev/null || true

# ── Step 11: Start PM2 Services ──────────────────────────────────────────────
info "Step 11: Starting PM2 services..."

cd "$INSTALL_DIR"

# 1. LangChain Runtime Server
pm2 start "bash -lc 'set -a; source ${INSTALL_DIR}/.env.langchain-runtime; set +a; pnpm --filter langchain-runtime-server start:prod'" \
  --name arclayer-langchain-runtime

# 2. ArcLayer Runner (HTTP API)
pm2 start "bash -lc 'set -a; source ${INSTALL_DIR}/.env.runner; set +a; pnpm --filter @arclayer/runner start'" \
  --name arclayer-runner

# 3. ArcLayer Provider (autonomous worker)
pm2 start "bash -lc 'set -a; source ${INSTALL_DIR}/.env.runner; set +a; pnpm --filter @arclayer/runner start -- provider'" \
  --name arclayer-provider

pm2 save

info "PM2 services started"

# ── Step 12: Health Checks ───────────────────────────────────────────────────
info "Step 12: Running health checks..."

sleep 5

# Check LangChain runtime
if curl -sf http://127.0.0.1:8788/health > /dev/null 2>&1; then
  info "✅ LangChain runtime healthy"
else
  warn "⚠️  LangChain runtime not responding yet (may still be starting)"
fi

# Check Runner
if curl -sf http://127.0.0.1:8787/health > /dev/null 2>&1; then
  info "✅ Runner healthy"
else
  warn "⚠️  Runner not responding yet (may still be starting)"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
info "════════════════════════════════════════════════════════════════"
info "ArcLayer Autonomous Provider Installation Complete"
info "════════════════════════════════════════════════════════════════"
info ""
info "PM2 services:"
info "  arclayer-langchain-runtime  — LangChain runtime (port 8788)"
info "  arclayer-runner             — Runner HTTP API (port 8787)"
info "  arclayer-provider           — Autonomous provider worker"
info ""
info "Commands:"
info "  pm2 status                  — Check service status"
info "  pm2 logs arclayer-provider  — View provider logs"
info "  pm2 logs arclayer-runner    — View runner logs"
info ""
info "Identity: $HOME/.arclayer/runner/identity.json"
info "Config:   $INSTALL_DIR/.env.runner"
info ""
info "To validate on ARC testnet:"
info "  bash scripts/live-test-autonomous-provider-arc.sh --live-arc-testnet --job-id <JOB_ID>"
info "════════════════════════════════════════════════════════════════"
