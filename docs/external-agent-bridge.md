# ArcLayer Market-Agent Bridge

ArcLayer is a protocol bridge for autonomous market agents: identity, API auth, x402 access/payment, bridge events, receipts/proofs, payload hashes, and history on Arc.

The external market agent bridge example shows:

```text
external runtime
  -> raw Polymarket BTC 15m data
  -> local/optional-LLM analysis
  -> risk evaluation
  -> DRY_RUN decision intent
  -> x402 bridge-access
  -> bridge event + payloadHash + runtimeId
  -> receipt/history
  -> /live-a2a-agent frontend viewer
```

This is **not** a generic external LLM demo. External runtimes make market decisions; ArcLayer handles x402 payment, event receipts, and proof history on Arc.

## What ArcLayer is

- Registry for externally operated agents, runtimes, roles, and manifests.
- x402 access layer for paid bridge resources.
- Event ingestion endpoint for external runtimes.
- Receipt/proof log for payload hashes, payment references, and work verification.
- Session viewer for latest bridge activity.
- Protocol/data surface for raw market data, bridge events, x402, receipts, and history.

## What ArcLayer is not

- ArcLayer does not host third-party LLM/runtime execution.
- ArcLayer does not hold model provider keys for third-party agents.
- ArcLayer does not run a real trade executor or hold executor private keys.
- ArcLayer does not hardcode trading strategy inside `apps/console`.
- Market-agent bots are owner-operated runtimes/examples, not console core product APIs.

## External market agent bridge example

Required demo path:

1. oracle bot fetches raw Polymarket BTC 15m data from ArcLayer data routes.
2. Analyzer bot uses local deterministic logic or an optional local LLM key.
3. Evaluator bot emits risk/evaluation output.
4. Executor bot emits a `DRY_RUN` intent only.
5. ArcLayer stores event payload, `payloadHash`, `runtimeId`, `job_id`, and category.
6. `POST /api/x402/bridge-access` returns `402` without payment.
7. After payment/unlock, session and receipt data display in the frontend.
8. `/live-a2a-agent` shows the full oracle → analyzer → evaluator → executor → x402 → receipt/history flow.

## Runtime boundary

- ArcLayer is the protocol bridge.
- Bots run anywhere: VPS, worker runtimes, containers, or owner infrastructure.
- Bots own strategy, local LLM keys, and any execution integrations.
- ArcLayer handles identity, x402, events, receipts, payload hashes, and history.
- `LLM_API_KEY` is local-only for bot runtimes; it must never be sent to ArcLayer or Supabase and must never be printed.

## Raw Polymarket BTC 15m routes

These routes expose raw/normalized data for external agents only:

```text
GET /api/data/polymarket/btc-15m
GET /api/data/polymarket/btc-15m/orderbook
GET /api/data/polymarket/btc-15m/candles
```

They are data routes, not hosted strategy routes and not trade execution APIs.

## External runtime registration

External runtimes run on owner infrastructure. They authenticate with ArcLayer API keys or signed requests, publish manifests, claim jobs when using the A2A job rail, and submit results/proofs or bridge events back to ArcLayer.

The `external_agent_runtimes` table stores runtime metadata. Secrets are not stored raw.

Bridge API key scopes:

- `agent_bridge:write` — required for `POST /api/agent-bridge/events`.
- `agent_bridge:receipt` — required for receipt creation through `POST /api/agent-bridge/receipts`.

Read-only session/receipt debug routes are server-mediated and do not expose raw secrets.

## Bridge event ingestion

`POST /api/agent-bridge/events`

Example body:

```json
{
  "sessionId": "btc15m_1770000000",
  "runtimeId": "pm2-analyzer-bot",
  "agentId": "agent-1",
  "jobId": "btc-15m-market-agent-session",
  "category": "prediction-market",
  "role": "analyzer",
  "type": "resolver_output",
  "payload": { "suggestedDirection": "UP", "confidence": 62 },
  "metadata": { "source": "market-agent-bridge", "dryRunOnly": true }
}
```

The server stores the payload, computes or validates `payloadHash`, and derives latest-session views from the event log with dynamic `session.roles`.

## Receipt generation

`GET /api/agent-bridge/receipts?sessionId=...`

Receipts bind a session, event, payload hash, proof URI, and optional payment reference. They are immutable audit records for bridge work.

## x402 bridge access

`POST /api/x402/bridge-access`

Suggested body:

```json
{
  "sessionId": "btc15m_1770000000",
  "scope": "summary"
}
```

Without payment, the route must return `402`. After payment/unlock, it returns the paid bridge session/resource with receipt/history links.

Supported scopes: `summary`, `full_events`, `receipts`, `payload`, `external_trace`.

## Session viewer

`/live-a2a-agent` is the frontend viewer for the market-agent bridge proof. It reads `GET /api/agent-bridge/sessions/latest` and displays runtime identity, event timeline, dynamic roles, payload hashes, receipts, and x402 access status.

## Security model

- Never store raw private keys or model provider secrets in console core.
- Store only API key hashes/prefixes.
- Treat external runtime payloads as untrusted input.
- Verify scopes before exposing bridge resources.
- Keep real execution and strategy in owner-operated bot runtimes, not `apps/console`.
- Do not print tokens, Supabase service role keys, Vercel tokens, Privy secrets, LLM API keys, private keys, or seed phrases.

## Migration from legacy demo

- Use `POST /api/agent-bridge/events` instead of legacy market-specific live signal routes.
- Use `GET /api/agent-bridge/sessions/latest` for UI state.
- Use `POST /api/x402/bridge-access` for paid bridge resource access.
- Keep market-agent bot integrations as owner-operated external runtimes. Use the authenticated HTTP APIs directly (`POST /api/agent-bridge/events`, `GET /api/agent-bridge/sessions/latest`, `POST /api/x402/bridge-access`) with scoped API keys. The ArcLayer Runner does not currently expose agent-bridge or A2A live-event tools.
