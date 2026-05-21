<div align="center">

# ArcLayer

**Protocol layer for agentic economy on Arc.**

ArcLayer connects external AI/PM2 agents with Arc-based identity, x402 paid access, bridge events, payload hashes, receipts, and proof history.

[Live Demo](https://arclayers.xyz/live-a2a-agent) · [Console](https://arclayers.xyz) · [Explorer](https://testnet.arcscan.app)

</div>

---

## Overview

External agents run their own logic, keys, and execution environment. ArcLayer provides the shared infrastructure for:

- agent identity
- paid access through x402
- bridge event ingestion
- payload hash verification
- receipts and proof history
- live session viewer

ArcLayer does **not** hold trading keys, run real trades, or store model provider secrets. Agent logic stays inside external owner-operated runtimes.

---

## Flow

```text
External PM2 agent
  → market data
  → local / optional LLM analysis
  → risk evaluation
  → DRY_RUN execution intent
  → x402 bridge-access
  → bridge event + payloadHash + runtimeId
  → receipt / proof history
  → live frontend viewer
```

---

## Why Arc

ArcLayer uses Arc because it is designed for programmable money and agent-to-agent settlement.

- EVM compatible
- USDC as gas token
- sub-second deterministic finality
- predictable USDC-denominated fees
- suitable for high-frequency agent receipts and paid data access

---

## Network

| Field | Value |
|---|---|
| Chain | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| USDC | `0x3600000000000000000000000000000000000000` |
| App | `https://arclayers.xyz` |

Active addresses are maintained in:

```text
sdk/src/addresses.ts
```

---

## Core Features

### External Agent Bridge

External runtimes can publish agent activity into ArcLayer.

```text
POST /api/agent-bridge/events
GET  /api/agent-bridge/sessions/latest
GET  /api/agent-bridge/receipts?sessionId=...
POST /api/agent-bridge/receipts
```

Each event can include:

```text
sessionId
runtimeId
agentId
role
type
payload
payloadHash
category
metadata
```

---

### x402 Paid Access

ArcLayer exposes paid bridge resources through x402.

```text
POST /api/x402/bridge-access
```

Without payment, the endpoint returns:

```text
402 Payment Required
```

After unlock, it returns the requested session resource, events, receipts, and payload hash.

Supported scopes:

```text
summary
full_events
receipts
payload
external_trace
```

---

### PM2 Market-Agent Runtime

Example external agents are available in:

```text
examples/external-pm2-bots/hackathon-polymarket-bots
```

Bots:

```text
oracle-bot.js      # fetches raw market, orderbook, and candle data
analyzer-bot.js    # deterministic or local LLM analysis
evaluator-bot.js   # risk evaluation
executor-bot.js    # DRY_RUN execution intent only
```

Shared client:

```text
shared/arclayer-client.js
```

---

## Live Demo

Open:

```text
https://arclayers.xyz/live-a2a-agent
```

The live page shows:

- latest bridge session
- external runtime roles
- posted events
- payload hashes
- receipts
- x402 unlock status
- proof history

---

## Repository Structure

```text
apps/console/              Next.js app, API routes, x402, live viewer
contracts/                 Foundry contracts and tests
sdk/                       addresses, ABIs, and helper functions
indexer/                   event indexer and REST service
examples/external-pm2-bots external PM2 agent examples
docs/                      integration docs
scripts/                   verification and deployment scripts
```

---

## Run Locally

Install dependencies:

```bash
corepack enable
corepack pnpm install
```

Run console:

```bash
corepack pnpm dev:console
```

Run indexer:

```bash
corepack pnpm dev:indexer
```

Build app:

```bash
corepack pnpm build
```

Build and test contracts:

```bash
cd contracts
forge build
forge test
```

---

## Environment Variables

Copy the example file:

```bash
cp .env.example .env.local
```

Required for console:

```env
NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.network
NEXT_PUBLIC_ARC_USDC_ADDRESS=0x3600000000000000000000000000000000000000

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

X402_FACILITATOR_ENABLED=true
X402_RECEIVER_ADDRESS=
X402_RELAYER_PRIVATE_KEY=
X402_SETTLE_MODE=self-hosted
```

Required for external PM2 agents:

```env
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_API_KEY=
ARCLAYER_AGENT_ID=demo-agent
DRY_RUN=true
```

Optional local LLM:

```env
LLM_API_KEY=
LLM_BASE_URL=http://localhost:20128/v1
LLM_MODEL=
```

---

## Run External Agents

From the PM2 bot folder:

```bash
cd examples/external-pm2-bots/hackathon-polymarket-bots
pnpm install
```

Run the flow:

```bash
node oracle-bot.js
node analyzer-bot.js
node evaluator-bot.js
node executor-bot.js
```

Then open:

```text
https://arclayers.xyz/live-a2a-agent
```

---

## Security Model

ArcLayer follows a strict runtime boundary:

- no private keys in frontend code
- no model provider keys sent to ArcLayer
- no real trade execution in the demo executor
- external runtime payloads are treated as untrusted input
- API keys are scoped
- payloads are stored with hashes
- receipts are stored as proof records
- secrets must never be committed

---

## Current Product Surface

The main product surface is:

```text
/live-a2a-agent
/api/agent-bridge/*
/api/x402/bridge-access
examples/external-pm2-bots/hackathon-polymarket-bots
sdk/src/addresses.ts
```

Legacy experiments may exist in the repository for reference, but the active surface is the external agent bridge, x402 access layer, Arc configuration, receipts, and live proof viewer.

---

## Demo Links

| Item | Link |
|---|---|
| Live Demo | https://arclayers.xyz/live-a2a-agent |
| Console | https://arclayers.xyz |
| GitHub | https://github.com/riyannode/ArcLayer |
| Explorer | https://testnet.arcscan.app |

---

## License

MIT
