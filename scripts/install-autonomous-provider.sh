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
#     --agent-name "Agent Jumbo" \
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
#
# Identity semantics:
#   ARCLAYER_AGENT_NAME = human-readable public name (e.g. "Agent Jumbo")
#   ARCLAYER_AGENT_SLUG = local safe alias (e.g. "agent-jumbo")
#   ARCLAYER_AGENT_ID   = ERC-8004 tokenId (e.g. "123")
#     → Patched ONLY after identity is confirmed. NOT set as slug.
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

# Derive slug from agent name (local safe alias, NOT the canonical agentId)
AGENT_SLUG="$(slugify "$AGENT_NAME")"

info "Starting ArcLayer autonomous provider installation"
info "Install dir: $INSTALL_DIR"
info "Agent name: $AGENT_NAME"
info "Agent slug: $AGENT_SLUG"
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

cat > "$INSTALL_DIR/.env.runner" << RUNNEREOF
# ArcLayer Runner — autonomous provider configuration
# Generated by install-autonomous-provider.sh
#
# Identity semantics:
#   ARCLAYER_AGENT_NAME = human-readable public name (e.g. "Agent Jumbo")
#   ARCLAYER_AGENT_SLUG = local safe alias (e.g. "agent-jumbo")
#   ARCLAYER_AGENT_ID   = ERC-8004 tokenId — patched ONLY after confirmed identity
#     Do NOT set ARCLAYER_AGENT_ID here. It is patched after identity confirm.

# ── Runner Identity ─────────────────────────────────────────────────────
ARCLAYER_AGENT_NAME=${AGENT_NAME}
ARCLAYER_AGENT_SLUG=${AGENT_SLUG}
# ARCLAYER_AGENT_ID is patched only after confirmed ERC-8004 tokenId exists
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

# Build order: SDK first (schemas), then runner-core, then adapter, then runner.
# SDK and circle-dev-wallet-adapter are runtime workspace dependencies of runner.
info "Building SDK..."
pnpm --filter @arclayer/sdk build

info "Building runner-core..."
pnpm --filter @arclayer/runner-core build

info "Building Circle Dev Wallet adapter..."
pnpm --filter @arclayer/circle-dev-wallet-adapter build

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

# Use pnpm workspace command for identity ensure
IDENTITY_RESULT=$(pnpm --filter @arclayer/runner start -- identity ensure "${IDENTITY_ARGS[@]}" 2>&1) || {
  if [[ "$AUTO_MINT_IDENTITY" == "true" ]]; then
    die "Identity registration failed. Check wallet balance and try again.

Output: $IDENTITY_RESULT"
  else
    warn "Identity not found. Run with --auto-mint-identity or register manually:"
    warn "  pnpm --filter @arclayer/runner start -- identity ensure --agent-name \"$AGENT_NAME\" --auto-register"
  fi
}

echo "$IDENTITY_RESULT"

# ── Step 9: Patch ARCLAYER_AGENT_ID from confirmed identity ──────────────────
info "Step 9: Checking confirmed identity for ARCLAYER_AGENT_ID..."

IDENTITY_FILE="$HOME/.arclayer/runner/identity.json"
TOKEN_ID=""

if [[ -f "$IDENTITY_FILE" ]]; then
  IDENTITY_STATUS=$(jq -r '.status // "unknown"' "$IDENTITY_FILE")
  if [[ "$IDENTITY_STATUS" == "confirmed" ]]; then
    TOKEN_ID=$(jq -r '.tokenId // ""' "$IDENTITY_FILE")
  fi
fi

if [[ -n "$TOKEN_ID" ]]; then
  info "Identity confirmed: tokenId=$TOKEN_ID"
  info "Patching ARCLAYER_AGENT_ID=$TOKEN_ID into .env.runner"

  # Patch .env.runner with the real tokenId (not slug)
  if grep -q "^# ARCLAYER_AGENT_ID" "$INSTALL_DIR/.env.runner"; then
    # Replace the comment line with the actual value
    sed -i "s|^# ARCLAYER_AGENT_ID.*|ARCLAYER_AGENT_ID=${TOKEN_ID}|" "$INSTALL_DIR/.env.runner"
  elif grep -q "^ARCLAYER_AGENT_ID=" "$INSTALL_DIR/.env.runner"; then
    sed -i "s|^ARCLAYER_AGENT_ID=.*|ARCLAYER_AGENT_ID=${TOKEN_ID}|" "$INSTALL_DIR/.env.runner"
  else
    echo "ARCLAYER_AGENT_ID=${TOKEN_ID}" >> "$INSTALL_DIR/.env.runner"
  fi
else
  if [[ "$AUTO_MINT_IDENTITY" == "true" ]]; then
    die "Identity not confirmed after registration. ARCLAYER_AGENT_ID not set. Provider will NOT start.

Re-run after tx confirms:
  pnpm --filter @arclayer/runner start -- identity ensure --agent-name \"$AGENT_NAME\" --auto-register"
  else
    warn "Identity not confirmed. ARCLAYER_AGENT_ID not set."
    warn "Provider will not start until ARCLAYER_AGENT_ID (ERC-8004 tokenId) is confirmed."
    warn "Run with --auto-mint-identity, or register manually and re-run installer."
  fi
fi

# ── Step 10: Verify Prerequisites ─────────────────────────────────────────────
info "Step 10: Verifying prerequisites..."

# Check MCP token
if [[ -z "$MCP_TOKEN" ]]; then
  die "ARCLAYER_MCP_TOKEN is required"
fi

# Check wallet address
if [[ -z "$CIRCLE_WALLET_ADDRESS" ]]; then
  die "CIRCLE_WALLET_ADDRESS is required"
fi

# Check ARCLAYER_AGENT_ID is set (tokenId required for provider to start)
if ! grep -q "^ARCLAYER_AGENT_ID=" "$INSTALL_DIR/.env.runner" 2>/dev/null; then
  die "ARCLAYER_AGENT_ID not set in .env.runner. Provider cannot start without confirmed ERC-8004 tokenId."
fi

info "Prerequisites verified"

# ── Step 11: Stop Existing PM2 Services ──────────────────────────────────────
info "Step 11: Configuring PM2 services..."

pm2 delete arclayer-langchain-runtime 2>/dev/null || true
pm2 delete arclayer-runner 2>/dev/null || true
pm2 delete arclayer-provider 2>/dev/null || true

# ── Step 12: Start PM2 Services ──────────────────────────────────────────────
info "Step 12: Starting PM2 services..."

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

# ── Step 13: Health Checks ───────────────────────────────────────────────────
info "Step 13: Running health checks..."

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
info "Identity:"
info "  Agent Name: $AGENT_NAME"
info "  Agent Slug: $AGENT_SLUG"
if [[ -n "$TOKEN_ID" ]]; then
  info "  Agent ID (tokenId): $TOKEN_ID"
else
  info "  Agent ID (tokenId): <pending — not yet confirmed>"
fi
info "  Identity file: $HOME/.arclayer/runner/identity.json"
info ""
info "Commands:"
info "  pm2 status                  — Check service status"
info "  pm2 logs arclayer-provider  — View provider logs"
info "  pm2 logs arclayer-runner    — View runner logs"
info ""
info "Config:   $INSTALL_DIR/.env.runner"
info ""
info "To validate on ARC testnet:"
info "  bash scripts/live-test-autonomous-provider-arc.sh --live-arc-testnet --job-id <JOB_ID>"
info "════════════════════════════════════════════════════════════════"
