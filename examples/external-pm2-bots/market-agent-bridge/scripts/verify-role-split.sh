#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== verify-role-split ==="

failures=0

check_grep() {
  local pattern="$1" msg="$2" dir="${3:-.}"
  if grep -r "$pattern" --include="*.js" --include="*.md" --include="*.cjs" --include="*.example" -n "$dir" 2>/dev/null | grep -v 'node_modules' | grep -v 'script/verify-role-split'; then
    echo "FAIL: $msg"
    failures=$((failures + 1))
  else
    echo "OK: $msg"
  fi
}

check_grep_fail_on_find() {
  local pattern="$1" msg="$2" dir="${3:-.}"
  if grep -r "$pattern" --include="*.js" --include="*.md" --include="*.cjs" --include="*.example" -n "$dir" 2>/dev/null | grep -v 'node_modules' | grep -v 'scripts/verify-role-split' | grep -v 'README'; then
    echo "FAIL: $msg"
    failures=$((failures + 1))
  else
    echo "OK: $msg"
  fi
}

# 1. Check no spawnSync remains except in verification script itself
check_grep_fail_on_find 'spawnSync' 'spawnSync must not appear in code'

# 2. Check no child_process remains except in verification script
check_grep_fail_on_find 'child_process' 'child_process must not appear in code'

# 3. Check no EVENT_CHAIN_ENABLED=true
check_grep_fail_on_find 'EVENT_CHAIN_ENABLED.*true' 'EVENT_CHAIN_ENABLED=true must not appear'

# 4. Check ecosystem.chain.config.cjs does not exist
if [ -f "ecosystem.chain.config.cjs" ]; then
  echo "FAIL: ecosystem.chain.config.cjs must not exist"
  failures=$((failures + 1))
else
  echo "OK: ecosystem.chain.config.cjs deleted"
fi

# 5. Check .env.common.example does not contain a real API key or private key
if grep -qE '^ARCLAYER_API_KEY=[^[:space:]]' .env.common.example 2>/dev/null && ! grep -q '^ARCLAYER_API_KEY=$' .env.common.example; then
  echo "FAIL: .env.common.example must not contain ARCLAYER_API_KEY value"
  failures=$((failures + 1))
elif grep -qE '(sk_live|ak_|0x[a-fA-F0-9]{40,})' .env.common.example 2>/dev/null; then
  echo "FAIL: .env.common.example must not contain keys or secrets"
  failures=$((failures + 1))
else
  echo "OK: .env.common.example has no secrets"
fi

# 6. Check role env examples have ARCLAYER_AGENT_ID
for role in oracle analyzer evaluator executor; do
  file=".env.${role}.example"
  if ! grep -q '^ARCLAYER_AGENT_ID=' "$file" 2>/dev/null; then
    echo "FAIL: $file missing ARCLAYER_AGENT_ID"
    failures=$((failures + 1))
  else
    echo "OK: $file has ARCLAYER_AGENT_ID"
  fi
done

# 7. Check role env examples have ARCLAYER_API_KEY placeholder
for role in oracle analyzer evaluator executor; do
  file=".env.${role}.example"
  if ! grep -qE '^ARCLAYER_API_KEY=$|^ARCLAYER_API_KEY=INSERT' "$file" 2>/dev/null; then
    echo "FAIL: $file missing ARCLAYER_API_KEY placeholder"
    failures=$((failures + 1))
  else
    echo "OK: $file has ARCLAYER_API_KEY placeholder"
  fi
done

# 8. Check shared/arclayer-client.js validates AGENT_ID strictly (no fallback to llm-market-agent)
if grep -q 'llm-market-agent' shared/arclayer-client.js 2>/dev/null; then
  echo "FAIL: shared/arclayer-client.js must not contain llm-market-agent fallback"
  failures=$((failures + 1))
else
  echo "OK: shared/arclayer-client.js has no llm-market-agent fallback"
fi

# 9. Check llm-market-agent does not appear in code files (README historical notes allowed)
for f in oracle-bot.js analyzer-bot.js evaluator-bot.js executor-bot.js shared/arclayer-client.js shared/env-loader.js ecosystem.independent.config.cjs ecosystem.config.cjs; do
  if [ -f "$f" ] && grep -q 'llm-market-agent' "$f" 2>/dev/null; then
    echo "FAIL: $f still contains llm-market-agent"
    failures=$((failures + 1))
  fi
done
echo "OK: No llm-market-agent in code files"

# 10. Check latestSession does not filter events by local AGENT_ID
if grep -qE '\.(filter|find)\(.*\)\s*===\s*AGENT_ID' shared/arclayer-client.js 2>/dev/null; then
  echo "FAIL: latestSession must not filter by local AGENT_ID"
  failures=$((failures + 1))
else
  echo "OK: latestSession does not filter by local AGENT_ID"
fi

# 11. Check that arclayer-client.js exports AGENT_CATEGORY
if grep -q 'AGENT_CATEGORY' shared/arclayer-client.js 2>/dev/null; then
  echo "OK: arclayer-client.js uses AGENT_CATEGORY"
else
  echo "FAIL: arclayer-client.js missing AGENT_CATEGORY"
  failures=$((failures + 1))
fi

# 12. Check oracle-bot.js does not have require('path') or child_process
if grep -qE 'require\("(path|node:child_process)"\)|require\("child_process"\)' oracle-bot.js 2>/dev/null; then
  echo "FAIL: oracle-bot.js must not require path or child_process"
  failures=$((failures + 1))
else
  echo "OK: oracle-bot.js clean of path/child_process"
fi

# 13. Check ecosystem.config.cjs is an alias
if head -1 ecosystem.config.cjs | grep -q 'require.*ecosystem.independent' ; then
  echo "OK: ecosystem.config.cjs is an alias"
else
  echo "FAIL: ecosystem.config.cjs is not a simple alias"
  failures=$((failures + 1))
fi

echo ""
echo "=== Results: $failures failures ==="
if [ "$failures" -eq 0 ]; then
  echo "ROLE_SPLIT_EXAMPLE_OK"
else
  echo "ROLE_SPLIT_EXAMPLE_FAIL"
  exit 1
fi
