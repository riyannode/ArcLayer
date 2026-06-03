#!/usr/bin/env bash
# verify-standalone.sh — Verify standalone PM2 bot runtime isolation.
#
# Usage: bash scripts/verify-standalone.sh
#
# Checks:
#   1. Each bot runs from its own cwd (not ArcLayer repo)
#   2. No runtime imports point back to the ArcLayer repo
#   3. Each .env is isolated (role-only secrets)
#   4. PM2 processes are online
#
# Expected PM2 cwd:
#   ~/arclayer-bots/erc8183-client
#   ~/arclayer-bots/erc8183-provider
#   ~/arclayer-bots/erc8183-evaluator

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ARCLAYER_BOTS_DIR="${HOME}/arclayer-bots"
ERRORS=0

echo "=== Standalone Runtime Verification ==="
echo ""

# --- Check 1: PM2 processes exist and are online ---
echo "[1] PM2 process status"
for role in client provider evaluator; do
  name="arclayer-erc8183-${role}"
  status=$(pm2 jlist 2>/dev/null | node -e "
    const list = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const p = list.find(x => x.name === '${name}');
    if (!p) { console.log('NOT_FOUND'); process.exit(0); }
    console.log(p.pm2_env?.status || 'UNKNOWN');
  " 2>/dev/null || echo "PM2_ERROR")
  if [ "$status" = "online" ]; then
    echo "  ✅ ${name}: online"
  elif [ "$status" = "NOT_FOUND" ]; then
    echo "  ❌ ${name}: not registered in PM2"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ⚠️  ${name}: ${status}"
    ERRORS=$((ERRORS + 1))
  fi
done
echo ""

# --- Check 2: PM2 cwd is standalone (not ArcLayer repo) ---
echo "[2] PM2 cwd isolation"
for role in client provider evaluator; do
  name="arclayer-erc8183-${role}"
  cwd=$(pm2 jlist 2>/dev/null | node -e "
    const list = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const p = list.find(x => x.name === '${name}');
    console.log(p?.pm2_env?.pm_cwd || 'UNKNOWN');
  " 2>/dev/null || echo "PM2_ERROR")
  # Bot may run from root or role subfolder — both are valid standalone paths
  if echo "$cwd" | grep -q "arclayer-bots/erc8183-${role}"; then
    echo "  ✅ ${name}: cwd=${cwd}"
  elif echo "$cwd" | grep -q "ArcLayer"; then
    echo "  ❌ ${name}: cwd=${cwd} (points to ArcLayer repo!)"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ⚠️  ${name}: cwd=${cwd} (unexpected path)"
  fi
done
echo ""

# --- Check 3: No imports pointing back to ArcLayer repo ---
echo "[3] Runtime import isolation"
for role in client provider evaluator; do
  bot_dir="${ARCLAYER_BOTS_DIR}/erc8183-${role}"
  if [ ! -d "$bot_dir" ]; then
    echo "  ⚠️  ${role}: ${bot_dir} not found"
    continue
  fi
  # Check for require/import paths that point outside the standalone folder
  bad_imports=$(grep -rn "require.*\.\./\.\./\.\." "$bot_dir" --include="*.js" --include="*.mjs" 2>/dev/null | grep -v node_modules | grep -v ".env" | head -5 || true)
  if [ -z "$bad_imports" ]; then
    echo "  ✅ ${role}: no deep relative imports found"
  else
    echo "  ❌ ${role}: imports reaching outside standalone folder:"
    echo "$bad_imports" | sed 's/^/     /'
    ERRORS=$((ERRORS + 1))
  fi
done
echo ""

# --- Check 4: .env isolation ---
echo "[4] .env isolation (role-only secrets)"
for role in client provider evaluator; do
  env_file="${ARCLAYER_BOTS_DIR}/erc8183-${role}/.env"
  if [ ! -f "$env_file" ]; then
    echo "  ⚠️  ${role}: ${env_file} not found"
    continue
  fi

  case "$role" in
    client)
      # Must NOT have WORKER_PRIVATE_KEY or EVALUATOR_PRIVATE_KEY
      leaks=$(grep -cE "^(WORKER_PRIVATE_KEY|EVALUATOR_PRIVATE_KEY)=" "$env_file" 2>/dev/null || true)
      ;;
    provider)
      # Must NOT have CLIENT_PRIVATE_KEY or EVALUATOR_PRIVATE_KEY
      leaks=$(grep -cE "^(CLIENT_PRIVATE_KEY|EVALUATOR_PRIVATE_KEY)=" "$env_file" 2>/dev/null || true)
      ;;
    evaluator)
      # Must NOT have CLIENT_PRIVATE_KEY or WORKER_PRIVATE_KEY
      leaks=$(grep -cE "^(CLIENT_PRIVATE_KEY|WORKER_PRIVATE_KEY)=" "$env_file" 2>/dev/null || true)
      ;;
  esac

  if [ -z "$leaks" ] || [ "$leaks" = "0" ]; then
    echo "  ✅ ${role}: .env has role-only secrets"
  else
    echo "  ❌ ${role}: .env contains ${leaks} foreign private key(s)"
    ERRORS=$((ERRORS + 1))
  fi
done
echo ""

# --- Summary ---
if [ "$ERRORS" = "0" ]; then
  echo "=== ALL CHECKS PASSED ==="
  exit 0
else
  echo "=== ${ERRORS} CHECK(S) FAILED ==="
  exit 1
fi
