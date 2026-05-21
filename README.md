<div align="center">

# ArcLayer

**Protocol bridge for autonomous agents and market-agent proof history on Arc.**

[Console](https://arclayers.xyz) · [Docs](https://arclayers.xyz/docs) · [Explorer](https://testnet.arcscan.app) · [Changelog](./CHANGELOG.md)

</div>

---

## What ArcLayer is

ArcLayer is a protocol bridge for autonomous agents. Agent owners run their own runtimes; ArcLayer provides the rails for identity, paid access, bridge events, receipts, proofs, and history.

Hackathon framing:

```text
external PM2 bot
  -> raw Polymarket BTC 15m data
  -> local/optional-LLM analysis
  -> risk evaluation
  -> DRY_RUN decision intent
  -> x402 bridge-access
  -> bridge event + payloadHash + runtimeId
  -> receipt/history
  -> /live-a2a-agent frontend viewer
```

Core surface:

- **Agent registry** — registered agents, manifests, runtime metadata, API auth, and discovery.
- **Jobs + escrow** — USDC-funded work requests, submissions, evaluation, settlement.
- **x402 payment rail** — paid API/resource access using Arc Native and Circle Gateway flows.
- **PM2 Market-Agent Bridge** — external runtime event ingestion, `payloadHash`, `runtimeId`, receipt/proof records, session viewer.
- **Reputation/history** — outcomes and receipts that can feed reputation/proof surfaces.

ArcLayer does **not** host third-party LLM runtimes, hold model provider keys, run real trading executors, or hardcode trading strategy in `apps/console`.

---

## Hackathon PM2 market-agent runtime proof

This is not a generic external LLM demo. External PM2 bots make market decisions; ArcLayer handles x402 payment, bridge events, receipts, and proof history on Arc.

Demo path:

1. PM2 oracle bot fetches raw Polymarket BTC 15m data.
2. Analyzer bot uses local deterministic logic or optional local LLM key.
3. Evaluator bot emits risk/evaluation output.
4. Executor bot emits a `DRY_RUN` intent only.
5. ArcLayer stores event payload, `payloadHash`, `runtimeId`, `job_id`, and category.
6. `POST /api/x402/bridge-access` returns `402` without payment.
7. After payment/unlock, session and receipt data display in the frontend.
8. `/live-a2a-agent` shows the full oracle → analyzer → evaluator → executor → x402 → receipt/history flow.

ArcLayer is the protocol bridge. Bots run anywhere. Bots own strategy, local LLM keys, and execution. ArcLayer handles identity, x402, events, receipts, payload hashes, and history.

---

## Network

| Field | Value |
|---|---|
| Chain | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| USDC | `0x3600000000000000000000000000000000000000` |
| Console | `https://arclayers.xyz` |

Active addresses are in [`sdk/src/addresses.ts`](./sdk/src/addresses.ts).

---

## Live contract status

ArcLayer is live on Arc Testnet. Core and A2A contracts are source-verified on ArcScan / Blockscout.

| Contract | Address | Status | Owner |
|---|---|---|---|
| Achievement | `0x7245B200ce09B515bd235f1eD262c2abb0890165` | Verified | `0xaa68E429319d065Ce9fD5842497A8dBEc786075A` |
| MilestoneEscrow | `0x78EA9f30744923924Fd56FcbB74D3733Ca4848f2` | Verified | `0xaa68E429319d065Ce9fD5842497A8dBEc786075A` |
| AgentRegistry | `0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21` | Verified | Timelock |
| JobEscrow | `0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225` | Verified | Timelock |
| WorkProof | `0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5` | Verified | Timelock |
| ReputationOracle | `0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c` | Verified | Read-only oracle surface |
| A2AAgentRegistry | `0xB263336055dD65FF501e36CA39941760D943703C` | Verified | `0xaa68E429319d065Ce9fD5842497A8dBEc786075A` |
| A2AReputationRegistry | `0x9c97CAE866397d94e295632B3BFCF342ea20f1Cc` | Verified | `0xaa68E429319d065Ce9fD5842497A8dBEc786075A` |
| A2AReceiptRegistry | `0x5F591465D0C2fe20A28D2539dFBB2B00716397B7` | Verified | `0xaa68E429319d065Ce9fD5842497A8dBEc786075A` |
| MarketMirrorRegistry | `0xec5910926925941c451C97A8bd2c4Ba7bD173195` | Verified | Legacy/demo market layer |
| Ignia | `0xd66971F9Da4c60DB4A061686F43dBf39Db5E2916` | Verified | Legacy/demo market layer |
| AgentRegistryV2 | `0x0465CeBC34698Aa156bcBB8d5c1caA39777dDb58` | Verified | `0xaa68E429319d065Ce9fD5842497A8dBEc786075A` |

Timelock owner: `0x7663926a72269e81a60302e9C65B0b325a2641Ae`

Timelock delay: `86400 seconds` / `24 hours`

Core protocol contracts are protected by Timelock governance. Admin actions on AgentRegistry, JobEscrow, and WorkProof cannot execute instantly.

Legacy exported addresses:

- Invoice: `0x1Eb2Ed241Cb978f4BF02DA68E128D50AD7A53Fbf`
- Subscription: `0x01028Ca35bE5c3dcE85F661C6528138bc3Ad9Fc1`

Invoice and Subscription are exported for legacy compatibility only. They are not part of the current active ArcLayer product surface.

---

## PM2 Market-Agent Bridge API

External runtimes authenticate with an ArcLayer API key and post bridge activity into the console/backend.

Required API key scopes:

- `agent_bridge:write` — post bridge events to `POST /api/agent-bridge/events`.
- `agent_bridge:receipt` — create receipt records through `POST /api/agent-bridge/receipts`.

Bridge routes:

- `POST /api/agent-bridge/events` — ingest runtime/agent/oracle/analyzer/evaluator/executor events.
- `GET /api/agent-bridge/sessions/latest` — latest bridge session for the viewer.
- `GET /api/agent-bridge/receipts?sessionId=...` — receipt list for a session.
- `POST /api/x402/bridge-access` — paid access to bridge session resources; returns `402` without payment.

Raw data routes:

- `GET /api/data/polymarket/btc-15m`
- `GET /api/data/polymarket/btc-15m/orderbook`
- `GET /api/data/polymarket/btc-15m/candles`

See [`docs/external-agent-bridge.md`](./docs/external-agent-bridge.md).

---

## x402 surface

ArcLayer supports dual-mode x402 payments:

- **Arc Native** — EIP-3009 `transferWithAuthorization` using `X-PAYMENT`.
- **Circle Gateway** — Gateway batching using `PAYMENT-SIGNATURE`.

Visible payment UI:

- Homepage x402 ticket
- [`/x402-demo`](https://arclayers.xyz/x402-demo)
- [`/live-a2a-agent`](https://arclayers.xyz/live-a2a-agent)

Manual jobs do not require x402. The manual job path uses JobEscrow directly:

```text
createJob -> setBudget -> approve USDC -> fundJob -> submit -> evaluate -> settle
```

---

## Repository layout

```text
apps/console/              Next.js console, API routes, x402, bridge viewer
contracts/                 Foundry workspace for core and A2A contracts
sdk/                       @arclayer/sdk addresses, ABIs, read/write helpers
indexer/                   Event indexer + REST
examples/external-pm2-bots Owner-operated PM2 runtime examples
examples/polymarket-bot-legacy Legacy market adapter example
examples/runtime-gateway-template Runtime gateway template
docs/                      Public docs and integration guides
scripts/                   Live verification scripts
```

---

## Run locally

```bash
corepack enable
corepack pnpm install

corepack pnpm dev:console   # console at :3000
corepack pnpm dev:indexer   # indexer
corepack pnpm build         # console build

cd contracts && forge build && forge test
```

For console builds on small VPS instances, use:

```bash
NODE_OPTIONS='--max-old-space-size=4096' corepack pnpm --dir apps/console build
```

---

## Docs

- [`docs/external-agent-bridge.md`](./docs/external-agent-bridge.md) — PM2 market-agent bridge proof, APIs, scopes, and migration notes.
- [`CHANGELOG.md`](./CHANGELOG.md) — last 7 days.
- [`docs/`](./docs/README.md) — integration guides, SDK reference, indexer, x402 reports.
- [`AGENTS.md`](./AGENTS.md) — guide for AI agents working in this repo.

---

No `.env`, private keys, or local artifacts are tracked.
