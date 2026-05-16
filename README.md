<div align="center">

# ArcLayer

**x402 payment facilitator + USDC escrow protocol layer for autonomous agents on Arc Testnet.**

[![Live Console](https://img.shields.io/badge/console-arclayers.xyz-C5A67C?style=flat-square)](https://arclayers.xyz)
[![Arc Testnet](https://img.shields.io/badge/chain-Arc%20Testnet-EAE4D8?style=flat-square)](https://arc.network)
[![chainId 5042002](https://img.shields.io/badge/chainId-5042002-7A7A7A?style=flat-square)](https://testnet.arcscan.app)
[![x402](https://img.shields.io/badge/x402-arc--escrow-C5A67C?style=flat-square)](https://x402.org)

[**Console**](https://arclayers.xyz) · [**Docs**](https://arclayers.xyz/docs) · [**Explorer**](https://testnet.arcscan.app) · [**Vercel mirror**](https://arclayer-zeta.vercel.app) · [**GitHub**](https://github.com/riyannode/ArcLayer)

</div>

---

## TL;DR

ArcLayer is the **payment + settlement layer for paid AI agents**. Any HTTP API can require USDC escrow before execution using a single header — no API keys, no Stripe, no custodian.

```
1. Client hits  POST /api/agents/123/run         → 402 PAYMENT-REQUIRED
2. Client funds JobEscrow on Arc Testnet (USDC)  → JobFunded event
3. Client retries with X-PAYMENT: <txHash>       → 200 + agent output
4. Worker submits deliverable, evaluator approves, settle pays USDC + mints WorkProof NFT
```

**Live on Arc Testnet (`chainId=5042002`).** Production-grade x402 facilitator, USDC escrow, agent registry, proof-of-work NFTs.

---

## For AI Coding Agents

Integrating ArcLayer into another app? Paste this one-liner into Cursor, Claude Code, Codex, Kiro, Hermes, OpenCode, v0, or any AI coding agent:

```
Read this skill and use it to integrate ArcLayer into my app:
https://raw.githubusercontent.com/riyannode/ArcLayer/main/docs/ARCLAYER_INTEGRATION_SKILL.md
```

Working **inside** this repo? Read [`AGENTS.md`](./AGENTS.md) — it covers protocol flows, integration rules, and what AI coding agents should and should not modify.

---

## Quick Start

### Use the protocol (developer)

```bash
# 1. Hit a paid endpoint — get 402
curl -i https://arclayers.xyz/api/agents/demo/run

# 2. Fund a job on Arc Testnet via SDK (see SDK section below)
# 3. Retry with X-PAYMENT: <txHash> → get 200 + agent output
```

### Build locally (contributor)

```bash
git clone https://github.com/riyannode/ArcLayer.git
cd ArcLayer
corepack enable && corepack pnpm install

# Run console (Next.js)
corepack pnpm dev:console        # → http://localhost:3000

# Run indexer
corepack pnpm dev:indexer

# Build contracts
cd contracts && forge install && forge build && forge test
```

### Verify everything works

```bash
cd apps/console
npx tsc --noEmit
npm test -- --run
NODE_OPTIONS="--max-old-space-size=4096" npm run build
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Client / Agent Consumer                                         │
└────────────┬─────────────────────────────────────────────────────┘
             │
             │  POST /api/agents/[id]/run  (no payment)
             ▼
   ┌─────────────────────────┐
   │  402 PAYMENT-REQUIRED   │  ◄──── x402 Facilitator (Next.js API)
   └────────────┬────────────┘
                │
                │  client funds JobEscrow on Arc Testnet
                ▼
   ┌──────────────────────────────────────────────────────┐
   │  Arc Testnet (chainId 5042002)                       │
   │  ├─ JobEscrow         escrow + JobFunded event       │
   │  ├─ AgentRegistry     agent identity                 │
   │  ├─ WorkProof         proof-of-work NFT (soulbound)  │
   │  └─ ReputationOracle  reputation scoring             │
   └────────────┬─────────────────────────────────────────┘
                │  emits JobFunded(jobId, client, amount)
                ▼
   ┌─────────────────────────────────────────────────────┐
   │  Retry: POST /run + X-PAYMENT: <txHash>             │
   │  ├─ verify on-chain receipt + JobFunded event       │
   │  ├─ atomic consume via Supabase RPC                 │
   │  ├─ run protected agent work (LLM call)             │
   │  └─ cache response (idempotent retries)             │
   └─────────────────────────────────────────────────────┘

   Indexer:    Arc Testnet events → SQLite → /api/indexer
   Supabase:   x402_requirements, x402_payments, x402_consumptions, x402_response_cache
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| **Contracts** | Solidity, Foundry, OpenZeppelin |
| **Chain** | Arc Testnet (`chainId=5042002`), USDC `0x3600...` |
| **SDK** | TypeScript, viem, ABIs, write helpers |
| **Indexer** | Node.js, SQLite, viem event subscriptions, PM2 |
| **Console** | Next.js 14 (App Router), Tailwind, wagmi v2, Privy |
| **x402 Layer** | Next.js API routes, Supabase (server-only RPC) |
| **Hosting** | Vercel (console) + VPS (indexer + tunnel) |

---

## Contract Addresses — Arc Testnet

| Contract | Address |
|---|---|
| `AgentRegistry` | `0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21` |
| `JobEscrow` | `0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225` |
| `WorkProof` | `0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5` |
| `ReputationOracle` | `0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c` |
| Testnet USDC | `0x3600000000000000000000000000000000000000` (6 decimals) |
| `MilestoneEscrow` (V1) | `0x78EA9f30744923924Fd56FcbB74D3733Ca4848f2` |
| `Achievement` (V1) | `0x7245B200ce09B515bd235f1eD262c2abb0890165` |

> **UI labels vs contract names** — use UI labels in copy, contract names in code:
> Settlement Vault = `JobEscrow` · Agent Registry = `AgentRegistry` · Proof of Work = `WorkProof` · Reputation Oracle = `ReputationOracle`

Full deployment txs in [`docs/e2e-proofs.md`](./docs/e2e-proofs.md).

---

## Verified Status

Last repo/runtime verification: **2026-05-16**.

| Component | Status | Proof |
|---|---|---|
| Canonical console | ✅ Live | `https://arclayers.xyz` returns `200` |
| Vercel mirror | ✅ Live | `https://arclayer-zeta.vercel.app` returns `200` |
| Docs portal | ✅ Live | `https://arclayers.xyz/docs` returns `200` |
| All console routes | ✅ Live | `/`, `/docs`, `/agents`, `/jobs`, `/protocol` return `200` |
| TypeScript | ✅ Pass | `npx tsc --noEmit` |
| Next.js production build | ✅ Pass | `npm run build` |
| Unit tests | ✅ Pass | `53/53` tests, `6/6` files (Vitest) |
| x402 supported endpoint | ✅ Live | `GET /api/x402/supported` returns Arc Testnet config |
| x402 payment gate | ✅ Live | `POST /api/agents/demo/run` without payment returns `402` |
| x402 verify/settle APIs | ✅ Live | Validates inputs, returns `400` on missing body |
| Protocol contracts | ✅ Live | All addresses return bytecode on Arc Testnet |
| Indexer | ✅ Running | PM2 `arclayer-indexer` online |
| SDK | ✅ Workspace package | `@arclayer/sdk` in `sdk/` |
| Legacy V1 | ✅ Deployed | `MilestoneEscrow` + `Achievement` live on Arc Testnet |

End-to-end protocol proofs (jobIds, txHashes, settlements): see [`docs/e2e-proofs.md`](./docs/e2e-proofs.md).

---

## Repo Layout

```text
arclayer/
├── AGENTS.md                  AI agent guide (rules, protocol flows)
├── README.md                  This file
├── contracts/                 Solidity + Foundry
│   └── src/
│       ├── AgentRegistry.sol
│       ├── JobEscrow.sol
│       ├── WorkProof.sol
│       ├── ReputationOracle.sol
│       ├── MilestoneEscrow.sol  (legacy V1)
│       └── Achievement.sol      (legacy V1)
│
├── sdk/                       @arclayer/sdk — TypeScript client
│   └── src/
│       ├── abi.ts             Contract ABIs
│       ├── addresses.ts       Deployed addresses
│       ├── chain.ts           arcTestnet viem chain config
│       ├── client.ts          publicClient + write helpers
│       ├── writes.ts          buildCreateJobConfig, buildFundJobConfig...
│       └── index.ts
│
├── indexer/                   Event indexer (SQLite + HTTP)
│   └── src/
│       ├── ingest.ts          viem event subscriptions
│       ├── projections.ts     SQL projections
│       └── server.ts          HTTP API
│
├── apps/console/              Next.js 14 app (UI + x402 facilitator)
│   ├── src/app/
│   │   ├── api/
│   │   │   ├── agents/[id]/run/   Paid agent execution endpoint
│   │   │   ├── x402/supported/    Network + scheme config
│   │   │   ├── x402/verify/       Payment verification
│   │   │   ├── x402/settle/       Payment settlement
│   │   │   └── indexer/           Indexer reverse proxy
│   │   ├── agents/, agent/[id]/   Agent list + detail
│   │   ├── jobs/, job/[id]/       Job list + detail
│   │   ├── protocol/              Protocol overview
│   │   └── docs/                  Developer docs
│   ├── src/components/
│   │   ├── home/                  Hero, HowItWorks, CoreModules
│   │   ├── CopyButton.tsx         Reusable copy-to-clipboard
│   │   └── ...
│   ├── src/lib/x402/              x402 facilitator core
│   │   ├── facilitator.ts
│   │   ├── verify-arc-escrow.ts
│   │   ├── store.supabase.ts
│   │   └── types.ts
│   └── supabase/migrations/
│       └── 001_x402_facilitator.sql
│
└── docs/
    ├── README.md                       Docs index
    ├── ARCLAYER_INTEGRATION_SKILL.md   AI agent integration prompt
    ├── e2e-proofs.md                   E2E execution proofs
    ├── sdk-reference.md                @arclayer/sdk reference
    ├── indexing.md                     Indexer model
    └── arclayer-build-plan.md          Roadmap
```

---

## SDK

`@arclayer/sdk` exports typed contract ABIs, addresses, Arc Testnet chain config, viem clients, and write config builders.

```ts
import {
  arcTestnet,
  CONTRACTS,
  publicClient,
  buildCreateJobConfig,
  buildFundJobConfig,
} from '@arclayer/sdk';
import { useWriteContract } from 'wagmi';

const { writeContractAsync } = useWriteContract();

// Create a job
await writeContractAsync(buildCreateJobConfig(agentId, worker, client, taskInput));

// Fund the escrow
await writeContractAsync(buildFundJobConfig(jobId, amountUSDC));
```

Full reference: [`docs/sdk-reference.md`](./docs/sdk-reference.md).

---

## x402 Facilitator

The facilitator implements an Arc-specific `arc-escrow` payment scheme on top of the [x402](https://x402.org) standard. Any protected route can require USDC escrow before execution.

### Endpoints

```text
GET  /api/x402/supported     network + scheme config
POST /api/x402/verify        verify payment against requirement
POST /api/x402/settle        mark payment as settled (idempotent)
POST /api/agents/[id]/run    paid agent execution (when X402_FACILITATOR_ENABLED=true)
```

### Replay protection

- `txHash` is unique per payment row.
- Same `txHash` + same resource → returns cached response.
- Same `txHash` + different resource → rejects with `PAYMENT_REPLAY_DIFFERENT_RESOURCE`.
- `x402_consume_payment()` Postgres RPC enforces first-write-wins atomic consumption.

### `GET /api/x402/supported` response

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "arc-escrow",
    "network": "arc-testnet",
    "chainId": 5042002,
    "asset": "0x3600000000000000000000000000000000000000",
    "assetSymbol": "USDC",
    "facilitator": "/api/x402",
    "jobEscrow": "0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225",
    "maxTimeoutSeconds": 300
  }],
  "facilitator": "ArcLayer",
  "version": "1"
}
```

---

## Indexer

Replays Arc Testnet events into a local SQLite cache. Read optimization layer only — contract state remains canonical.

```bash
corepack pnpm dev:indexer
```

Production status:

```text
PM2: arclayer-indexer    online
PM2: cf-indexer-tunnel   online
```

Console reads via `/api/indexer/[[...path]]`. Endpoints:

```text
GET /api/indexer/overview          Protocol totals + recent activity
GET /api/indexer/jobs              All jobs, newest first
GET /api/indexer/jobs/:id          Single job + events
GET /api/indexer/agents            All registered agents
GET /api/indexer/agents/:id        Agent profile + jobs + proofs
GET /api/indexer/proofs            All work proofs
```

---

## Environment Variables

`apps/console/.env.local`:

```bash
# Supabase (server-only — NEVER expose service role key in browser)
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Arc Testnet RPC
ARC_RPC_URL=https://rpc.drpc.testnet.arc.network

# x402 Facilitator
X402_FACILITATOR_ENABLED=true
X402_DEFAULT_PAY_TO=0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225
X402_REQUIREMENT_TTL_SECONDS=300
X402_RESPONSE_CACHE_TTL_SECONDS=86400
X402_VERIFY_TIMEOUT_MS=10000

# Agent executor (OpenAI-compatible endpoint)
ARCLAYER_AGENT_ENDPOINT=https://<your-llm-proxy>/v1
ARCLAYER_AGENT_MODEL=<model-name>
ARCLAYER_AGENT_API_KEY=***

# Privy (browser-safe)
NEXT_PUBLIC_PRIVY_APP_ID=<privy-app-id>
```

Run the Supabase migration once:

```bash
# In Supabase SQL editor, paste:
apps/console/supabase/migrations/001_x402_facilitator.sql
```

The migration is idempotent.

---

## Arc Testnet Config

| Key | Value |
|---|---|
| Chain ID | `5042002` |
| RPC primary | `https://rpc.drpc.testnet.arc.network` |
| RPC fallbacks | `https://rpc.testnet.arc.network`, `https://rpc.quicknode.testnet.arc.network`, `https://rpc.blockdaemon.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |
| USDC | `0x3600000000000000000000000000000000000000` (6 decimals) |

---

## Console Routes

| Route | Purpose |
|---|---|
| `/` | Landing page |
| `/agents` | Agent list |
| `/agent/[id]` | Agent detail (registry, telemetry, jobs, proofs) |
| `/jobs` | Job list |
| `/job/[id]` | Job detail (lifecycle + events) |
| `/protocol` | Protocol overview + module map |
| `/docs` | Developer docs (in-app) |
| `/project/[id]` | Legacy V1 milestone project |
| `/api/x402/supported` | x402 discovery |
| `/api/x402/verify` | Payment verification |
| `/api/x402/settle` | Payment settlement |
| `/api/agents/[id]/run` | Paid agent execution |

---

## Production Checklist

- [ ] Use `@arclayer/sdk` read helpers for normalized contract objects.
- [ ] Use write config builders with viem/wagmi wallet clients. **Never expose private keys in frontend code.**
- [ ] Validate Arc Testnet `chainId=5042002` before transaction submission.
- [ ] Worker MUST be a different address than the connected client (`createJob` reverts otherwise).
- [ ] Reserve ~400k gas for `settle()`. Never hardcode 300k.
- [ ] Store rich metadata offchain (IPFS), write durable URIs onchain.
- [ ] Re-read contracts after confirmations. Indexes/caches are acceleration layers, not canonical.

---

## Scope Boundaries

### Live scope

- ✅ Arc Testnet (`chainId=5042002`)
- ✅ Testnet USDC escrow payments
- ✅ JobEscrow-based paid agent execution
- ✅ x402 negotiation, verification, settlement, replay protection
- ✅ Generic `/api/x402/*` endpoints
- ✅ Supabase ledger (requirements, payments, consumptions, cache)
- ✅ Indexer-backed UI reads with on-chain canonical state
- ✅ Legacy V1 milestone escrow proof retained

### Not in scope yet

- ❌ Mainnet payments
- ❌ Multi-chain settlement
- ❌ Payment batching
- ❌ Subscription billing
- ❌ Dynamic pricing engine
- ❌ Dispute resolution
- ❌ Auto refund on agent execution failure
- ❌ Standalone facilitator SDK outside this monorepo

---

## Verification Commands

Reproduce the current proof set:

```bash
# Console health (canonical domain)
curl -i https://arclayers.xyz/
curl -i https://arclayers.xyz/docs
curl -s https://arclayers.xyz/api/x402/supported | jq .
curl -i -X POST https://arclayers.xyz/api/agents/demo/run

# Local code checks
cd apps/console
npx tsc --noEmit
npm test -- --run
NODE_OPTIONS="--max-old-space-size=4096" npm run build

# On-chain bytecode check (JobEscrow)
curl -s -X POST https://rpc.drpc.testnet.arc.network \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225","latest"],"id":1}'
```

---

## Contributing

```bash
# Fork → clone → branch
git checkout -b feat/your-feature

# Make changes, then verify
cd apps/console
npx tsc --noEmit && npm test -- --run && npm run build

# Open a PR against main
```

**Before opening a PR:**

- TypeScript must pass (`npx tsc --noEmit`)
- All Vitest tests must pass (`npm test -- --run`)
- Next.js build must succeed
- Don't rename existing contract functions
- Don't change deployed contract addresses
- Don't hardcode private keys or service role keys

For AI coding agents working in this repo, read [`AGENTS.md`](./AGENTS.md) first.

---

## License

MIT — see [`LICENSE`](./LICENSE).

Built on [Arc Network](https://arc.network) · Implements [x402](https://x402.org) · Settled in [USDC](https://www.circle.com/usdc).
