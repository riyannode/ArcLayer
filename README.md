<div align="center">

# ArcLayer

**Protocol layer and x402 facilitator for the agentic economy on Arc.**

[Live Console](https://arclayer-zeta.vercel.app) · [Arc Explorer](https://testnet.arcscan.app) · [Arc Network](https://arc.network) · [x402 Protocol](https://x402.org)

</div>

## Overview

ArcLayer is a protocol layer and **x402 facilitator** that enables on-chain micropayments for autonomous AI agent execution on Arc Network. It implements the [x402 micropayment protocol](https://x402.org) on top of `JobEscrow`-based verification and settlement on Arc Testnet (chain `5042002`, asset `USDC`). The repository carries:

- **x402 Facilitator** — production-ready micropayment gate for protected API routes (scheme: `arc-escrow`)
- **Protocol Contracts** — `JobEscrow`, `AgentRegistry`, `WorkProof`, `ReputationOracle`, live on Arc Testnet
- **SDK** — `@arclayer/sdk` TypeScript client for all contracts
- **Indexer** — lightweight event indexer with SQLite cache
- **Console** — Next.js app with x402 facilitator, agent runner, and protocol UI
- **Legacy V1** — `MilestoneEscrow` milestone-based escrow (historical, still deployed)

---

## Current Status

| Component | Status |
|---|---|
| x402 Facilitator | ✅ Production E2E pass — 17/17 (May 2026) |
| Protocol contracts | ✅ Live on Arc Testnet |
| Console app | ✅ Production — `https://arclayer-zeta.vercel.app` |
| SDK | ✅ Published workspace package |
| Indexer | ✅ Running on VPS (PM2) |
| MilestoneEscrow (V1) | ✅ Legacy — deployed, historical |

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

## Deploy Proofs

### x402 Facilitator
Production E2E verified May 2026 — 17/17 test cases pass. See E2E table below.

### Protocol Contracts
- `AgentRegistry`: [0xc973a730482eeb67ce17a7e04a96200a3d50bfcc4905ace265b04d9cf7fafbb9](https://testnet.arcscan.app/tx/0xc973a730482eeb67ce17a7e04a96200a3d50bfcc4905ace265b04d9cf7fafbb9)
- `WorkProof`: [0x567eab55746b2b567304d61201dba18b80c3698bbaa7ca9830a8832051c5d35a](https://testnet.arcscan.app/tx/0x567eab55746b2b567304d61201dba18b80c3698bbaa7ca9830a8832051c5d35a)
- `JobEscrow`: [0x2b3e900692641a48080e705e959fcf8135fb7829100756ffa2b37ae6b9bedc45](https://testnet.arcscan.app/tx/0x2b3e900692641a48080e705e959fcf8135fb7829100756ffa2b37ae6b9bedc45)
- `ReputationOracle`: [0x5232aa8778a30f78d1173a5d36aa6dc17378c14af6cd4c9c3a9e985e5bf3256f](https://testnet.arcscan.app/tx/0x5232aa8778a30f78d1173a5d36aa6dc17378c14af6cd4c9c3a9e985e5bf3256f)

### Legacy V1
- `MilestoneEscrow`: [0xd10476a06b942348a22b32faea36e53f2b6d5f8ad1c6f4a0eb9f3e36d23ded10](https://testnet.arcscan.app/tx/0xd10476a06b942348a22b32faea36e53f2b6d5f8ad1c6f4a0eb9f3e36d23ded10)

---

## End-to-End Proofs

### x402 Facilitator — Production E2E (May 2026)

Paid agent run completed end-to-end on production (`https://arclayer-zeta.vercel.app`).

| Step | Result |
|---|---|
| No payment → `402` + `PAYMENT-REQUIRED` | ✅ |
| `createJob` on Arc Testnet | ✅ jobId `13` |
| `setBudget` + `approve USDC` + `fund escrow` | ✅ `JobFunded` emitted |
| `POST /api/x402/verify` | ✅ `verified` |
| `POST /api/x402/settle` | ✅ `settled` |
| `POST /api/agents/demo/run` (first run) | ✅ `200`, agent executed |
| Retry same payment | ✅ `200`, `cached: true` |
| Same txHash → different resource | ✅ rejected `PAYMENT_REPLAY_DIFFERENT_RESOURCE` |

- **txHash**: `0x3b5578f304970f3e91fa36e3de1af2c389dd4c01f2c3d17040fca7e020ae80d9`
- **jobId**: `13`
- **model**: `gpt-5.5` (via 9router)
- **output**: `Hello. Task received for Agent ID demo, Job ID 13.`
- **latency**: `2724ms`
- **E2E score**: 17/17 ✅

### Legacy V1 — MilestoneEscrow (Project 0)

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

Final state: `totalAmount=2000000`, `releasedAmount=2000000`, `milestoneCount=2`, `status=Completed`

---

## Architecture

```text
Client
  │
  ├─ POST /api/agents/[id]/run  (no X-PAYMENT)
  │       └─ 402 + PAYMENT-REQUIRED header + x402_requirements row (Supabase)
  │
  ├─ Arc Testnet: createJob → setBudget → approve USDC → JobEscrow.fund()
  │       └─ emits JobFunded(jobId, client, amount)
  │
  ├─ POST /api/agents/[id]/run  (X-PAYMENT: <txHash>)
  │       ├─ x402 Facilitator: verifyPayment (on-chain receipt + JobFunded event)
  │       ├─ x402 Facilitator: settlePayment (idempotent)
  │       ├─ x402 Facilitator: consumePayment (atomic via Supabase RPC)
  │       │       ├─ ALREADY_CONSUMED → return cached response
  │       │       └─ CONSUMED → run agent
  │       ├─ agentExecutor → 9router → LLM
  │       └─ cache response in x402_response_cache (Supabase)
  │
  ├─ POST /api/x402/verify      (generic facilitator endpoint)
  ├─ POST /api/x402/settle      (generic facilitator endpoint)
  └─ GET  /api/x402/supported   (network + scheme config)

Supabase (server-only, service_role):
  x402_requirements   — payment challenges issued per request
  x402_payments       — verified on-chain payments
  x402_payment_attempts — audit trail
  x402_consumptions   — atomic consume gate (unique per txHash)
  x402_response_cache — idempotent response replay

Contracts (Arc Testnet, chainId 5042002):
  JobEscrow           — escrow + JobFunded event
  AgentRegistry       — agent identity
  WorkProof           — proof-of-work NFT
  ReputationOracle    — reputation scoring
  MilestoneEscrow     — legacy V1 milestone flow
```

---

## Repo Layout

```text
arclayer/
├── contracts/          Solidity — JobEscrow, AgentRegistry, WorkProof, ReputationOracle, MilestoneEscrow
├── sdk/                @arclayer/sdk — TypeScript client, ABIs, chain config, viem contracts
├── indexer/            Event indexer — SQLite cache, HTTP server, Arc Testnet event replay
├── apps/
│   └── console/        Next.js app — x402 facilitator, agent runner, protocol UI
│       ├── src/
│       │   ├── app/
│       │   │   ├── api/
│       │   │   │   ├── agents/[id]/run/   Paid agent execution endpoint
│       │   │   │   ├── x402/supported/    Network + scheme config
│       │   │   │   ├── x402/verify/       Generic payment verify
│       │   │   │   ├── x402/settle/       Generic payment settle
│       │   │   │   ├── jobs/[id]/runs/    Job run history
│       │   │   │   ├── jobs/[id]/submit/  Deliverable submission
│       │   │   │   ├── runs/[id]/         Run detail
│       │   │   │   └── indexer/           Indexer proxy
│       │   │   ├── agents/                Agent list page
│       │   │   ├── agent/[id]/            Agent detail page
│       │   │   ├── jobs/                  Job list page
│       │   │   ├── job/[id]/              Job detail page
│       │   │   ├── protocol/              Protocol overview page
│       │   │   ├── docs/                  Docs page
│       │   │   └── project/[id]/          Legacy milestone project page
│       │   └── lib/
│       │       ├── x402/                  x402 facilitator core
│       │       │   ├── types.ts           TypeScript types
│       │       │   ├── constants.ts       Chain ID, addresses, header names
│       │       │   ├── store.ts           Store interface
│       │       │   ├── store.supabase.ts  Supabase implementation
│       │       │   ├── supabaseClient.ts  Server-only admin client
│       │       │   ├── parser.ts          X-PAYMENT header parser
│       │       │   ├── headers.ts         PAYMENT-REQUIRED / PAYMENT-RESPONSE builders
│       │       │   ├── requirements.ts    Requirement builder + issuer
│       │       │   ├── verify-arc-escrow.ts  On-chain JobFunded verifier
│       │       │   ├── facilitator.ts     Orchestrator (issue/verify/settle/consume/cache)
│       │       │   └── index.ts           Barrel export
│       │       ├── agentExecutor.ts       LLM agent runner (9router / OpenAI-compatible)
│       │       ├── runStore.ts            SQLite idempotency store (legacy path)
│       │       ├── x402Client.ts          Client-side payment helper
│       │       └── x402Headers.ts        Legacy header builders (backward compat)
│       └── supabase/
│           └── migrations/
│               └── 001_x402_facilitator.sql  Full schema + RLS + RPC
└── docs/               Architecture notes, SDK reference, indexing design
```

---

## x402 Facilitator

The x402 facilitator is a generic, reusable payment gate for protected API routes. It implements the [x402 micropayment protocol](https://x402.org) on top of Arc Testnet's `JobEscrow` contract.

### How it works

1. Client hits a protected route without payment → receives `402` with `PAYMENT-REQUIRED` header and a `requirementId`
2. Client creates a job on Arc Testnet, funds `JobEscrow`, gets a `txHash`
3. Client retries with `X-PAYMENT: <txHash>` (or structured JSON)
4. Facilitator verifies the on-chain `JobFunded` event against the requirement
5. Facilitator atomically consumes the payment via Supabase RPC (replay-safe)
6. Agent executes, response is cached — retries return the cached response

### Replay protection

- `txHash` is unique per payment row (`UNIQUE` constraint)
- Same `txHash` + same resource → returns cached response (idempotent)
- Same `txHash` + different resource → hard reject `PAYMENT_REPLAY_DIFFERENT_RESOURCE`
- Atomic consume via `x402_consume_payment()` Postgres RPC (first-write-wins)

### Generic endpoints

```
GET  /api/x402/supported   — network + scheme config
POST /api/x402/verify      — verify a payment against a requirement
POST /api/x402/settle      — mark a payment as settled (idempotent)
POST /api/agents/[id]/run  — paid agent execution (x402 path when X402_FACILITATOR_ENABLED=true)
```

### Protecting a new route

```typescript
import { createX402Facilitator, getPaymentFromRequest } from '@/lib/x402';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const resource = `/api/agents/${params.id}/run`;
  const facilitator = createX402Facilitator();
  const payment = facilitator.parsePaymentFromRequest(request);

  if (!payment) {
    return facilitator.paymentRequired({
      resource,
      resourceMethod: 'POST',
      agentId: params.id,
      amountRequired: '1000000',
      description: 'Run ArcLayer agent',
    });
  }

  const verified = await facilitator.verifyPayment({ payment, resource });
  if (!verified.ok) return facilitator.paymentRejected(verified);

  const consumed = await facilitator.consumePayment({
    paymentId: verified.payment.paymentId,
    txHash: verified.payment.txHash,
    requirementId: verified.payment.requirementId,
    resource,
    resourceMethod: 'POST',
  });

  if (consumed.cachedResponse) return facilitator.toResponse(consumed.cachedResponse);

  const body = await runProtectedWork();

  return facilitator.cacheAndReturn({
    payment: verified.payment,
    consumptionId: consumed.consumptionId!,
    resource,
    statusCode: 200,
    responseBody: body,
  });
}
```

---

## SDK

`@arclayer/sdk` is a workspace TypeScript package that wraps all protocol contracts with typed viem clients.

```typescript
import { publicClient, jobEscrow, agentRegistry, workProof, CONTRACTS, arcTestnet } from '@arclayer/sdk';

// Read a job
const job = await jobEscrow.read.jobs([BigInt(jobId)]);

// Create a public client
const client = createPublicClient({ chain: arcTestnet, transport: http() });
```

RPC endpoints (ordered by latency, measured May 2026):

```
https://rpc.drpc.testnet.arc.network      (~65ms, primary)
https://rpc.testnet.arc.network           (~463ms, fallback)
https://rpc.quicknode.testnet.arc.network (~463ms, fallback)
https://rpc.blockdaemon.testnet.arc.network (~473ms, fallback)
```

viem `fallback()` transport is used — fastest healthy endpoint wins automatically.

---

## Indexer

The indexer replays Arc Testnet events and caches derived metadata in SQLite. It runs as a persistent PM2 service on VPS.

```bash
# Start indexer
corepack pnpm --dir indexer start

# Or via root script
pnpm dev:indexer
```

The console proxies indexer reads via `/api/indexer/[[...path]]`. Contract state is always canonical — the indexer cache only accelerates reads.

---

## Local Development

### Prerequisites

- Node.js 20+
- pnpm (via corepack)
- Foundry (for contracts)

### Console

```bash
corepack pnpm install
corepack pnpm --dir apps/console dev
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

### Environment variables (apps/console)

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
ARCLAYER_AGENT_MODEL=gpt-5.5
ARCLAYER_AGENT_API_KEY=<api-key>
```

### Supabase schema

Run `apps/console/supabase/migrations/001_x402_facilitator.sql` in the Supabase SQL editor. The migration is idempotent — safe to run multiple times.

---

## Arc Testnet Config

| Key | Value |
|---|---|
| Chain ID | `5042002` |
| RPC (primary) | `https://rpc.drpc.testnet.arc.network` |
| RPC (fallback) | `https://rpc.testnet.arc.network` |
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
| `/project/[id]` | Legacy milestone project (V1) |

---

## Scope Boundaries

### V1 (live)
- MilestoneEscrow milestone flow
- JobEscrow + x402 facilitator paid agent execution
- Generic `/api/x402/verify`, `/api/x402/settle`, `/api/x402/supported`
- Supabase ledger with replay protection and response cache
- Backward-compatible `X-PAYMENT` header support

### V2+ (not in scope)
- Multi-chain production support beyond Arc Testnet `chainId=5042002`
- Payment types beyond on-chain `JobFunded` escrow
- Automatic refund on agent execution failure
- Admin ledger dashboard
- Async external webhook settlement
- Dynamic pricing engine
- Payment batching
- Native facilitator SDK for third-party apps outside the monorepo
- Dispute resolution
- Subscription billing as main product path
