#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ArcLayer ERC-8183 Bot One-Click Installer
#
# Usage:
#   curl -fsSL https://arclayers.xyz/install/erc8183-bot.sh | bash
#
# Installs a standalone ERC-8183 PM2 bot (client / provider / evaluator)
# under ~/arclayer-bots/erc8183-<role>. No full ArcLayer repo needed.
#
# Security:
#   - Private key is read via hidden input (read -s), never echoed
#   - .env is chmod 600
#   - No secrets in URL, logs, or heartbeat body
#   - No ARCLAYER_API_KEY fallback
#   - No WORKER_* env
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="https://github.com/riyannode/ArcLayer.git"
BOTS_DIR="$HOME/arclayer-bots"
VERSION="0.1.0"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC} $*"; }
ok()    { echo -e "${GREEN}[ok]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
fail()  { echo -e "${RED}[error]${NC} $*"; exit 1; }

# ── Preflight checks ─────────────────────────────────────────────────────────

check_deps() {
  local missing=()
  command -v git   >/dev/null 2>&1 || missing+=("git")
  command -v node  >/dev/null 2>&1 || missing+=("node")
  command -v npm   >/dev/null 2>&1 || missing+=("npm")

  if [ ${#missing[@]} -gt 0 ]; then
    fail "Missing required tools: ${missing[*]}\nInstall them and retry."
  fi

  # Check git version for sparse checkout support (>= 2.25)
  local git_major git_minor
  git_major=$(git --version | grep -oP '\d+\.\d+' | head -1 | cut -d. -f1)
  git_minor=$(git --version | grep -oP '\d+\.\d+' | head -1 | cut -d. -f2)
  if [ "$git_major" -lt 2 ] || { [ "$git_major" -eq 2 ] && [ "$git_minor" -lt 25 ]; }; then
    fail "Git >= 2.25 required for sparse checkout (found: $(git --version)).\nPlease update git."
  fi

  ok "Dependencies: git $(git --version | grep -oP '\d+\.\d+\.\d+'), node $(node --version)"
}

check_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    ok "PM2 already installed: $(pm2 --version)"
    return
  fi
  info "Installing PM2 globally..."
  npm install -g pm2 2>/dev/null || fail "Failed to install PM2. Try: npm install -g pm2"
  ok "PM2 installed: $(pm2 --version)"
}

# ── Role selection ────────────────────────────────────────────────────────────

select_role() {
  echo ""
  echo -e "${BOLD}═══ ArcLayer ERC-8183 Bot Installer ═══${NC}"
  echo ""
  echo "Choose your bot role:"
  echo "  1) client     — creates and funds ERC-8183 jobs"
  echo "  2) provider   — claims, processes, and submits job deliverables"
  echo "  3) evaluator  — reviews submitted work and completes/rejects escrow"
  echo ""

  local choice
  while true; do
    read -rp "Enter 1, 2, or 3: " choice
    case "$choice" in
      1) ROLE="client";     ROLE_LABEL="Client";     break ;;
      2) ROLE="provider";   ROLE_LABEL="Provider";   break ;;
      3) ROLE="evaluator";  ROLE_LABEL="Evaluator";  break ;;
      *) warn "Invalid choice. Please enter 1, 2, or 3." ;;
    esac
  done

  ok "Selected role: ${ROLE_LABEL}"
}

# ── Collect user inputs ──────────────────────────────────────────────────────

collect_inputs() {
  echo ""
  echo -e "${BOLD}── Configuration ──${NC}"
  echo ""

  # Agent ID
  while true; do
    read -rp "Agent ID (numeric, from ERC-8004 registration): " AGENT_ID
    if [[ "$AGENT_ID" =~ ^[0-9]+$ ]]; then
      break
    fi
    warn "Agent ID must be a numeric value."
  done

  # Wallet address
  while true; do
    read -rp "Wallet address (0x...): " WALLET_ADDRESS
    if [[ "$WALLET_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
      break
    fi
    warn "Invalid Ethereum address. Must be 0x + 40 hex chars."
  done

  # API key
  while true; do
    read -rp "API key (ak_...): " API_KEY
    if [[ "$API_KEY" =~ ^ak_ ]]; then
      break
    fi
    warn "API key must start with ak_."
  done

  # Private key (hidden input)
  echo ""
  info "Private key will be hidden (no echo)."
  while true; do
    read -rsp "Wallet private key: " PRIVATE_KEY
    echo ""
    if [ -n "$PRIVATE_KEY" ]; then
      break
    fi
    warn "Private key cannot be empty."
  done

  # LLM provider (optional)
  echo ""
  echo "Optional: LLM provider for evaluation (press Enter to skip):"
  echo "  1) none (skip)"
  echo "  2) OpenAI"
  echo "  3) Anthropic"
  echo "  4) Ollama"
  echo "  5) Hermes"
  echo "  6) OpenClaw"
  echo ""

  LLM_PROVIDER="none"
  read -rp "LLM provider [1]: " llm_choice
  case "${llm_choice:-1}" in
    1|"") LLM_PROVIDER="none" ;;
    2)    LLM_PROVIDER="openai" ;;
    3)    LLM_PROVIDER="anthropic" ;;
    4)    LLM_PROVIDER="ollama" ;;
    5)    LLM_PROVIDER="hermes" ;;
    6)    LLM_PROVIDER="openclaw" ;;
    *)    LLM_PROVIDER="none" ;;
  esac

  if [ "$LLM_PROVIDER" != "none" ]; then
    read -rp "LLM API base URL: " LLM_BASE_URL
    read -rsp "LLM API key: " LLM_API_KEY
    echo ""
    read -rp "LLM model name [auto]: " LLM_MODEL
    LLM_MODEL="${LLM_MODEL:-auto}"
  fi
}

# ── Sparse clone + copy ──────────────────────────────────────────────────────

install_runtime() {
  local tmp_dir="/tmp/arclayer-install-$$"
  local target_dir="${BOTS_DIR}/erc8183-${ROLE}"

  echo ""
  echo -e "${BOLD}── Installing ${ROLE_LABEL} Bot ──${NC}"
  echo ""

  # Create target directory
  mkdir -p "$target_dir"

  # Sparse clone
  info "Downloading bot runtime (sparse clone)..."
  if [ -d "$tmp_dir" ]; then
    rm -rf "$tmp_dir"
  fi

  git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$tmp_dir" 2>/dev/null \
    || fail "Failed to clone repo. Check your internet connection."

  cd "$tmp_dir"
  git sparse-checkout set examples/external-erc8183-bots 2>/dev/null \
    || fail "Failed to set sparse checkout."

  # Verify source exists
  local src_dir="$tmp_dir/examples/external-erc8183-bots"
  if [ ! -d "$src_dir" ]; then
    rm -rf "$tmp_dir"
    fail "Source directory not found in repo."
  fi

  # Copy shared + selected role only
  info "Copying ${ROLE_LABEL} runtime files..."
  cp "$src_dir/package.json" "$target_dir/"
  [ -f "$src_dir/package-lock.json" ] && cp "$src_dir/package-lock.json" "$target_dir/"

  # Copy shared directory
  cp -r "$src_dir/shared" "$target_dir/"
  # Copy scripts directory
  cp -r "$src_dir/scripts" "$target_dir/"
  # Copy selected role bot directory
  cp -r "$src_dir/${ROLE}-bot" "$target_dir/"

  # Copy .gitignore if present
  [ -f "$src_dir/.gitignore" ] && cp "$src_dir/.gitignore" "$target_dir/"

  # Copy README for reference
  [ -f "$src_dir/README.md" ] && cp "$src_dir/README.md" "$target_dir/"

  # Cleanup temp clone
  rm -rf "$tmp_dir"
  ok "Runtime files installed to ${target_dir}"
}

# ── Generate .env ─────────────────────────────────────────────────────────────

generate_env() {
  local env_file="${BOTS_DIR}/erc8183-${ROLE}/${ROLE}-bot/.env"
  local private_key_normalized="$PRIVATE_KEY"

  # Ensure 0x prefix on private key
  if [[ ! "$private_key_normalized" =~ ^0x ]]; then
    private_key_normalized="0x${private_key_normalized}"
  fi

  info "Generating .env for ${ROLE_LABEL}..."

  case "$ROLE" in
    client)
      cat > "$env_file" << ENVEOF
# ArcLayer ERC-8183 Client Bot — generated by installer
ARCLAYER_BASE_URL=https://arclayers.xyz
CLIENT_AGENT_ID=${AGENT_ID}
BUYER_AGENT_ID=${AGENT_ID}
CLIENT_ADDRESS=${WALLET_ADDRESS}
CLIENT_PRIVATE_KEY=${private_key_normalized}
CLIENT_API_KEY=${API_KEY}
ARC_CHAIN_ID=5042002
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_RPC_FALLBACK_URL=https://rpc.drpc.testnet.arc.network
ENVEOF
      ;;

    provider)
      cat > "$env_file" << ENVEOF
# ArcLayer ERC-8183 Provider Bot — generated by installer
ARCLAYER_BASE_URL=https://arclayers.xyz
PROVIDER_AGENT_ID=${AGENT_ID}
PROVIDER_ADDRESS=${WALLET_ADDRESS}
PROVIDER_PRIVATE_KEY=${private_key_normalized}
PROVIDER_API_KEY=${API_KEY}
PROVIDER_CAPABILITIES=market-summary,risk-check,sentiment-scan,execution-plan,data-quality-check
ARC_CHAIN_ID=5042002
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_RPC_FALLBACK_URL=https://rpc.drpc.testnet.arc.network
JOB_POLL_INTERVAL_MS=30000
MAX_ACTIVE_JOBS=3
CLAIM_TTL_SECONDS=600
AUTONOMOUS_TX=true
IGNORE_JOBS_BEFORE=
RECOVER_OLD_JOBS=false
ENVEOF
      ;;

    evaluator)
      cat > "$env_file" << ENVEOF
# ArcLayer ERC-8183 Evaluator Bot — generated by installer
ARCLAYER_BASE_URL=https://arclayers.xyz
EVALUATOR_AGENT_ID=${AGENT_ID}
EVALUATOR_ADDRESS=${WALLET_ADDRESS}
EVALUATOR_PRIVATE_KEY=${private_key_normalized}
EVALUATOR_API_KEY=${API_KEY}
ARC_CHAIN_ID=5042002
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_RPC_FALLBACK_URL=https://rpc.drpc.testnet.arc.network
ENVEOF
      ;;
  esac

  # Append LLM config if provided
  if [ "$LLM_PROVIDER" != "none" ]; then
    cat >> "$env_file" << LLMEOF

# LLM Configuration
LLM_PROVIDER=${LLM_PROVIDER}
LLM_BASE_URL=${LLM_BASE_URL:-}
LLM_API_KEY=${LLM_API_KEY:-}
LLM_MODEL=${LLM_MODEL:-xiaomi/mimo-v2-flash}
LLMEOF
  fi

  chmod 600 "$env_file"
  ok ".env written (chmod 600)"
}

# ── Install deps + start PM2 ─────────────────────────────────────────────────

start_bot() {
  local bot_dir="${BOTS_DIR}/ec8183-${ROLE}"
  bot_dir="${BOTS_DIR}/erc8183-${ROLE}"
  local ecosystem="${bot_dir}/${ROLE}-bot/ecosystem.config.cjs"
  local process_name="arclayer-erc8183-${ROLE}"

  echo ""
  echo -e "${BOLD}── Starting ${ROLE_LABEL} Bot ──${NC}"
  echo ""

  # Install dependencies
  info "Installing npm dependencies..."
  cd "$bot_dir"
  npm install --production 2>/dev/null || npm install
  ok "Dependencies installed"

  # Check if ecosystem config exists
  if [ ! -f "$ecosystem" ]; then
    warn "ecosystem.config.cjs not found at ${ecosystem}"
    warn "Starting bot directly instead..."
    pm2 start "${ROLE}-bot/index.js" \
      --name "$process_name" \
      --cwd "$bot_dir" \
      --max-restarts 10 \
      --restart-delay 5000 \
      --exp-backoff-restart-delay 100
  else
    # Delete existing process if any
    pm2 delete "$process_name" 2>/dev/null || true
    pm2 start "$ecosystem"
  fi

  pm2 save 2>/dev/null || true

  echo ""
  ok "Bot started as PM2 process: ${process_name}"
  echo ""
  echo -e "${BOLD}── Status ──${NC}"
  pm2 list
  echo ""
  echo -e "${BOLD}── Recent Logs ──${NC}"
  pm2 logs "$process_name" --lines 10 --nostream 2>/dev/null || true
}

# ── Print summary ─────────────────────────────────────────────────────────────

print_summary() {
  local target_dir="${BOTS_DIR}/erc8183-${ROLE}"
  local process_name="arclayer-erc8183-${ROLE}"

  echo ""
  echo -e "${BOLD}═══ Installation Complete ═══${NC}"
  echo ""
  echo -e "  Role:        ${GREEN}${ROLE_LABEL}${NC}"
  echo -e "  Agent ID:    ${AGENT_ID}"
  echo -e "  Install dir: ${target_dir}"
  echo -e "  Process:     ${process_name}"
  echo ""
  echo -e "${BOLD}── Useful Commands ──${NC}"
  echo "  pm2 status"
  echo "  pm2 logs ${process_name} --lines 20"
  echo "  pm2 restart ${process_name}"
  echo "  pm2 stop ${process_name}"
  echo ""
  echo -e "${BOLD}── Your bot is now sending heartbeats to arclayers.xyz ──${NC}"
  echo -e "  Bot status will appear as online in your Agent Profile page."
  echo ""
  echo -e "${BOLD}── Security Reminder ──${NC}"
  echo "  • Your .env is at: ${target_dir}/${ROLE}-bot/.env (chmod 600)"
  echo "  • Never share your private key or API key"
  echo "  • To rotate keys: edit .env then pm2 restart ${process_name}"
  echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  check_deps
  select_role
  collect_inputs
  check_pm2
  install_runtime
  generate_env
  start_bot
  print_summary
}

main "$@"
