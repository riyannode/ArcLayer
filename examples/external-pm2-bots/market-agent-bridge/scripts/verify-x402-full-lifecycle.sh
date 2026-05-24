#!/usr/bin/env bash
set -euo pipefail

: "${TX:?TX is required}"
: "${SESSION_ID:?SESSION_ID is required}"
: "${RPC:?RPC is required}"
: "${USDC:?USDC is required}"
: "${ARCLAYER_BASE_URL:?ARCLAYER_BASE_URL is required}"
: "${ARCLAYER_API_KEY:?ARCLAYER_API_KEY is required}"

BASE_URL="${ARCLAYER_BASE_URL%/}"
TX_LC="$(printf '%s' "$TX" | tr '[:upper:]' '[:lower:]')"
USDC_LC="$(printf '%s' "$USDC" | tr '[:upper:]' '[:lower:]')"

rpc_payload=$(cat <<JSON
{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["$TX"]}
JSON
)
receipt_json=$(curl -sS -H 'content-type: application/json' --data "$rpc_payload" "$RPC")

RPC_STATUS=$(printf '%s' "$receipt_json" | node -e "let s='0x0';const d=JSON.parse(require('fs').readFileSync(0,'utf8'));if(d&&d.result&&typeof d.result.status==='string') s=d.result.status;process.stdout.write(s);")
USDC_TRANSFER_MATCH=$(printf '%s' "$receipt_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const tx=(d&&d.result)||{};const logs=Array.isArray(tx.logs)?tx.logs:[];const usdc=process.argv[1];const transferTopic='0xddf252ad';const ok=logs.some((log)=>String(log.address||'').toLowerCase()===usdc&&Array.isArray(log.topics)&&String(log.topics[0]||'').toLowerCase().startsWith(transferTopic));process.stdout.write(ok?'1':'0');" "$USDC_LC")

auth_header="authorization: Bearer $ARCLAYER_API_KEY"
events_json=$(curl -sS -H "$auth_header" -H 'accept: application/json' "$BASE_URL/api/agent-bridge/events?sessionId=$SESSION_ID&limit=500")
receipts_json=$(curl -sS -H "$auth_header" -H 'accept: application/json' "$BASE_URL/api/agent-bridge/receipts?sessionId=$SESSION_ID")
live_json=$(curl -sS -H "$auth_header" -H 'accept: application/json' "$BASE_URL/api/a2a/live-events?category=prediction-market-bots&limit=500")

BRIDGE_MATCH=$(printf '%s' "$events_json" | node -e "const tx=process.argv[1];const sid=process.argv[2];const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const arr=Array.isArray(d.events)?d.events:[];const ok=arr.some((e)=>{const role=(e.role||'').toString().toLowerCase();const type=(e.type||e.eventType||'').toString().toLowerCase();const session=(e.session_id||e.sessionId||'').toString();const p=e.payload||{};const eTx=(p.txHash||p.transaction||e.txHash||e.transaction||'').toString().toLowerCase();return role==='executor'&&type==='receipt_reference'&&session===sid&&eTx===tx;});process.stdout.write(ok?'1':'0');" "$TX_LC" "$SESSION_ID")

EXECUTOR_X402_COUNT=$(printf '%s' "$events_json" | node -e "const sid=process.argv[1];const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const arr=Array.isArray(d.events)?d.events:[];const txRe=/^0x[a-f0-9]{64}$/;let count=0;for(const e of arr){const role=(e.role||'').toString().toLowerCase();const type=(e.type||e.eventType||'').toString().toLowerCase();const session=(e.session_id||e.sessionId||'').toString();const p=e.payload||{};const scope=(p.scope||e.scope||'').toString();const source=(p.source||e.source||'').toString();const eTx=(p.txHash||p.transaction||e.txHash||e.transaction||'').toString().toLowerCase();if(role==='executor'&&type==='receipt_reference'&&session===sid&&scope==='external_trace'&&source==='x402-autopay'&&txRe.test(eTx)) count++;}process.stdout.write(String(count));" "$SESSION_ID")

RECEIPT_MATCH=$(node -e "const tx=process.argv[1];const events=JSON.parse(process.argv[2]);const receipts=JSON.parse(process.argv[3]);const sid=process.argv[4];const evArr=Array.isArray(events.events)?events.events:[];const rcArr=Array.isArray(receipts.receipts)?receipts.receipts:[];const ref=evArr.find((e)=>{const p=e.payload||{};const t=(p.txHash||p.transaction||e.txHash||e.transaction||'').toString().toLowerCase();return (e.role||'').toString().toLowerCase()==='executor'&&(e.type||e.eventType||'').toString().toLowerCase()==='receipt_reference'&&(e.session_id||e.sessionId||'').toString()===sid&&t===tx;});if(!ref){process.stdout.write('0');process.exit(0);}const refPayload=ref.payload||{};const refTx=(refPayload.txHash||refPayload.transaction||'').toString().toLowerCase();const refPid=(refPayload.paymentId||'').toString();const ok=rcArr.some((r)=>{const type=(r.receipt_type||r.receiptType||'').toString().toLowerCase();const m=r.metadata||{};const rtx=(m.txHash||r.transaction||r.tx_hash||'').toString().toLowerCase();const pid=(m.paymentId||r.payment_id||'').toString();const role=(m.role||'').toString().toLowerCase();const scope=(m.scope||'').toString().toLowerCase();return (type==='x402_payment_proof'||type==='x402_arc_native')&&rtx===refTx&&(!refPid||pid===refPid)&&role==='executor'&&scope==='external_trace';});process.stdout.write(ok?'1':'0');" "$TX_LC" "$events_json" "$receipts_json" "$SESSION_ID")

PROOF_CONSISTENCY_MATCH=$(node -e "const tx=process.argv[1];const sid=process.argv[2];const receipts=JSON.parse(process.argv[3]);const rcArr=Array.isArray(receipts.receipts)?receipts.receipts:[];const txLc=tx.toLowerCase();const ok=rcArr.some((r)=>{const type=(r.receipt_type||r.receiptType||'').toString().toLowerCase();const m=r.metadata||{};if(type!=='x402_arc_native') return false;const rtx=(m.txHash||r.transaction||r.tx_hash||'').toString().toLowerCase();if(rtx!==txLc) return false;const role=(m.role||'').toString().toLowerCase();if(role!=='executor') return false;const scope=(m.scope||'').toString().toLowerCase();if(scope!=='external_trace') return false;return String(m.protocolTxMode||'')==='arc_testnet'&&String(m.source||'')==='x402-autopay';});process.stdout.write(ok?'1':'0');" "$TX_LC" "$SESSION_ID" "$receipts_json")

LIVE_MATCH=$(node -e "const tx=process.argv[1];const sid=process.argv[2];const events=JSON.parse(process.argv[3]);const live=JSON.parse(process.argv[4]);const evArr=Array.isArray(events.events)?events.events:[];const lvArr=Array.isArray(live.events)?live.events:(Array.isArray(live.data)?live.data:[]);const ref=evArr.find((e)=>{const p=e.payload||{};const t=(p.txHash||p.transaction||e.txHash||e.transaction||'').toString().toLowerCase();return (e.role||'').toString().toLowerCase()==='executor'&&(e.type||e.eventType||'').toString().toLowerCase()==='receipt_reference'&&(e.session_id||e.sessionId||'').toString()===sid&&t===tx;});if(!ref){process.stdout.write('0');process.exit(0);}const bridgePayloadHash=(ref.payloadHash||ref.payload_hash||'').toString();const hit=lvArr.find((e)=>{const m=e.metadata||{};const et=(e.eventType||'').toString();const top=(e.txHash||'').toString().toLowerCase();const mtx=(m.txHash||'').toString().toLowerCase();return et==='x402_paid'&&(top===tx||mtx===tx)&&String(m.sessionId||'')===sid&&String(m.bridgePayloadHash||'')===bridgePayloadHash&&String(m.autoPublished)==='true';});process.stdout.write(hit?'1':'0');" "$TX_LC" "$SESSION_ID" "$events_json" "$live_json")

MANUAL_MIRROR=$(node -e "const tx=process.argv[1];const sid=process.argv[2];const live=JSON.parse(process.argv[3]);const arr=Array.isArray(live.events)?live.events:(Array.isArray(live.data)?live.data:[]);const hit=arr.find((e)=>{const m=e.metadata||{};const top=(e.txHash||'').toString().toLowerCase();const mtx=(m.txHash||'').toString().toLowerCase();return (top===tx||mtx===tx)&&String(m.sessionId||'')===sid;});if(!hit){process.stdout.write('true');process.exit(0);}const m=hit.metadata||{};const suspicious=String(m.manualMirror)==='true'||String(m.autoPublished)!=='true'||!m.bridgePayloadHash||String(m.sessionId||'')!==sid;process.stdout.write(suspicious?'true':'false');" "$TX_LC" "$SESSION_ID" "$live_json")
AUTO_PUBLISHED=$(node -e "const tx=process.argv[1];const sid=process.argv[2];const live=JSON.parse(process.argv[3]);const arr=Array.isArray(live.events)?live.events:(Array.isArray(live.data)?live.data:[]);const hit=arr.find((e)=>{const m=e.metadata||{};const top=(e.txHash||'').toString().toLowerCase();const mtx=(m.txHash||'').toString().toLowerCase();return (top===tx||mtx===tx)&&String(m.sessionId||'')===sid;});if(!hit){process.stdout.write('false');process.exit(0);}const m=hit.metadata||{};process.stdout.write(String(m.autoPublished)==='true'?'true':'false');" "$TX_LC" "$SESSION_ID" "$live_json")

VERDICT=FAILED
if [ "$EXECUTOR_X402_COUNT" -gt 1 ]; then
  VERDICT=BLOCKER
elif [ "$RPC_STATUS" = "0x1" ] && [ "$USDC_TRANSFER_MATCH" = "1" ] && [ "$PROOF_CONSISTENCY_MATCH" = "1" ] && [ "$BRIDGE_MATCH" = "1" ] && [ "$RECEIPT_MATCH" = "1" ] && [ "$LIVE_MATCH" = "1" ] && [ "$EXECUTOR_X402_COUNT" = "1" ] && [ "$MANUAL_MIRROR" = "false" ] && [ "$AUTO_PUBLISHED" = "true" ]; then
  VERDICT=VERIFIED
elif [ "$LIVE_MATCH" = "0" ]; then
  VERDICT=PARTIAL
fi

printf 'RPC_STATUS=%s\nUSDC_TRANSFER_MATCH=%s\nPROOF_CONSISTENCY_MATCH=%s\nBRIDGE_MATCH=%s\nRECEIPT_MATCH=%s\nLIVE_MATCH=%s\nEXECUTOR_X402_COUNT=%s\nMANUAL_MIRROR=%s\nAUTO_PUBLISHED=%s\nVERDICT=%s\n' \
  "$RPC_STATUS" "$USDC_TRANSFER_MATCH" "$PROOF_CONSISTENCY_MATCH" "$BRIDGE_MATCH" "$RECEIPT_MATCH" "$LIVE_MATCH" "$EXECUTOR_X402_COUNT" "$MANUAL_MIRROR" "$AUTO_PUBLISHED" "$VERDICT"
