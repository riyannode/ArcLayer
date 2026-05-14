#!/bin/bash
# UNIT C — live verification against /api/agents/1/run
HASHES=$(cat /tmp/arclayer-test-hashes.json)
T3_CREATE=$(echo "$HASHES" | python3 -c "import json,sys;print(json.load(sys.stdin)['t3_createJob'])")
T3_APPROVE=$(echo "$HASHES" | python3 -c "import json,sys;print(json.load(sys.stdin)['t3_approve'])")
T4_FUND=$(echo "$HASHES" | python3 -c "import json,sys;print(json.load(sys.stdin)['t4_fund'])")
T4_JOB=$(echo "$HASHES" | python3 -c "import json,sys;print(json.load(sys.stdin)['t4_jobId'])")
URL="http://localhost:3000/api/agents/1/run"

echo "═══ T1: No X-PAYMENT header ═══"
echo "Expected: 402 payment_required"
curl -s -o /tmp/t1.json -w "HTTP %{http_code}\n" -X POST "$URL" -H "content-type: application/json" -d '{}'
cat /tmp/t1.json | python3 -m json.tool | head -5
echo

echo "═══ T2: Invalid hash ═══"
echo "Expected: 400 invalid_payment"
curl -s -o /tmp/t2.json -w "HTTP %{http_code}\n" -X POST "$URL" -H "content-type: application/json" -H "x-payment: not-a-hash" -d '{}'
cat /tmp/t2.json
echo; echo

echo "═══ T3a: Replay — createJob tx (targets JobEscrow, SUCCESS, but NO JobFunded event) ═══"
echo "Hash: $T3_CREATE"
echo "Expected: 402 payment_not_settled (blocks replay)"
curl -s -o /tmp/t3a.json -w "HTTP %{http_code}\n" -X POST "$URL" -H "content-type: application/json" -H "x-payment: $T3_CREATE" -d '{}'
cat /tmp/t3a.json
echo; echo

echo "═══ T3b: Replay — approve tx (targets USDC, not JobEscrow) ═══"
echo "Hash: $T3_APPROVE"
echo "Expected: 402 payment_not_settled (wrong target)"
curl -s -o /tmp/t3b.json -w "HTTP %{http_code}\n" -X POST "$URL" -H "content-type: application/json" -H "x-payment: $T3_APPROVE" -d '{}'
cat /tmp/t3b.json
echo; echo

echo "═══ T4: Happy path — real fund() tx with matching jobId ═══"
echo "Hash: $T4_FUND  jobId: $T4_JOB"
echo "Expected: 200 OK with server-decoded jobId/payer/amount"
curl -s -o /tmp/t4.json -w "HTTP %{http_code}\n" -X POST "$URL" -H "content-type: application/json" -H "x-payment: $T4_FUND" -d "{\"jobId\":$T4_JOB}"
cat /tmp/t4.json | python3 -m json.tool
echo

echo "═══ T5: Happy tx but CLAIMED jobId MISMATCH (should reject) ═══"
echo "Expected: 402 jobId mismatch"
curl -s -o /tmp/t5.json -w "HTTP %{http_code}\n" -X POST "$URL" -H "content-type: application/json" -H "x-payment: $T4_FUND" -d '{"jobId":999}'
cat /tmp/t5.json
echo
