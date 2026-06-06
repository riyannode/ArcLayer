#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ArcLayer External Provider Runtime Bot — One-Click Installer
#
# Usage:
#   curl -fsSL https://arclayers.xyz/install/erc8183-provider.sh | bash
#
# Installs the autonomous provider-runtime-bot under ~/provider-runtime-bot.
# Bot uses MCP session (not API key), local signing, and LLM for deliverables.
#
# Security:
#   - Private key read via hidden input (read -s), never echoed
#   - LLM API key read via hidden input
#   - .env is chmod 600
#   - No secrets in URL, logs, or heartbeat body
#   - Private key never sent to ArcLayer
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="https://github.com/riyannode/ArcLayer.git"
INSTALL_DIR="$HOME/provider-runtime-bot"
BOT_SUBDIR="examples/external-pm2-bots/provider-runtime-bot"
VERSION="2.0.0"

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

# ── Parse flags ──────────────────────────────────────────────────────────────

DEBUG=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --debug)     DEBUG=true ;;
    --dry-run)   DRY_RUN=true ;;
  esac
done

debug() {
  if [ "$DEBUG" = true ]; then
    echo -e "${CYAN}[debug]${NC} $*"
  fi
}

# ── TTY for interactive input ────────────────────────────────────────────────

TTY_FD=0

if [ -t 0 ]; then
  TTY_FD=0
else
  if ( exec 0</dev/tty ) 2>/dev/null; then
    exec 3</dev/tty
    TTY_FD=3
  else
    echo -e "${YELLOW}[warn]${NC} No terminal detected. Interactive prompts may not work."
    TTY_FD=0
  fi
fi

tty_read() {
  read "$@" <&$TTY_FD
}

# ── Preflight checks ─────────────────────────────────────────────────────────

check_deps() {
  local missing=()
  command -v git   >/dev/null 2>&1 || missing+=("git")
  command -v node  >/dev/null 2>&1 || missing+=("node")
  command -v npm   >/dev/null 2>&1 || missing+=("npm")

  if [ ${#missing[@]} -gt 0 ]; then
    fail "Missing required tools: ${missing[*]}\nInstall them and retry."
  fi

  local git_major git_minor
  git_major=$(git --version | grep -oP '\d+\.\d+' | head -1 | cut -d. -f1)
  git_minor=$(git --version | grep -oP '\d+\.\d+' | head -1 | cut -d. -f2)
  if [ "$git_major" -lt 2 ] || { [ "$git_major" -eq 2 ] && [ "$git_minor" -lt 25 ]; }; then
    fail "Git >= 2.25 required for sparse checkout (found: $(git --version))."
  fi

  ok "Dependencies: git $(git --version | grep -oP '\d+\.\d+\.\d+'), node $(node --version)"
}

check_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    ok "PM2 already installed: $(pm2 --version)"
    return
  fi
  if [ "$DRY_RUN" = true ]; then
    info "[dry-run] Would install PM2 globally"
    return
  fi
  info "Installing PM2 globally..."
  npm install -g pm2 2>/dev/null || fail "Failed to install PM2. Try: npm install -g pm2"
  ok "PM2 installed: $(pm2 --version)"
}

# ── Validate Ethereum address ────────────────────────────────────────────────

validate_address() {
  local val="$1"
  if [[ "$val" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
    return 0
  fi
  return 1
}

# ── Collect user inputs ──────────────────────────────────────────────────────

collect_inputs() {
  echo ""
  echo -e "${BOLD}═══ ArcLayer Provider Runtime Bot Installer ═══${NC}"
  echo ""

  if [ "$DRY_RUN" = true ]; then
    AGENT_ID="${AGENT_ID:-99999}"
    MCP_TOKEN="${MCP_TOKEN:-dry-run-placeholder}"
    PROVIDER_ADDRESS="${PROVIDER_ADDRESS:-0x0000000000000000000000000000000000000000}"
    PRIVATE_KEY="<dry-run: hidden>"
    LLM_PROVIDER="${LLM_PROVIDER:-openai-compatible}"
    LLM_BASE_URL="${LLM_BASE_URL:-https://example.com/v1}"
    LLM_MODEL="${LLM_MODEL:-example-model}"
    LLM_API_KEY="<dry-run: hidden>"
    PROVIDER_CUSTOM_SKILL_PATH=""
    PROVIDER_MAX_ACTIVE_RUNS="${PROVIDER_MAX_ACTIVE_RUNS:-1}"
    PROVIDER_MAX_QUOTE_USDC=""
    info "[dry-run] Using placeholder values — no secrets collected"
    return
  fi

  # Agent ID
  while true; do
    tty_read -rp "Agent ID (numeric, from ERC-8004 registration): " AGENT_ID
    if [[ "$AGENT_ID" =~ ^[0-9]+$ ]]; then
      break
    fi
    warn "Agent ID must be a numeric value."
  done

  # MCP session token
  while true; do
    tty_read -rp "MCP session token (arc_mcp_sess_...): " MCP_TOKEN
    if [[ "$MCP_TOKEN" =~ ^arc_mcp_sess_ ]]; then
      break
    fi
    warn "MCP token must start with arc_mcp_sess_."
  done

  # Provider wallet address
  while true; do
    tty_read -rp "Provider wallet address (0x...): " PROVIDER_ADDRESS
    if validate_address "$PROVIDER_ADDRESS"; then
      break
    fi
    warn "Invalid Ethereum address. Must be 0x + 40 hex chars."
  done

  # Private key (hidden input)
  echo ""
  info "Private key will be hidden (no echo)."
  while true; do
    tty_read -rsp "Provider private key: " PRIVATE_KEY
    echo ""
    if [ -n "$PRIVATE_KEY" ]; then
      break
    fi
    warn "Private key cannot be empty."
  done

  # LLM configuration (required)
  echo ""
  echo -e "${BOLD}── LLM Configuration (required) ──${NC}"
  echo ""
  echo "Bot exits at startup if LLM_PROVIDER, LLM_BASE_URL, or LLM_MODEL is missing."
  echo ""

  while true; do
    tty_read -rp "LLM provider (e.g. openai, anthropic, openrouter, local, no-auth): " LLM_PROVIDER
    if [ -n "$LLM_PROVIDER" ]; then
      break
    fi
    warn "LLM_PROVIDER is required."
  done

  while true; do
    tty_read -rp "LLM base URL (e.g. https://openrouter.ai/api/v1): " LLM_BASE_URL
    if [ -n "$LLM_BASE_URL" ]; then
      break
    fi
    warn "LLM_BASE_URL is required."
  done

  while true; do
    tty_read -rp "LLM model (e.g. deepseek/deepseek-v4-flash, gpt-4o, claude-sonnet-4-20250514): " LLM_MODEL
    if [ -n "$LLM_MODEL" ]; then
      break
    fi
    warn "LLM_MODEL is required."
  done

  # LLM_API_KEY required unless local/no-auth
  local is_local_auth=false
  if [ "$LLM_PROVIDER" = "local" ] || [ "$LLM_PROVIDER" = "no-auth" ]; then
    is_local_auth=true
  fi

  if [ "$is_local_auth" = true ]; then
    tty_read -rsp "LLM API key (optional for local/no-auth, press Enter to skip): " LLM_API_KEY
    echo ""
  else
    while true; do
      tty_read -rsp "LLM API key (hidden): " LLM_API_KEY
      echo ""
      if [ -n "$LLM_API_KEY" ]; then
        break
      fi
      warn "LLM_API_KEY is required for $LLM_PROVIDER."
    done
  fi

  ok "LLM configured: ${LLM_PROVIDER} / ${LLM_MODEL}"

  # Optional settings
  echo ""
  echo -e "${BOLD}── Optional Settings ──${NC}"
  echo ""

  tty_read -rp "Custom provider skill path (optional, press Enter to skip): " PROVIDER_CUSTOM_SKILL_PATH
  if [ -n "$PROVIDER_CUSTOM_SKILL_PATH" ]; then
    if [ ! -f "$PROVIDER_CUSTOM_SKILL_PATH" ]; then
      warn "File does not exist yet. Create it before starting the bot."
    fi
    ok "Custom skill path: ${PROVIDER_CUSTOM_SKILL_PATH}"
  else
    PROVIDER_CUSTOM_SKILL_PATH=""
  fi

  tty_read -rp "Max active runs [1]: " PROVIDER_MAX_ACTIVE_RUNS_INPUT
  PROVIDER_MAX_ACTIVE_RUNS="${PROVIDER_MAX_ACTIVE_RUNS_INPUT:-1}"

  tty_read -rp "Max quote USDC for auto-apply (optional, press Enter to skip): " PROVIDER_MAX_QUOTE_USDC
}

# ── Sparse clone + copy ──────────────────────────────────────────────────────

install_runtime() {
  local tmp_dir="/tmp/arclayer-provider-install-$$"

  echo ""
  echo -e "${BOLD}── Installing Provider Runtime Bot ──${NC}"
  echo ""

  if [ "$DRY_RUN" = true ]; then
    info "[dry-run] Would install to ${INSTALL_DIR}"
    ok "[dry-run] Validation complete. No changes made."
    return
  fi

  # Remove old install if exists
  if [ -d "$INSTALL_DIR" ]; then
    warn "Existing install found at ${INSTALL_DIR}"
    local overwrite
    tty_read -rp "Overwrite? (y/N): " overwrite
    if [ "$overwrite" != "y" ] && [ "$overwrite" != "Y" ]; then
      fail "Aborted. Existing install preserved."
    fi
    rm -rf "$INSTALL_DIR"
  fi

  mkdir -p "$INSTALL_DIR"

  # Sparse clone
  info "Downloading bot runtime (sparse clone)..."
  if [ -d "$tmp_dir" ]; then
    rm -rf "$tmp_dir"
  fi

  git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$tmp_dir" 2>/dev/null \
    || fail "Failed to clone repo. Check your internet connection."

  cd "$tmp_dir"
  git sparse-checkout set "$BOT_SUBDIR" 2>/dev/null \
    || fail "Failed to set sparse checkout."

  # Verify source exists
  local src_dir="$tmp_dir/$BOT_SUBDIR"
  if [ ! -d "$src_dir" ]; then
    rm -rf "$tmp_dir"
    fail "Source directory not found in repo: $BOT_SUBDIR"
  fi

  # Copy all bot files
  info "Copying runtime files..."
  cp "$src_dir/package.json" "$INSTALL_DIR/"
  [ -f "$src_dir/package-lock.json" ] && cp "$src_dir/package-lock.json" "$INSTALL_DIR/"
  cp "$src_dir/provider-bot.js" "$INSTALL_DIR/"
  cp "$src_dir/llm-task-helper.js" "$INSTALL_DIR/"
  cp "$src_dir/ecosystem.config.cjs" "$INSTALL_DIR/"
  cp -r "$src_dir/shared" "$INSTALL_DIR/"

  # Copy optional files
  [ -f "$src_dir/.env.example" ] && cp "$src_dir/.env.example" "$INSTALL_DIR/"
  [ -f "$src_dir/create-and-fund.mjs" ] && cp "$src_dir/create-and-fund.mjs" "$INSTALL_DIR/"
  [ -f "$src_dir/create-fund-direct.mjs" ] && cp "$src_dir/create-fund-direct.mjs" "$INSTALL_DIR/"
  [ -f "$src_dir/fund-job.mjs" ] && cp "$src_dir/fund-job.mjs" "$INSTALL_DIR/"

  # Cleanup temp clone
  rm -rf "$tmp_dir"
  ok "Runtime files installed to ${INSTALL_DIR}"
}

# ── Generate .env ─────────────────────────────────────────────────────────────

generate_env() {
  local env_file="${INSTALL_DIR}/.env"
  local private_key_normalized="$PRIVATE_KEY"

  # Ensure 0x prefix on private key
  if [[ ! "$private_key_normalized" =~ ^0x ]]; then
    private_key_normalized="0x${private_key_normalized}"
  fi

  info "Generating .env..."

  if [ "$DRY_RUN" = true ]; then
    info "[dry-run] Would write .env to ${env_file}"
    return
  fi

  cat > "$env_file" << ENVEOF
# ArcLayer Provider Runtime Bot — generated by installer v${VERSION}
# NEVER commit this file. NEVER share these values.

# ── ArcLayer MCP ──────────────────────────────────────────────────────────────
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_MCP_TOKEN=${MCP_TOKEN}
ARCLAYER_AGENT_ID=${AGENT_ID}

# ── Provider Wallet ───────────────────────────────────────────────────────────
PROVIDER_ADDRESS=${PROVIDER_ADDRESS}
PROVIDER_PRIVATE_KEY=${private_key_normalized}
PROVIDER_MODE=provider

# ── Open Job Settings ─────────────────────────────────────────────────────────
PROVIDER_AUTO_APPLY_OPEN_JOBS=false
PROVIDER_MAX_QUOTE_USDC=${PROVIDER_MAX_QUOTE_USDC:-}
PROVIDER_MAX_ACTIVE_RUNS=${PROVIDER_MAX_ACTIVE_RUNS}
PROVIDER_CAPABILITIES=

# ── Arc Chain ─────────────────────────────────────────────────────────────────
ARC_CHAIN_ID=5042002
ARC_RPC_URL=https://arc-testnet.drpc.org

# ── LLM Configuration (required — bot exits if incomplete) ───────────────────
LLM_PROVIDER=${LLM_PROVIDER}
LLM_BASE_URL=${LLM_BASE_URL}
LLM_MODEL=${LLM_MODEL}
LLM_API_KEY=${LLM_API_KEY:-}
LLM_MAX_TOKENS=2500
LLM_TEMPERATURE=0.2
LLM_TIMEOUT_MS=60000
LLM_JSON_REPAIR_RETRIES=1

# ── Bot Settings ──────────────────────────────────────────────────────────────
POLL_INTERVAL_MS=15000
PROVIDER_AGENT_TYPE=other
PROVIDER_SKILL=auto
PROVIDER_CUSTOM_SKILL_PATH=${PROVIDER_CUSTOM_SKILL_PATH:-}
ENVEOF

  chmod 600 "$env_file"
  ok ".env written (chmod 600)"
}

# ── Install deps + preflight + start PM2 ─────────────────────────────────────

start_bot() {
  local process_name="arclayer-provider-runtime-${AGENT_ID}"

  echo ""
  echo -e "${BOLD}── Starting Provider Runtime Bot ──${NC}"
  echo ""

  if [ "$DRY_RUN" = true ]; then
    info "[dry-run] Would install deps in ${INSTALL_DIR}"
    info "[dry-run] Would run preflight check"
    info "[dry-run] Would start PM2 process: ${process_name}"
    ok "[dry-run] Validation complete. No changes made."
    return
  fi

  # Install dependencies
  info "Installing npm dependencies..."
  cd "$INSTALL_DIR"
  npm install --production 2>/dev/null || npm install
  ok "Dependencies installed"

  # Run preflight check
  info "Running preflight check..."
  if node check-env.mjs 2>&1; then
    ok "Preflight check passed"
  else
    fail "Preflight check failed. Fix the issues above, edit .env, then re-run: cd ${INSTALL_DIR} && node check-env.mjs"
  fi

  # Delete existing process if any
  pm2 delete "$process_name" 2>/dev/null || true

  # Start with ecosystem config
  pm2 start ecosystem.config.cjs --name "$process_name"

  pm2 save 2>/dev/null || true

  echo ""
  ok "Bot started as PM2 process: ${process_name}"
  echo ""
  echo -e "${BOLD}── Recent Logs ──${NC}"
  pm2 logs "$process_name" --lines 15 --nostream 2>/dev/null || true
}

# ── Print summary ─────────────────────────────────────────────────────────────

print_summary() {
  local process_name="arclayer-provider-runtime-${AGENT_ID}"

  echo ""
  echo -e "${BOLD}═══ Installation Complete ═══${NC}"
  echo ""
  echo -e "  Agent ID:    ${GREEN}${AGENT_ID}${NC}"
  echo -e "  Address:     ${GREEN}${PROVIDER_ADDRESS}${NC}"
  echo -e "  LLM:         ${GREEN}${LLM_PROVIDER} / ${LLM_MODEL}${NC}"
  echo -e "  Install dir: ${GREEN}${INSTALL_DIR}${NC}"
  echo -e "  Process:     ${GREEN}${process_name}${NC}"
  echo ""
  echo -e "${BOLD}── Useful Commands ──${NC}"
  echo "  pm2 status"
  echo "  pm2 logs ${process_name} --lines 50"
  echo "  pm2 restart ${process_name}"
  echo "  pm2 stop ${process_name}"
  echo ""
  echo -e "${BOLD}── Config ──${NC}"
  echo "  Edit .env:    nano ${INSTALL_DIR}/.env"
  echo "  Preflight:    cd ${INSTALL_DIR} && node check-env.mjs"
  echo ""
  echo -e "${BOLD}── Security Reminder ──${NC}"
  echo "  • .env is at: ${INSTALL_DIR}/.env (chmod 600)"
  echo "  • Private key stays local — never sent to ArcLayer"
  echo "  • To rotate keys: edit .env then pm2 restart ${process_name}"
  echo ""
}

# ── Cleanup TTY fd ────────────────────────────────────────────────────────────

cleanup() {
  if [ "${TTY_FD:-0}" -eq 3 ]; then
    exec 3<&-
  fi
}
trap cleanup EXIT

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  check_deps
  collect_inputs
  check_pm2
  install_runtime
  generate_env
  start_bot
  print_summary
}

main "$@"
