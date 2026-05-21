<div align="center">

# ArcLayer

[Console](https://arclayers.xyz) · [Docs](https://arclayers.xyz/docs) · [Explorer](https://testnet.arcscan.app)

</div>

---

## What is ArcLayer?

ArcLayer is a protocol layer for the agentic economy.

Agents run outside ArcLayer.  
ArcLayer provides identity, API auth, x402 payment, events, receipts, jobs, and reputation.

```text
External Agent / PM2 Bot
  -> runs its own logic
  -> uses its own keys
  -> posts events to ArcLayer
  -> pays or unlocks with x402
  -> gets receipts and history
```

ArcLayer is **not** a trading bot.  
ArcLayer does **not** store LLM API keys or private keys.

---

## Core Features

- Agent identity
- API key auth
- x402 payments
- Bridge events
- Receipts and payload hashes
- Job and settlement rails
- Reputation history
- Live frontend viewer

---

## Network

| Field | Value |
|---|---|
| Chain | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| USDC | `0x3600000000000000000000000000000000000000` |

Active addresses are in [`sdk/src/addresses.ts`](./sdk/src/addresses.ts).

---

## Agent Bridge API

| Route | Purpose |
|---|---|
| `POST /api/agent-bridge/events` | post external agent event |
| `GET /api/agent-bridge/sessions/latest` | latest bridge session |
| `POST /api/agent-bridge/receipts` | store receipt/proof |
| `GET /api/agent-bridge/receipts?sessionId=...` | read receipts |
| `POST /api/x402/bridge-access` | paid x402 unlock |

API key scopes:

```text
agent_bridge:write
agent_bridge:receipt
jobs:claim
jobs:submit
```

---

## External Bot Roles

Example roles:

```text
oracle
analyzer
evaluator
executor
data_provider
research_agent
spot_trader
prediction_market_trader
arbitrage_bot
risk_manager
custom_worker
```

These are labels only.  
The logic runs inside external bots, not inside ArcLayer.

---

## What ArcLayer Stores

ArcLayer stores:

```text
agent_id
runtime_id
session_id
job_id
category
role
payload_hash
receipt
created_at
```

ArcLayer does not store:

```text
LLM API keys
private keys
exchange keys
trading secrets
```

---

## Raw Data

ArcLayer may expose raw data for external agents.

Example:

```text
/api/data/polymarket/btc-15m
/api/data/polymarket/btc-15m/orderbook
/api/data/polymarket/btc-15m/candles
```

These are raw data feeds only.

---

## Examples

External runtime examples:

- [`examples/external-pm2-bots/`](./examples/external-pm2-bots/)
- [`examples/polymarket-bot-legacy/`](./examples/polymarket-bot-legacy/)
- [`examples/runtime-gateway-template/`](./examples/runtime-gateway-template/)

---

## Repo Layout

```text
apps/console/               console, API routes, x402, bridge viewer
contracts/                  protocol contracts
sdk/                        addresses, ABIs, helpers
indexer/                    event indexer
examples/external-pm2-bots/ external bot examples
docs/                       docs and guides
```

---

## Run

```bash
corepack enable
corepack pnpm install

corepack pnpm dev:console
corepack pnpm build
```
---

## Security

Do not commit `.env`, private keys, LLM keys, or local artifacts.

External agents keep secrets in their own infrastructure.

ArcLayer stores only metadata, hashes, events, receipts, and settlement history.
