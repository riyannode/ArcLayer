# ArcLayer External Agent Live Validation

## Validation target

Validate that external PM2 agents can run outside ArcLayer while ArcLayer provides identity-facing runtime surfaces, x402 access, bridge events, payload hashes, receipts, and live proof/history UI.

## Success criteria

- `prediction-market-bots` category resolves expected agents from `/api/a2a/agents/by-category`.
- Presence heartbeat stays fresh in `/api/a2a/presence`.
- Bridge events exist for oracle/analyzer/evaluator/executor in `/api/agent-bridge/events`.
- Receipt entries exist for latest bridge session.
- `/api/a2a/live-events` shows decision flow events with reasoning and x402 fields.
- Live Decision Rail shows success as green and rejected/failed as red.

## Rejection criteria

- Presence stale/offline despite PM2 running.
- Missing evaluator/executor bridge events for latest session.
- Missing live-events for decision/x402 flow.
- Live Decision Rail not showing reject/fail red state.

## Arc Testnet + x402 validation

- Keep `DRY_RUN=true`.
- Default `X402_AUTOPAY=false`.
- Enable x402 validation only when Arc Testnet payer/key is configured locally and never committed.

## Verification commands

```bash
cd examples/external-pm2-bots/market-agent-bridge
npm install
npm run verify:deps

set -a
source .env
set +a

curl -sS "$ARCLAYER_BASE_URL/api/a2a/agents/by-category?category=prediction-market-bots" | jq '{ok, source, total, error, message}'

curl -sS "$ARCLAYER_BASE_URL/api/a2a/presence?category=prediction-market-bots" | jq '.presence[] | {agentId, status, lastHeartbeatAt, lastEventType, lastEventSummary}'

curl -sS -H "authorization: Bearer $ARCLAYER_API_KEY" "$ARCLAYER_BASE_URL/api/agent-bridge/events?limit=20" | jq '.events[] | {sessionId, agentId, role, type, createdAt}'

curl -sS "$ARCLAYER_BASE_URL/api/a2a/live-events?category=prediction-market-bots&limit=10" | jq '.events[] | {agentId, eventType, decision, summary, txHash, amountAtomic, currency, metadata, createdAt}'

pm2 list
```

## Recommended final statement

ArcLayer live validation passed: external PM2 agents ran outside ArcLayer while ArcLayer handled identity, x402 access, bridge events, payload hashes, receipts, and live proof/history. The prediction-market-bots page resolved five registered agents from the local indexer, kept them online through A2A presence heartbeat, produced oracle/analyzer/evaluator/executor bridge events, created receipts for the latest session, and surfaced the decision flow through the Live Decision Rail with LLM reasoning and x402 status.
