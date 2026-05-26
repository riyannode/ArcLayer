#!/usr/bin/env bash
# check-schema.sh — verify expected DB columns/tables exist
# Usage: SUPABASE_SERVICE_ROLE_KEY=<key> bash scripts/check-schema.sh
# Or:    bash scripts/check-schema.sh                 (uses env var)

set -euo pipefail

SUPABASE_REF="${SUPABASE_PROJECT_REF:-}"

if [ -z "$SUPABASE_REF" ]; then
  echo "[check:schema] ERROR: SUPABASE_PROJECT_REF not set"
  echo "  Usage: SUPABASE_PROJECT_REF=<ref> SUPABASE_SERVICE_ROLE_KEY=<key> bash scripts/check-schema.sh"
  exit 1
fi
KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
LOCAL="${LOCAL_CHECK:-}"

# if LOCAL_CHECK is set, hit the local dev server
if [ -n "$LOCAL" ]; then
  echo "[check:schema] LOCAL_CHECK mode — curl localhost:3000/api/health/schema"
  RESPONSE=$(curl -sS http://localhost:3000/api/health/schema)
  echo "$RESPONSE" | python3 -m json.tool
  OK=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok',False))")
  if [ "$OK" != "True" ]; then
    echo "[check:schema] ❌ Schema health check FAILED"
    exit 1
  fi
  echo "[check:schema] ✅ Schema healthy"
  exit 0
fi

if [ -z "$KEY" ]; then
  echo "[check:schema] ERROR: SUPABASE_SERVICE_ROLE_KEY not set"
  echo "  Usage: SUPABASE_SERVICE_ROLE_KEY=<key> bash scripts/check-schema.sh"
  exit 1
fi

echo "[check:schema] Checking schema on $SUPABASE_REF..."

SQL=$(cat <<'SQL'
SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_name IN (
  'agent_jobs', 'agent_bridge_events', 'agent_bridge_receipts',
  'external_agent_runtimes', 'x402_resource_payments',
  'x402_native_payments', 'x402_gateway_payments'
)
ORDER BY table_name, ordinal_position;
SQL
)

# Escape for JSON
PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'query': sys.stdin.read()}))" <<< "$SQL")

RESPONSE=$(curl -sS -X POST \
  "https://api.supabase.com/v1/projects/$SUPABASE_REF/database/query" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

echo "$RESPONSE" | python3 -c "
import sys, json

rows = json.load(sys.stdin)
if not isinstance(rows, list):
    print(f'ERROR: unexpected response: {rows}')
    sys.exit(1)

# expected columns keyed by table
EXPECTED = {
    'agent_jobs': ['settlement_mode', 'erc8183_job_id', 'erc8183_status'],
    'agent_bridge_events': ['event_dedupe_key', 'job_id', 'category'],
    'agent_bridge_receipts': ['session_id', 'event_id'],
    'external_agent_runtimes': ['runtime_id', 'agent_id'],
    'x402_resource_payments': ['payment_id', 'resource', 'status'],
    'x402_native_payments': ['payment_id', 'payer', 'status'],
    'x402_gateway_payments': ['payment_id', 'status'],
}

# build index from response
present = {}
for row in rows:
    t = row.get('table_name')
    c = row.get('column_name')
    if t and c:
        present.setdefault(t, set()).add(c)

all_ok = True
missing_count = 0

for table, cols in sorted(EXPECTED.items()):
    found = present.get(table, set())
    for col in cols:
        if col in found:
            print(f'  ✅ {table}.{col}')
        else:
            print(f'  ❌ {table}.{col} — MISSING')
            all_ok = False
            missing_count += 1

if all_ok:
    print()
    print(f'✅ All {sum(len(c) for c in EXPECTED.values())} expected columns present.')
    sys.exit(0)
else:
    print()
    print(f'❌ {missing_count} column(s) missing.')
    sys.exit(1)
"

COLUMN_RC=$?

# --- RPC function check ---
echo ""
echo "[check:schema] Checking RPC functions..."

RPC_SQL=$(cat <<'RPC_SQL'
SELECT proname FROM pg_proc WHERE proname IN (
  'x402_native_claim_payment',
  'x402_native_consume_payment',
  'x402_gateway_claim_settlement',
  'x402_gateway_consume_payment'
);
RPC_SQL
)

RPC_PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'query': sys.stdin.read()}))" <<< "$RPC_SQL")

RPC_RESPONSE=$(curl -sS -X POST \
  "https://api.supabase.com/v1/projects/$SUPABASE_REF/database/query" \
  -H "Authorization: Bearer *** \
  -H "Content-Type: application/json" \
  -d "$RPC_PAYLOAD")

RPC_OK=true
echo "$RPC_RESPONSE" | python3 -c "
import sys, json

rows = json.load(sys.stdin)
if not isinstance(rows, list):
    print(f'ERROR: unexpected response: {rows}')
    sys.exit(1)

present = set(r['proname'] for r in rows if isinstance(r, dict) and r.get('proname'))

expected_funcs = [
    'x402_native_claim_payment',
    'x402_native_consume_payment',
    'x402_gateway_claim_settlement',
    'x402_gateway_consume_payment',
]

all_ok = True
for fn in expected_funcs:
    if fn in present:
        print(f'  ✅ {fn}')
    else:
        print(f'  ❌ {fn} — MISSING')
        all_ok = False

if all_ok:
    print()
    print('✅ All RPC functions present.')
    sys.exit(0)
else:
    print()
    print('❌ Some RPC functions missing.')
    sys.exit(1)
"

RPC_RC=$?

echo ""
if [ $COLUMN_RC -ne 0 ] || [ $RPC_RC -ne 0 ]; then
  echo "[check:schema] ❌ Schema check FAILED (columns=$COLUMN_RC, rpc=$RPC_RC)"
  exit 1
fi
echo "[check:schema] ✅ All checks passed"
exit 0
