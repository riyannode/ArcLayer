#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ArcLayer External Evaluator Runtime Bot — One-Click Installer
#
# Usage:
#   curl -fsSL https://arclayers.xyz/install/erc8183-evaluator.sh | bash
#
# Installs the autonomous evaluator-runtime-bot under ~/evaluator-runtime-bot.
# Bot uses MCP session (not API key), dedicated evaluator EOA, and LLM for evaluation.
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
INSTALL_DIR="$HOME/evaluator-runtime-bot"
BOT_SUBDIR="examples/external-pm2-bots/evaluator-runtime-bot"
VERSION="1.0.0"

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

for arg in "$@"; do
  case "$arg" in
    --debug)     DEBUG=true ;;
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
  echo -e "${BOLD}═══ ArcLayer Evaluator Runtime Bot Installer ═══${NC}"
  echo ""


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

  # Evaluator wallet address
  while true; do
    tty_read -rp "Evaluator wallet address (0x...): " EVALUATOR_ADDRESS
    if validate_address "$EVALUATOR_ADDRESS"; then
      break
    fi
    warn "Invalid Ethereum address. Must be 0x + 40 hex chars."
  done

  # Private key (hidden input)
  echo ""
  info "Private key will be hidden (no echo)."
  while true; do
    tty_read -rsp "Evaluator private key: " PRIVATE_KEY
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

}

# ── Sparse clone + copy ──────────────────────────────────────────────────────

install_runtime() {
  local tmp_dir="/tmp/arclayer-provider-install-$$"

  echo ""
  echo -e "${BOLD}── Installing Evaluator Runtime Bot ──${NC}"
  echo ""


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
  cp "$src_dir/check-env.mjs" "$INSTALL_DIR/"
  cp "$src_dir/ecosystem.config.cjs" "$INSTALL_DIR/"
  cp -r "$src_dir/shared" "$INSTALL_DIR/"

  # Copy optional files
  [ -f "$src_dir/.env.example" ] && cp "$src_dir/.env.example" "$INSTALL_DIR/"

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


  cat > "$env_file" << ENVEOF
# ArcLayer Evaluator Runtime Bot — generated by installer v${VERSION}
# NEVER commit this file. NEVER share these values.

# ── ArcLayer MCP ──────────────────────────────────────────────────────────────
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_MCP_TOKEN=***
ARCLAYER_AGENT_ID=${AGENT_ID}

# ── Evaluator Wallet (DEDICATED EOA — do not reuse client/provider/main) ─────
EVALUATOR_ADDRESS=${EVALUATOR_ADDRESS}
EVALUATOR_PRIVATE_KEY=${private_key_normalized}
EVALUATOR_SIGNER_MODE=legacy-eoa

# ── Evaluator Behavior ────────────────────────────────────────────────────────
EVALUATOR_AUTO_COMPLETE=true
EVALUATOR_AUTO_REJECT=true
EVALUATOR_MIN_CONFIDENCE=0.80
EVALUATOR_MAX_JOBS_PER_LOOP=3

# ── Arc Chain ─────────────────────────────────────────────────────────────────
ARC_CHAIN_ID=5042002
ARC_RPC_URL=https://rpc.testnet.arc.network

# ── LLM Configuration (required — bot exits if incomplete) ───────────────────
LLM_PROVIDER=${LLM_PROVIDER}
LLM_BASE_URL=${LLM_BASE_URL}
EVALUATOR_MODEL=${LLM_MODEL:-gpt-4.1-mini}
LLM_API_KEY=***
LLM_MAX_TOKENS=***
LLM_TEMPERATURE=0.1
LLM_TIMEOUT_MS=60000

# ── Poll Settings ─────────────────────────────────────────────────────────────
POLL_INTERVAL_MS=15000
ENVEOF

  chmod 600 "$env_file"
  ok ".env written (chmod 600)"
}

# ── Install deps + preflight + start PM2 ─────────────────────────────────────

start_bot() {
  local process_name="arclayer-evaluator-runtime-${AGENT_ID}"

  echo ""
  echo -e "${BOLD}── Starting Evaluator Runtime Bot ──${NC}"
  echo ""


  # Install dependencies
  info "Installing npm dependencies..."
  cd "$INSTALL_DIR"
  npm install --production 2>/dev/null || npm install
  ok "Dependencies installed"

  # Verify .env exists
  if [ ! -f "${INSTALL_DIR}/.env" ]; then
    fail ".env not found at ${INSTALL_DIR}/.env"
  fi
  ok ".env found"

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
  local process_name="arclayer-evaluator-runtime-${AGENT_ID}"

  echo ""
  echo -e "${BOLD}═══ Installation Complete ═══${NC}"
  echo ""
  echo -e "  Agent ID:    ${GREEN}${AGENT_ID}${NC}"
  echo -e "  Address:     ${GREEN}${EVALUATOR_ADDRESS}${NC}"
  echo -e "  Mode:        ${GREEN}legacy-eoa (dedicated EOA)${NC}"
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
  echo "  Check env:    [no check-env for evaluator — verify .env manually]"
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