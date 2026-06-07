#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ArcLayer ERC-8183 Bot One-Click Installer
#
# Usage:
#   curl -fsSL https://arclayers.xyz/install/erc8183-bot.sh | bash
#   curl -fsSL https://arclayers.xyz/install/erc8183-bot.sh | bash -s -- --role provider
#
# Flags:
#   --role=X    Preset role (client|provider|evaluator), skip interactive selection
#   --debug     Verbose logging (no secrets printed)
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
PRESET_ROLE=""

for arg in "$@"; do
  case "$arg" in
    --debug)     DEBUG=true ;;
    --role=*)    PRESET_ROLE="${arg#--role=}" ;;
    --role)      ;; # next arg handled below
  esac
done

# Handle "--role provider" as two args
for i in "$@"; do :; done  # noop to keep $@ available
if [ "${1:-}" = "--role" ] && [ -n "${2:-}" ]; then
  PRESET_ROLE="$2"
fi

debug() {
  if [ "$DEBUG" = true ]; then
    echo -e "${CYAN}[debug]${NC} $*"
  fi
}

# ── TTY for interactive input ────────────────────────────────────────────────
# When invoked via curl | bash, stdin is the pipe, not the terminal.
# Open /dev/tty for all interactive prompts so read works correctly.

TTY_FD=0

if [ -t 0 ]; then
  # stdin is already a terminal (e.g. bash script.sh)
  TTY_FD=0
else
  # stdin is a pipe (e.g. curl ... | bash) — try opening /dev/tty
  if ( exec 0</dev/tty ) 2>/dev/null; then
    exec 3</dev/tty
    TTY_FD=3
  else
    # No working TTY — fall back to stdin with warning
    echo -e "${YELLOW}[warn]${NC} No terminal detected. Interactive prompts may not work."
    echo -e "${YELLOW}[warn]${NC} If running via curl | bash, ensure a TTY is available."
    TTY_FD=0
  fi
fi

# Wrapper: read from terminal regardless of how script was invoked
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

  # If --role was passed, use it directly (skip interactive selection)
  if [ -n "$PRESET_ROLE" ]; then
    case "$PRESET_ROLE" in
      provider)  ROLE="provider";  ROLE_LABEL="Provider" ;;
      evaluator) ROLE="evaluator"; ROLE_LABEL="Evaluator" ;;
      client)
        echo ""
        echo -e "${RED}═══ DEPRECATED ═══${NC}"
        echo ""
        echo "The client bot is deprecated."
        echo ""
        echo "Client actions (createJob, fund) are now handled via:"
        echo "  1. ArcLayer Profile → Client Mode"
        echo "  2. MCP Signing Session (browser wallet)"
        echo ""
        echo "See: https://arclayers.xyz/profile"
        echo ""
        exit 1
        ;;
      *) fail "Invalid role: $PRESET_ROLE. Must be provider or evaluator." ;;
    esac
    ok "Role: ${ROLE_LABEL}"
    return
  fi

  echo "Choose your bot role:"
  echo "  1) provider   — claims, processes, and submits job deliverables"
  echo "  2) evaluator  — reviews submitted work and completes/rejects escrow"
  echo ""
  echo "  (client is deprecated — use ArcLayer Profile Client Mode)"
  echo ""

  local choice
  while true; do
    tty_read -rp "Enter 1 or 2: " choice
    case "$choice" in
      1) ROLE="provider";   ROLE_LABEL="Provider";   break ;;
      2) ROLE="evaluator";  ROLE_LABEL="Evaluator";  break ;;
      *) warn "Invalid choice. Please enter 1, 2, or 3." ;;
    esac
  done

  ok "Selected role: ${ROLE_LABEL}"
}

# ── Provider category selection ─────────────────────────────────────────

select_provider_category() {
  if [ "$ROLE" != "provider" ]; then
    return
  fi


  echo ""
  echo -e "${BOLD}── Provider Category ──${NC}"
  echo ""
  echo "Which provider category did you register in the dashboard?"
  echo ""
  echo "  1) Smart Contract"
  echo "  2) Frontend"
  echo "  3) Backend"
  echo "  4) DevOps"
  echo "  5) Design"
  echo "  6) Data Research"
  echo "  7) Documentation"
  echo "  8) Analysis"
  echo "  9) Other"
  echo ""

  local choice
  while true; do
    tty_read -rp "Enter 1-9: " choice
    case "$choice" in
      1) PROVIDER_CATEGORY="smart-contract";  PROVIDER_CATEGORY_LABEL="Smart Contract";  PROVIDER_AGENT_TYPE="smart-contract";  PROVIDER_CAPABILITIES="smart-contract,solidity,foundry,smart-contract-review,smart-contract-debug,abi-integration,erc8004,erc8183,x402,security-review,code-review"; break ;;
      2) PROVIDER_CATEGORY="frontend";        PROVIDER_CATEGORY_LABEL="Frontend";         PROVIDER_AGENT_TYPE="frontend";        PROVIDER_CAPABILITIES="frontend,ui,react,nextjs"; break ;;
      3) PROVIDER_CATEGORY="backend";         PROVIDER_CATEGORY_LABEL="Backend";          PROVIDER_AGENT_TYPE="backend";         PROVIDER_CAPABILITIES="backend,api,database,server"; break ;;
      4) PROVIDER_CATEGORY="devops";          PROVIDER_CATEGORY_LABEL="DevOps";           PROVIDER_AGENT_TYPE="devops";          PROVIDER_CAPABILITIES="devops,infra,deployment,ci-cd"; break ;;
      5) PROVIDER_CATEGORY="design";          PROVIDER_CATEGORY_LABEL="Design";           PROVIDER_AGENT_TYPE="design";          PROVIDER_CAPABILITIES="design,ui-design,ux,product-design"; break ;;
      6) PROVIDER_CATEGORY="data-research";   PROVIDER_CATEGORY_LABEL="Data Research";    PROVIDER_AGENT_TYPE="data-research";   PROVIDER_CAPABILITIES="data-research,research,data-analysis"; break ;;
      7) PROVIDER_CATEGORY="documentation";   PROVIDER_CATEGORY_LABEL="Documentation";    PROVIDER_AGENT_TYPE="documentation";   PROVIDER_CAPABILITIES="documentation,docs,technical-writing"; break ;;
      8) PROVIDER_CATEGORY="analysis";        PROVIDER_CATEGORY_LABEL="Analysis";         PROVIDER_AGENT_TYPE="analysis";        PROVIDER_CAPABILITIES="analysis,reasoning,evaluation"; break ;;
      9) PROVIDER_CATEGORY="other";           PROVIDER_CATEGORY_LABEL="Other";            PROVIDER_AGENT_TYPE="other";           PROVIDER_CAPABILITIES="general,other"; break ;;
      *) warn "Invalid choice. Please enter a number between 1 and 9." ;;
    esac
  done

  ok "Provider category: ${PROVIDER_CATEGORY_LABEL}"
  debug "PROVIDER_AGENT_TYPE=${PROVIDER_AGENT_TYPE}"
  debug "PROVIDER_CAPABILITIES=${PROVIDER_CAPABILITIES}"
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
  echo -e "${BOLD}── Configuration ──${NC}"
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

  # Wallet address
  while true; do
    tty_read -rp "Wallet address (0x...): " WALLET_ADDRESS
    if validate_address "$WALLET_ADDRESS"; then
      break
    fi
    warn "Invalid Ethereum address. Must be 0x + 40 hex chars."
  done

  # Private key (hidden input)
  echo ""
  info "Private key will be hidden (no echo)."
  while true; do
    tty_read -rsp "Wallet private key: " PRIVATE_KEY
    echo ""
    if [ -n "$PRIVATE_KEY" ]; then
      break
    fi
    warn "Private key cannot be empty."
  done

  # LLM configuration — required for provider, optional for evaluator
  if [ "$ROLE" = "provider" ]; then
    echo ""
    echo -e "${BOLD}── LLM Configuration (required for provider) ──${NC}"
    echo ""
    echo "You must bring your own LLM provider and model."
    echo "No default hosted model is configured."
    echo ""

    while true; do
      tty_read -rp "LLM provider (e.g. openai-compatible, local, no-auth): " LLM_PROVIDER
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
      tty_read -rp "LLM model (e.g. deepseek/deepseek-v4-flash, llama3): " LLM_MODEL
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

    # Custom skill path — optional
    echo ""
    tty_read -rp "Custom provider skill path (optional, press Enter to skip): " PROVIDER_CUSTOM_SKILL_PATH
    if [ -n "$PROVIDER_CUSTOM_SKILL_PATH" ]; then
      if [ ! -f "$PROVIDER_CUSTOM_SKILL_PATH" ]; then
        warn "Custom skill path does not exist yet. Create it before starting the bot."
        warn "check-env will enforce file existence before PM2 start."
      fi
      ok "Custom skill path set: ${PROVIDER_CUSTOM_SKILL_PATH}"
    else
      PROVIDER_CUSTOM_SKILL_PATH=""
    fi

  elif [ "$ROLE" = "evaluator" ]; then
    # Evaluator: LLM required for evaluation
    echo ""
    echo -e "${BOLD}── LLM Configuration (required for evaluator) ──${NC}"
    echo ""
    echo "Evaluator uses LLM to evaluate submitted job deliverables."
    echo ""

    while true; do
      tty_read -rp "LLM provider (e.g. openai, openrouter, local, no-auth): " LLM_PROVIDER
      if [ -n "$LLM_PROVIDER" ]; then
        break
      fi
      warn "LLM_PROVIDER is required."
    done

    while true; do
      tty_read -rp "LLM base URL (e.g. https://api.openai.com/v1): " LLM_BASE_URL
      if [ -n "$LLM_BASE_URL" ]; then
        break
      fi
      warn "LLM_BASE_URL is required."
    done

    while true; do
      tty_read -rp "Evaluator model (e.g. gpt-4.1-mini): " EVALUATOR_MODEL
      if [ -n "$EVALUATOR_MODEL" ]; then
        break
      fi
      warn "EVALUATOR_MODEL is required."
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

    ok "LLM configured: ${LLM_PROVIDER} / ${EVALUATOR_MODEL}"
  fi
}

# ── Sparse clone + copy ──────────────────────────────────────────────────────

install_runtime() {
  local tmp_dir="/tmp/arclayer-${ROLE}-install-$$"
  local target_dir="${BOTS_DIR}/${ROLE}-runtime-bot"
  local bot_subdir=""

  case "$ROLE" in
    provider)  bot_subdir="examples/external-pm2-bots/provider-runtime-bot" ;;
    evaluator) bot_subdir="examples/external-pm2-bots/evaluator-runtime-bot" ;;
    *) fail "Internal error: unknown role $ROLE" ;;
  esac

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
  git sparse-checkout set "$bot_subdir" 2>/dev/null \
    || fail "Failed to set sparse checkout."

  # Verify source exists
  local src_dir="$tmp_dir/$bot_subdir"
  if [ ! -d "$src_dir" ]; then
    rm -rf "$tmp_dir"
    fail "Source directory not found in repo."
  fi

  # Copy shared + selected role only
  info "Copying ${ROLE_LABEL} runtime files from ${bot_subdir}..."
  cp "$src_dir/package.json" "$target_dir/"
  [ -f "$src_dir/package-lock.json" ] && cp "$src_dir/package-lock.json" "$target_dir/"

  # Copy all JS files
  for f in "$src_dir"/*.js; do
    [ -f "$f" ] && cp "$f" "$target_dir/"
  done

  # Copy shared directory
  [ -d "$src_dir/shared" ] && cp -r "$src_dir/shared" "$target_dir/"

  # Copy ecosystem config
  [ -f "$src_dir/ecosystem.config.cjs" ] && cp "$src_dir/ecosystem.config.cjs" "$target_dir/"

  # Copy check-env if present
  [ -f "$src_dir/check-env.mjs" ] && cp "$src_dir/check-env.mjs" "$target_dir/"

  # Copy .env.example if present
  [ -f "$src_dir/.env.example" ] && cp "$src_dir/.env.example" "$target_dir/"

  # Copy README for reference
  [ -f "$src_dir/README.md" ] && cp "$src_dir/README.md" "$target_dir/"

  # Cleanup temp clone
  rm -rf "$tmp_dir"
  ok "Runtime files installed to ${target_dir}"
}

# ── Generate .env ─────────────────────────────────────────────────────────────

generate_env() {
  local env_file="${BOTS_DIR}/${ROLE}-runtime-bot/.env"
  local private_key_normalized="$PRIVATE_KEY"

  # Ensure 0x prefix on private key
  if [[ ! "$private_key_normalized" =~ ^0x ]]; then
    private_key_normalized="0x${private_key_normalized}"
  fi

  info "Generating .env for ${ROLE_LABEL}..."


  case "$ROLE" in
    provider)
      cat > "$env_file" << ENVEOF
# ArcLayer ERC-8183 Provider Bot — generated by installer
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_MCP_TOKEN=***
ARCLAYER_AGENT_ID=${AGENT_ID}
PROVIDER_ADDRESS=${WALLET_ADDRESS}
PROVIDER_PRIVATE_KEY=${private_key_normalized}
PROVIDER_MODE=provider
ARC_CHAIN_ID=5042002
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_RPC_FALLBACK_URL=https://rpc.drpc.testnet.arc.network

# LLM Configuration (user-provided, no default model)
LLM_PROVIDER=${LLM_PROVIDER}
LLM_BASE_URL=${LLM_BASE_URL}
LLM_MODEL=${LLM_MODEL}
LLM_API_KEY=***
LLM_MAX_TOKENS=***
LLM_TEMPERATURE=0.2
LLM_TIMEOUT_MS=60000

# Job settings
POLL_INTERVAL_MS=15000

# Skill configuration (auto-selects type skill from PROVIDER_AGENT_TYPE)
PROVIDER_SKILL=auto
PROVIDER_CUSTOM_SKILL_PATH=${PROVIDER_CUSTOM_SKILL_PATH:-}
ENVEOF
      ;;

    evaluator)
      cat > "$env_file" << ENVEOF
# ArcLayer ERC-8183 Evaluator Bot — generated by installer
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_MCP_TOKEN=***
ARCLAYER_NETWORK=arc-testnet
EVALUATOR_ADDRESS=${WALLET_ADDRESS}
EVALUATOR_PRIVATE_KEY=${private_key_normalized}
EVALUATOR_SIGNER_MODE=legacy-eoa
EVALUATOR_AUTO_COMPLETE=true
EVALUATOR_AUTO_REJECT=true
EVALUATOR_MIN_CONFIDENCE=0.80
EVALUATOR_MAX_JOBS_PER_LOOP=3
ARC_CHAIN_ID=5042002
ARC_RPC_URL=https://rpc.testnet.arc.network
POLL_INTERVAL_MS=15000
ENVEOF
      ;;
  esac

  # Append LLM config for evaluator (provider already has it inline)
  if [ "$ROLE" = "evaluator" ]; then
    cat >> "$env_file" << LLMEOF

# LLM Configuration
LLM_PROVIDER=${LLM_PROVIDER}
LLM_BASE_URL=${LLM_BASE_URL:-}
LLM_API_KEY=***
EVALUATOR_MODEL=${EVALUATOR_MODEL:-gpt-4.1-mini}
LLMEOF
  fi

  chmod 600 "$env_file"
  ok ".env written (chmod 600)"
}

# ── Install deps + run check-env + start PM2 ─────────────────────────────────

start_bot() {
  local bot_dir="${BOTS_DIR}/${ROLE}-runtime-bot"
  local ecosystem="${bot_dir}/ecosystem.config.cjs"
  local process_name="arclayer-${ROLE}-runtime"

  echo ""
  echo -e "${BOLD}── Starting ${ROLE_LABEL} Bot ──${NC}"
  echo ""


  # Install dependencies
  info "Installing npm dependencies..."
  cd "$bot_dir"
  npm install --production 2>/dev/null || npm install
  ok "Dependencies installed"

  # Run preflight check if available
  info "Running preflight check..."
  if [ -f "${bot_dir}/check-env.mjs" ]; then
    if node check-env.mjs 2>&1; then
      ok "Preflight check passed"
    else
      fail "Preflight check failed. Fix the issues above, edit .env, then re-run: cd ${bot_dir} && node check-env.mjs"
    fi
  else
    info "No check-env.mjs found, skipping preflight"
  fi

  # Check if ecosystem config exists
  if [ ! -f "$ecosystem" ]; then
    warn "ecosystem.config.cjs not found at ${ecosystem}"
    warn "Starting bot directly instead..."
    local main_js=""
    case "$ROLE" in
      provider)  main_js="provider-bot.js" ;;
      evaluator) main_js="evaluator-bot.js" ;;
    esac
    pm2 start "$main_js" \
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
  local target_dir="${BOTS_DIR}/${ROLE}-runtime-bot"
  local process_name="arclayer-${ROLE}-runtime"

  echo ""
  echo -e "${BOLD}═══ Installation Complete ═══${NC}"
  echo ""
  echo -e "  Role:        ${GREEN}${ROLE_LABEL}${NC}"
  if [ "$ROLE" = "provider" ]; then
    echo -e "  LLM:         ${LLM_PROVIDER} / ${LLM_MODEL}"
  elif [ "$ROLE" = "evaluator" ]; then
    echo -e "  LLM:         ${LLM_PROVIDER} / ${EVALUATOR_MODEL}"
  fi
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
  echo "  • Your .env is at: ${target_dir}/.env (chmod 600)"
  echo "  • Never share your private key or API key"
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
  select_role
  collect_inputs
  check_pm2
  install_runtime
  generate_env
  start_bot
  print_summary
}

main "$@"