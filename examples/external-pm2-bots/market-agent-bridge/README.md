# ArcLayer External PM2 Market Agent Bridge

External PM2 market agent bridge example: external PM2 bots make market decisions while ArcLayer acts as the protocol bridge for identity, x402 access, bridge events, receipts, payload hashes, and proof history on Arc.

## Current production shape

- External bots run on VPS/PM2 outside ArcLayer.
- ArcLayer receives bridge writes (`/api/agent-bridge/events`, `/api/agent-bridge/receipts`) using `ARCLAYER_API_KEY`.
- ArcLayer presence/rail UI reads public runtime state from:
  - `/api/a2a/presence`
  - `/api/a2a/live-events`
- Live Decision Rail renders success (green), rejected/failed (red), x402 tx hash, and LLM reasoning from metadata.

## Required Vercel env

- `A2A_LIVE_EVENTS_TOKEN` (production token used by `/api/a2a/live-events` write endpoint).

## Required VPS .env

Copy `.env.example` to `.env`, then fill values locally.

```bash
cp .env.example .env
```

Critical notes:
- `ARCLAYER_API_KEY` must be full raw `ak_...` value.
- Supabase `key_prefix` is not a usable API key.
- `A2A_LIVE_EVENTS_TOKEN` must match Vercel production env.
- `DRY_RUN=true` is required for this prediction-market example.
- `X402_AUTOPAY=false` by default; only enable for Arc Testnet validation.
- Never commit `.env`.

## Supabase tables used

- `public.a2a_api_keys`
- `public.agent_presence`
- `public.agent_live_events`

## Bridge API key setup

- Store raw `ak_...` once in local VPS `.env` as `ARCLAYER_API_KEY`.
- Database stores only `key_hash` and `key_prefix`.
- Required scopes:
  - `agent_bridge:write`
  - `agent_bridge:receipt`

## PM2 runtime

```bash
cd examples/external-pm2-bots/market-agent-bridge
npm install
npm run verify:deps
pm2 start ecosystem.config.cjs
pm2 save
pm2 list
```

## Presence heartbeat

- UI online/offline state depends on `/api/a2a/presence` heartbeat freshness.
- PM2 process state alone does not guarantee UI online status.

## Live Decision Rail

- Fed by `/api/a2a/live-events`.
- Success steps are green.
- Rejected/failed steps are red.
- `txHash` is shown for `x402_paid` when available.
- `metadata.reasoning` is shown as **LLM Reasoning**.

## Production validation commands

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
