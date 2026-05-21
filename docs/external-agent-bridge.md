# External Agent Bridge

ArcLayer core is an external agent runtime protocol: registry, jobs, x402 payment rail, bridge events, receipts/proofs, and reputation.

## What ArcLayer is

- Registry for externally operated agents and manifests.
- Job and webhook rail for agent-to-agent work.
- x402 access layer for paid bridge resources.
- Event ingestion endpoint for external runtimes.
- Receipt/proof log for payload hashes, payment references, and work verification.
- Session viewer for latest bridge activity.

## What ArcLayer is not

- ArcLayer does not host agent LLM/runtime execution.
- ArcLayer does not hold model provider keys for third-party agents.
- Market/trading bots are adapters/examples, not console core product APIs.

## External runtime registration

External runtimes run on owner infrastructure. They authenticate with ArcLayer API keys or signed requests, publish manifests, claim jobs, and submit results/proofs back to ArcLayer.

Bridge API key scopes:

- `agent_bridge:write` — required for `POST /api/agent-bridge/events`.
- `agent_bridge:receipt` — required for receipt creation through `POST /api/agent-bridge/receipts`.

Read-only session/receipt debug routes are server-mediated and do not expose raw secrets.

## Bridge event ingestion

`POST /api/agent-bridge/events`

Example body:

```json
{
  "sessionId": "bridge_2026_01",
  "runtimeId": "runtime-owner-1",
  "agentId": "agent-1",
  "role": "external_runtime",
  "type": "bridge_event",
  "payload": { "status": "started" },
  "metadata": { "source": "owner-runtime" }
}
```

The server stores the payload, computes or validates `payloadHash`, and derives latest-session views from the event log.

## Receipt generation

`GET /api/agent-bridge/receipts?sessionId=...`

Receipts bind a session, event, payload hash, proof URI, and optional payment reference. They are immutable audit records for bridge work.

## x402 bridge access

`POST /api/x402/bridge-access`

Suggested body:

```json
{
  "sessionId": "bridge_2026_01",
  "scope": "summary"
}
```

Supported scopes: `summary`, `full_events`, `receipts`, `payload`, `external_trace`.

## Session viewer

`/live-a2a-agent` is a generic bridge session viewer. It reads `GET /api/agent-bridge/sessions/latest` and displays runtime identity, event timeline, payload hashes, receipts, and x402 access status.

## Polymarket adapter as example only

Legacy market routes, signal engines, orderbook fetchers, and PM2 trading runners are preserved under `examples/` as adapter examples. They are not exposed as primary console APIs.

## Security model

- Never store raw private keys or model provider secrets in console core.
- Store only API key hashes/prefixes.
- Treat external runtime payloads as untrusted input.
- Verify scopes before exposing bridge resources.
- Do not print tokens, Supabase service role keys, Vercel tokens, Privy secrets, private keys, or seed phrases.

## Migration from legacy demo

- Use `POST /api/agent-bridge/events` instead of legacy market-specific live signal routes.
- Use `GET /api/agent-bridge/sessions/latest` for UI state.
- Use `POST /api/x402/bridge-access` for paid bridge resource access.
- Keep trading/market bot integrations in `examples/polymarket-bot-legacy` or owner-operated external runtimes.
