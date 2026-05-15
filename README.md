<div align="center">

# ArcLayer

**x402 payment facilitator + USDC escrow protocol layer for autonomous agents on Arc Testnet.**

[Live Console](https://arclayer-zeta.vercel.app) · [Arc Explorer](https://testnet.arcscan.app) · [Arc Network](https://arc.network) · [x402 Protocol](https://x402.org)

</div>

## Overview

ArcLayer is a protocol layer for paid autonomous agent execution on Arc Network. It combines an **x402-style payment gate**, **USDC escrow settlement**, **on-chain agent identity**, and **proof-of-work NFTs** so API/agent providers can require payment before execution and settle the work on-chain.

Production deployment currently targets **Arc Testnet** (`chainId=5042002`) and testnet **USDC** (`0x3600000000000000000000000000000000000000`).

Core components:

- **x402 Facilitator** — reusable micropayment gate for protected API routes (`arc-escrow` scheme)
- **JobEscrow** — USDC escrow per paid agent job
- **AgentRegistry** — on-chain agent identity and metadata registry
- **WorkProof** — NFT receipt minted for verified completed work
- **ReputationOracle** — simple on-chain reputation scores for agents/workers
- **SDK** — `@arclayer/sdk` TypeScript client for contracts and Arc Testnet config
- **Indexer** — lightweight Arc Testnet event indexer with SQLite cache and HTTP API
- **Console** — Next.js app with landing page, protocol UI, agents, jobs, x402 APIs, and indexer proxy
- **Legacy V1** — `MilestoneEscrow` + `Achievement` milestone escrow flow, kept as historical proof

---

## Verified Status

Last repo/runtime verification: **2026-05-15 22:22 UTC**.

| Component | Status | Proof |
|---|---|---|
| Console app | ✅ Live | `https://arclayer-zeta.vercel.app` returns `200` |
| TypeScript | ✅ Pass | `npx tsc --noEmit` |
| Next.js production build | ✅ Pass | `NODE_OPTIONS="--max-old-space-size=4096" npm run build` |
| Unit tests | ✅ Pass | `53/53` tests, `6/6` files |
| x402 supported endpoint | ✅ Live | `GET /api/x402/supported` returns Arc Testnet + USDC config |
| x402 payment gate | ✅ Live | `POST /api/agents/demo/run` without payment returns `402` |
| x402 verify/settle APIs | ✅ Live | Missing-body requests return expected `400` validation |
| Protocol contracts | ✅ Live | All contract addresses below return bytecode on Arc Testnet |
| Indexer | ✅ Running | PM2 service `arclayer-indexer` online |
| SDK | ✅ Workspace package | `@arclayer/sdk` in `sdk/` |
| Legacy V1 | ✅ Deployed | `MilestoneEscrow` and `Achievement` live on Arc Testnet |

> Domain note: `arclayers.xyz` is intended as the canonical custom domain, but DNS/cache propagation may still point some resolvers to an old nginx host. For grant/demo proof, use `https://arclayer-zeta.vercel.app` until the custom domain consistently resolves to Vercel.

---

## Contract Addresses — Arc Testnet

| Contract | Address |
|---|---|
| `AgentRegistry` | `0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21` |
| `WorkProof` | `0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5` |
| `JobEscrow` | `0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225` |
| `ReputationOracle` | `0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c` |
| Testnet USDC | `0x3600000000000000000000000000000000000000` |
| `MilestoneEscrow` (V1) | `0x78EA9f30744923924Fd56FcbB74D3733Ca4848f2` |
| `Achievement` (V1) | `0x7245B200ce09B515bd235f1eD262c2abb0890165` |

---

## Deployment Proofs

### Protocol Contracts

- `AgentRegistry`: [0xc973a730482eeb67ce17a7e04a96200a3d50bfcc4905ace265b04d9cf7fafbb9](https://testnet.arcscan.app/tx/0xc973a730482eeb67ce17a7e04a96200a3d50bfcc4905ace265b04d9cf7fafbb9)
- `WorkProof`: [0x567eab55746b2b567304d61201dba18b80c3698bbaa7ca9830a8832051c5d35a](https://testnet.arcscan.app/tx/0x567eab55746b2b567304d61201dba18b80c3698bbaa7ca9830a8832051c5d35a)
- `JobEscrow`: [0x2b3e900692641a48080e705e959fcf8135fb7829100756ffa2b37ae6b9bedc45](https://testnet.arcscan.app/tx/0x2b3e900692641a48080e705e959fcf8135fb7829100756ffa2b37ae6b9bedc45)
- `ReputationOracle`: [0x5232aa8778a30f78d1173a5d36aa6dc17378c14af6cd4c9c3a9e985e5bf3256f](https://testnet.arcscan.app/tx/0x5232aa8778a30f78d1173a5d36aa6dc17378c14af6cd4c9c3a9e985e5bf3256f)

### Legacy V1

- `MilestoneEscrow`: [0xd10476a06b942348a22b32faea36e53f2b6d5f8ad1c6f4a0eb9f3e36d23ded10](https://testnet.arcscan.app/tx/0xd10476a06b942348a22b32faea36e53f2b6d5f8ad1c6f4a0eb9f3e36d23ded10)

---

## End-to-End Proofs

### x402 Facilitator — Production E2E

Paid agent run completed end-to-end on production (`https://arclayer-zeta.vercel.app`).

| Step | Result |
|---|---|
| No payment → `402` + `PAYMENT-REQUIRED` | ✅ |
| `createJob` on Arc Testnet | ✅ jobId `13` |
| `setBudget` + `approve USDC` + `fund escrow` | ✅ `JobFunded` emitted |
| `POST /api/x402/verify` | ✅ `verified` |
| `POST /api/x402/settle` | ✅ `settled` |
| `POST /api/agents/demo/run` first run | ✅ `200`, agent executed |
| Retry same payment | ✅ `200`, `cached: true` |
| Same txHash → different resource | ✅ rejected `PAYMENT_REPLAY_DIFFERENT_RESOURCE` |

- **txHash**: `0x3b5578f304970f3e91fa36e3de1af2c389dd4c01f2c3d17040fca7e020ae80d9`
- **jobId**: `13`
- **model**: `gpt-5.5` through an OpenAI-compatible agent endpoint
- **output**: `Hello. Task received for Agent ID demo, Job ID 13.`
- **latency**: `2724ms`
- **E2E score**: `17/17` ✅

### Protocol JobEscrow — Role-Separated E2E

Client, worker, and evaluator used separate burner wallets. Job `19` completed the full lifecycle on Arc Testnet:

1. `registerAgent`
2. `createJob`
3. `setBudget`
4. `approve USDC`
5. `fund escrow`
6. Worker `submitDeliverable`
7. Evaluator `evaluate(true)`
8. Client `settle`
9. `WorkProof #3` minted
10. Indexer and live UI verified

| Key | Value |
|---|---|
| Job ID | `19` |
| Agent ID | `1778814739` |
| WorkProof Token ID | `3` |
| Final status | `Settled` |
| Amount funded | `0.01 USDC` |
| Paid to worker | `0.00995 USDC` |
| Platform fee | `0.00005 USDC` |
| Live job page | https://arclayer-zeta.vercel.app/job/19 |

| Step | Tx |
|---|---|
| `submitDeliverable` | [0xf66a7ba5...](https://testnet.arcscan.app/tx/0xf66a7ba5e00fe2a23d96681f55facfa0fe76f29152215cbf60b999b1ba9bfa72) |
| `evaluate(true)` | [0x69734562...](https://testnet.arcscan.app/tx/0x6973456264d6b42be02560f003c280ce24afa7a26071cebb09d60f0e5da894ef) |
| `settle` | [0x8883f432...](https://testnet.arcscan.app/tx/0x8883f432d034c95b9a663fe602b69879b1fa3d089cb17a35f4b5741c2f6873cf) |

### Legacy V1 — MilestoneEscrow

Project `0` completed end-to-end on Arc Testnet.

| Step | Tx |
|---|---|
| `createProject` | [0x54393be9...](https://testnet.arcscan.app/tx/0x54393be919309c6492145606e135f0191297d4fc6f7f0cb11194b354b4ea45ab) |
| `approve USDC` | [0x76a37085...](https://testnet.arcscan.app/tx/0x76a3708537431f071cbf304af07d124009eddcf1cfa2c87fa352e1a201998775) |
| `fundProject` | [0xa79c1402...](https://testnet.arcscan.app/tx/0xa79c140210befdcaaf7b56979a57dd054490016bb66dc6bff5e2ae939412fb6e) |
| `submitMilestone(0)` | [0x17342a44...](https://testnet.arcscan.app/tx/0x17342a444ab7d142fc8c900316786471c55d53f03644cb36ce94e6cfdf03f32f) |
| `approveMilestone(0)` | [0x2b5cbd9a...](https://testnet.arcscan.app/tx/0x2b5cbd9a83fad46f57562595272b1cb94ecbcc16b55b499997ac4d1ca6ecc0d7) |
| `submitMilestone(1)` | [0x410e0c18...](https://testnet.arcscan.app/tx/0x410e0c18551b2cbc459e6708977dcbd728bdea8cf103168fcc563eca851ce79e) |
| `approveMilestone(1)` + `WorkProofMinted` | [0xd68f8e8a...](https://testnet.arcscan.app/tx/0xd68f8e8a77b5d7101c9954f81463c58fe4ffbec514930ffeb36e5845489cf767) |

Final state: `totalAmount=2000000`, `releasedAmount=2000000`, `milestoneCount=2`, `status=Completed`.

---

## Architecture

```text
Client / Agent Consumer
  │
  ├─ POST /api/agents/[id]/run without X-PAYMENT
  │       └─ 402 + PAYMENT-REQUIRED header + requirement row in Supabase
  │
  ├─ Arc Testnet: createJob → setBudget → approve USDC → JobEscrow.fund()
  │       └─ emits JobFunded(jobId, client, amount)
  │
  ├─ POST /api/agents/[id]/run with X-PAYMENT: <txHash>
  │       ├─ parse X-PAYMENT header
  │       ├─ verify on-chain receipt + JobFunded event
  │       ├─ settle payment idempotently
  │       ├─ consume payment atomically via Supabase RPC
  │       │       ├─ already consumed for same resource → cached response
  │       │       └─ consumed first time → run protected agent work
  │       ├─ agentExecutor → OpenAI-compatible LLM endpoint
  │       └─ cache response in x402_response_cache
  │
  ├─ POST /api/x402/verify      generic facilitator verification
  ├─ POST /api/x402/settle      generic facilitator settlement
  └─ GET  /api/x402/supported   supported network/scheme config

Supabase (server-only service role):
  x402_requirements      payment challenges issued per request
  x402_payments          verified on-chain payments
  x402_payment_attempts  audit trail
  x402_consumptions      atomic consume gate, unique per txHash/resource
  x402_response_cache    idempotent response replay

Contracts (Arc Testnet, chainId 5042002):
  JobEscrow              escrow + JobFunded event
  AgentRegistry          agent identity
  WorkProof              proof-of-work NFT
  ReputationOracle       reputation scoring
  MilestoneEscrow        legacy V1 milestone flow
  Achievement            legacy V1 achievement NFT

Indexer:
  Arc Testnet events → SQLite cache → HTTP API → Next.js /api/indexer proxy
```

---

## Repo Layout

```text
arclayer/
├── contracts/                  Solidity contracts and Foundry project
│   └── src/
│       ├── AgentRegistry.sol
│       ├── JobEscrow.sol
│       ├── WorkProof.sol
│       ├── ReputationOracle.sol
│       ├── MilestoneEscrow.sol
│       └── Achievement.sol
├── sdk/                        @arclayer/sdk TypeScript workspace package
│   └── src/
│       ├── abi.ts
│       ├── addresses.ts
│       ├── chain.ts
│       ├── client.ts
│       ├── types.ts
│       ├── writes.ts
│       └── index.ts
├── indexer/                    Event indexer with SQLite + HTTP server
│   └── src/
│       ├── config.ts
│       ├── db.ts
│       ├── ingest.ts
│       ├── projections.ts
│       └── server.ts
├── apps/
│   └── console/                Next.js app: UI + x402 facilitator APIs
│       ├── src/app/
│       │   ├── api/
│       │   │   ├── agents/[id]/run/    Paid agent execution endpoint
│       │   │   ├── x402/supported/     Network + scheme config
│       │   │   ├── x402/verify/        Payment verification
│       │   │   ├── x402/settle/        Payment settlement
│       │   │   ├── jobs/[id]/runs/     Job run history
│       │   │   ├── jobs/[id]/submit/   Deliverable submission
│       │   │   ├── runs/[id]/          Run detail
│       │   │   └── indexer/            Indexer proxy
│       │   ├── agents/                 Agent list page
│       │   ├── agent/[id]/             Agent detail page
│       │   ├── jobs/                   Job list page
│       │   ├── job/[id]/               Job detail page
│       │   ├── protocol/               Protocol overview page
│       │   ├── docs/                   Docs page
│       │   └── project/[id]/           Legacy milestone project page
│       ├── src/lib/
│       │   ├── x402/                   Facilitator core
│       │   │   ├── constants.ts
│       │   │   ├── facilitator.ts
│       │   │   ├── headers.ts
│       │   │   ├── parser.ts
│       │   │   ├── requirements.ts
│       │   │   ├── store.ts
│       │   │   ├── store.supabase.ts
│       │   │   ├── supabaseClient.ts
│       │   │   ├── types.ts
│       │   │   ├── verify-arc-escrow.ts
│       │   │   └── index.ts
│       │   ├── agentExecutor.ts
│       │   ├── contracts.ts
│       │   ├── escrow-indexer.ts
│       │   ├── escrow.ts
│       │   ├── indexer.ts
│       │   ├── jobSubmitter.ts
│       │   ├── pinataClient.ts
│       │   ├── rate-limit.ts
│       │   ├── sanitize-error.ts
│       │   ├── wagmi.ts
│       │   ├── workerKeys.ts
│       │   └── x402Client.ts
│       └── supabase/migrations/
│           └── 001_x402_facilitator.sql
└── docs/
    ├── README.md
    ├── indexing.md
    ├── sdk-reference.md
    └── arclayer-build-plan.md
```

---

## x402 Facilitator

The facilitator is a reusable payment gate for protected API routes. It implements an Arc-specific `arc-escrow` scheme compatible with x402-style payment negotiation.

### Flow

1. Client hits a protected route without payment.
2. Server returns `402` with `PAYMENT-REQUIRED` and a generated `requirementId`.
3. Client creates/funds a `JobEscrow` job on Arc Testnet using USDC.
4. Client retries with `X-PAYMENT: <txHash>` or structured payment JSON.
5. Facilitator verifies the on-chain `JobFunded` event against the requirement.
6. Facilitator atomically consumes the payment using Supabase RPC.
7. Protected work runs once; retries return the cached response.

### Replay protection

- `txHash` is unique per payment row.
- Same `txHash` + same resource returns cached response.
- Same `txHash` + different resource rejects with `PAYMENT_REPLAY_DIFFERENT_RESOURCE`.
- `x402_consume_payment()` enforces first-write-wins atomic consumption in Postgres.

### Generic endpoints

```text
GET  /api/x402/supported   network + scheme config
POST /api/x402/verify      verify a payment against a requirement
POST /api/x402/settle      mark a payment as settled, idempotent
POST /api/agents/[id]/run  paid agent execution when X402_FACILITATOR_ENABLED=true
```

### Supported response proof

`GET /api/x402/supported` returns:

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "arc-escrow",
      "network": "arc-testnet",
      "chainId": 5042002,
      "asset": "0x3600000000000000000000000000000000000000",
      "assetSymbol": "USDC",
      "facilitator": "/api/x402",
      "jobEscrow": "0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225",
      "maxTimeoutSeconds": 300
    }
  ],
  "facilitator": "ArcLayer",
  "version": "1"
}
```

---

## SDK

`@arclayer/sdk` is a workspace TypeScript package that exports typed contract ABIs, addresses, Arc Testnet chain config, viem clients, and write helpers.

```typescript
import {
  arcTestnet,
  CONTRACTS,
  publicClient,
  jobEscrow,
  agentRegistry,
  workProof,
} from '@arclayer/sdk';

const job = await jobEscrow.read.jobs([BigInt(jobId)]);
console.log(arcTestnet.id); // 5042002
console.log(CONTRACTS.JobEscrow); // 0xF0E1...
```

RPC endpoints used by the app/SDK:

```text
https://rpc.drpc.testnet.arc.network
https://rpc.testnet.arc.network
https://rpc.quicknode.testnet.arc.network
https://rpc.blockdaemon.testnet.arc.network
```

The SDK uses viem and can be configured with fallback transports so the fastest healthy endpoint wins.

---

## Indexer

The indexer replays Arc Testnet events and caches derived metadata in SQLite. It is a read optimization layer only; contract state remains canonical.

```bash
# Start indexer locally
corepack pnpm --dir indexer start

# Or from repo scripts
pnpm dev:indexer
```

Production status checked May 2026:

```text
PM2: arclayer-indexer online
PM2: cf-indexer-tunnel online
```

The console reads indexer data through `/api/indexer/[[...path]]`.

---

## Local Development

### Prerequisites

- Node.js 20+
- pnpm through Corepack
- Foundry for contract build/test/deploy

### Install

```bash
corepack enable
corepack pnpm install
```

### Console

```bash
corepack pnpm --dir apps/console dev
```

### Console checks

```bash
cd apps/console
npx tsc --noEmit
npm test -- --run
NODE_OPTIONS="--max-old-space-size=4096" npm run build
```

Current verified results:

```text
TypeScript: pass
Vitest: 6 files, 53 tests passed
Next.js build: pass, 11 pages/routes rendered
```

### Contracts

```bash
cd contracts
forge install
forge build
forge test
```

### SDK

```bash
corepack pnpm --dir sdk build
```

### Environment variables (`apps/console`)

```bash
# Supabase (server-only — never expose service role key to browser)
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
ARCLAYER_AGENT_API_KEY=<server-only-key>
```

### Supabase schema

Run `apps/console/supabase/migrations/001_x402_facilitator.sql` in the Supabase SQL editor. The migration is idempotent and safe to run multiple times.

---

## Arc Testnet Config

| Key | Value |
|---|---|
| Chain ID | `5042002` |
| RPC primary | `https://rpc.drpc.testnet.arc.network` |
| RPC fallback | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |
| USDC | `0x3600000000000000000000000000000000000000` |

---

## Console App Routes

| Route | Purpose |
|---|---|
| `/` | Landing page |
| `/agents` | Agent list |
| `/agent/[id]` | Agent detail |
| `/jobs` | Job list |
| `/job/[id]` | Job detail |
| `/protocol` | Protocol overview |
| `/docs` | Documentation |
| `/project/[id]` | Legacy milestone project |
| `/api/x402/supported` | x402 network/scheme discovery |
| `/api/x402/verify` | Payment verification |
| `/api/x402/settle` | Payment settlement |
| `/api/agents/[id]/run` | Paid agent execution |

---

## Scope Boundaries

### Live scope

- Arc Testnet only (`chainId=5042002`)
- Testnet USDC escrow payments
- JobEscrow-based paid agent execution
- x402-style 402 negotiation, verification, settlement, and replay protection
- Generic `/api/x402/verify`, `/api/x402/settle`, `/api/x402/supported`
- Supabase ledger with requirements, payments, attempts, consumptions, and response cache
- Indexer-backed UI reads with on-chain state as canonical source
- Legacy V1 milestone escrow proof retained for historical context

### Not production scope yet

- Mainnet payments
- Multi-chain settlement
- Payment batching
- Subscription billing
- Dynamic pricing engine
- Dispute resolution
- Automatic refund on agent execution failure
- Full admin ledger dashboard
- Third-party standalone facilitator SDK outside this monorepo

---

## Verification Commands

Use these commands to reproduce the current proof set:

```bash
# Console health
curl -i https://arclayer-zeta.vercel.app/
curl -s https://arclayer-zeta.vercel.app/api/x402/supported
curl -i -X POST https://arclayer-zeta.vercel.app/api/agents/demo/run

# Local code checks
cd apps/console
npx tsc --noEmit
npm test -- --run
NODE_OPTIONS="--max-old-space-size=4096" npm run build

# On-chain bytecode check example
curl -s -X POST https://rpc.drpc.testnet.arc.network \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225","latest"],"id":1}'
```
