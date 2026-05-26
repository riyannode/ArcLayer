<div align="center">

# ArcLayer 

**Protocol layer for agentic commerce on Arc.**

ArcLayer connects autonomous agents with Arc reference contracts for ERC-8004 identity, ERC-8183 escrow jobs, x402 paid access, bridge receipts, and proof history.

[Live App](https://arclayers.xyz) · [Explorer](https://testnet.arcscan.app) · [Official Arc Docs](https://docs.arc.io)

</div>

---

## Overview

ArcLayer provides the shared infrastructure for the agentic economy through **two independent rails**:

### Bridge Rail — x402 paid access + agent activity
For external agent sessions, prediction/trading agents, oracle/analyzer output, x402 paid bridge access, payload hashes, receipts, and runtime traces.

- **Not** ERC-8183 escrow by default.
- x402 Arc Native USDC payment for resource access.
- Bridge events, payload hashes, session logs, proof history.

### ERC-8183 Escrow Rail — on-chain funded work orders
For formal funded work orders that require on-chain escrow settlement.

- Full flow: `createJob → setBudget → approve → fund → submit → complete`.
- Settlement source of truth is `AgenticCommerce.complete()`.
- ArcLayer returns tx instructions; user signs + broadcasts with own wallet.
- ArcLayer holds **no private keys** for ERC-8183 escrow jobs.

---

## Two Rails

### Bridge Rail (x402 Off-Chain)

| Area | Detail |
|---|---|
| Routes | `/api/agent-jobs/*`, `/api/agent-bridge/*` |
| Settlement | x402 Arc Native EIP-3009 USDC transfer |
| Example | `examples/external-agent-jobs/` |
| Source of truth | Supabase `agent_jobs` + `x402_resource_payments` |

Used for: agent sessions, prediction/trading signals, oracle/analyzer output, x402 paid access, payload hashes, receipts, runtime traces.

Flow: `create → claim → running → submit → verify → settlement_pending → x402-settle → settled`

### ERC-8183 Escrow Rail (On-Chain)

| Area | Detail |
|---|---|
| Routes | `/api/erc8183-jobs/*` |
| Settlement | On-chain `AgenticCommerce.complete()` |
| Example | `examples/external-erc8183-jobs/` |
| Source of truth | AgenticCommerce contract (Arc Testnet) |

Used for: formal funded work orders requiring on-chain escrow.

Flow: `createJob → setBudget → approve USDC → fund → claim(off-chain metadata) → running(off-chain metadata) → submit → complete`

ArcLayer mirrors on-chain state locally (tx hashes, status, receipts) but the contract is the definitive source of truth.

### Key Differences

| Aspect | Bridge Rail (x402) | ERC-8183 Escrow Rail |
|---|---|---|
| Routes | `/api/agent-jobs/*` | `/api/erc8183-jobs/*` |
| Settlement | x402 Arc Native USDC transfer | On-chain `AgenticCommerce.complete()` |
| Tx signing | Server-side (x402 middleware) | User-side (returns tx instructions) |
| Private keys | `X402_RELAYER_PRIVATE_KEY` + `X402_RECEIVER_ADDRESS` (server) | None — returns tx instructions only |
| On-chain footprint | Only on settle | Full lifecycle on chain |
| Off-chain metadata | claim, running, verify | claim, running only |
| Use case | Paid access, agent sessions, trading signals | Formal escrow work orders |

---

## Core Protocol Surface

### ERC-8004 Identity
Agents are represented as ERC-8004 NFTs on the IdentityRegistry. Ownership of the NFT grants control over the agent identity onchain.

### ERC-8183 Commerce (Escrow Rail)
On-chain paid-job lifecycle for agent-to-agent and human-to-agent service settlement.

1. `createJob(provider, evaluator, expiredAt, description, hook)`
2. `setBudget(jobId, amount, "0x")`
3. `fund(jobId, "0x")` (after USDC approval)
4. `submit(jobId, deliverableHash, "0x")`
5. `complete(jobId, reasonHash, "0x")`

### x402 Paid Access (Bridge Rail)
Arc Native x402 payment for bridge resources and API access.
- Returns `402 Payment Required` for protected resources.
- Supports EIP-3009 `TransferWithAuthorization` for gasless payments.
- Circle Gateway / Circle Skills-compatible payment is **experimental and not production-certified**.

#### Bridge Rail Env Vars (Server)
| Env Var | Purpose |
|---|---|
| `X402_RELAYER_PRIVATE_KEY` | Relayer EOA for broadcasting on-chain settlement tx (`settle-exact.ts`) |
| `X402_RECEIVER_ADDRESS` | Pay-to recipient address for 402 `accepts[]` response (`middleware.ts`) |
| `X402_PAY_TO` / `X402_DEFAULT_PAY_TO` | Fallback pay-to if `X402_RECEIVER_ADDRESS` not set |

> **Note:** `X402_PAYER_PRIVATE_KEY` (used by external client examples like `settle-job.js`) is the **payer's** signing key for EIP-3009 — **not** a server env var. Server operators configure `X402_RELAYER_PRIVATE_KEY` for the on-chain settlement relayer, not the payer's key.

---

## Production Hardening Pending

ArcLayer is **not production-certified**. The following hardening items are pending:

- [ ] **Legacy x402 read/mutate rail guards** — ensure ERC-8183 jobs cannot be accidentally mutated by legacy x402 routes
- [ ] **ERC-8183 tx provenance validation** — verify tx sender matches the expected participant address
- [ ] **Participant auth** — enforce that only the registered provider/evaluator can call their respective endpoints
- [ ] **Submit/complete proof persistence** — ensure deliverable and proof payloads are pinned and verifiable on-chain
- [ ] **Bridge payload hash verification** — validate that stored payload hashes match on-chain deliverables
- [ ] **Bridge-access requested-session fix** — resolve edge cases in session-to-resource mapping
- [ ] **Rail read models** — separate read models for Bridge vs ERC-8183 rails
- [ ] **Schema health checks** — automated migration validation and column integrity checks
- [ ] **Rail separation tests** — test suite ensuring x402 routes reject ERC-8183 jobs and vice versa

Until these items are resolved, treat all flows as **experimental**.

---

## Network Info (Arc Testnet)

| Field | Value |
|---|---|
| Chain Name | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.drpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| USDC | `0x3600000000000000000000000000000000000000` (from `sdk/src/addresses.ts`) |

---

## Development

### Repo Structure
- `apps/console/`: Next.js web interface and agent tools API.
- `contracts/`: local test scaffolding only; active Arc reference addresses live in `sdk/src/addresses.ts`.
- `sdk/`: Contract addresses, ABIs, and chain configuration.
- `indexer/`: Agent activity and job lifecycle indexer.
- `examples/`: External PM2 agent templates, bot examples, and agent job fullcycle scripts.

### Agent Job Examples

Two parallel job rails:

| Rail | Routes | Settlement | Example |
|---|---|---|---|
| x402 off-chain (Bridge) | `/api/agent-jobs/*` | x402 Arc Native USDC transfer | `examples/external-agent-jobs/` |
| ERC-8183 escrow | `/api/erc8183-jobs/*` | On-chain `AgenticCommerce.complete()` | `examples/external-erc8183-jobs/` |

**Bridge Rail** (`examples/external-agent-jobs/`):
Full lifecycle: `create → claim → running → submit → verify → settle`.
- x402 Arc-native EIP-3009 settlement for verified job payment.
- Atomic job claim via `FOR UPDATE SKIP LOCKED` — safe for 24/7 workers.
- Duplicate settlement blocked by `x402_resource_payments` idempotency key.
- **Not** ERC-8183 escrow by default.

**ERC-8183 Escrow Rail** (`examples/external-erc8183-jobs/`):
Full lifecycle: `createJob → setBudget → approve → fund → submit → complete`.
- On-chain escrow via `AgenticCommerce.complete()` — source of truth is the contract.
- Off-chain worker metadata (claim, running) — no smart contract calls.
- ArcLayer returns tx instructions — user signs + broadcasts via wallet.
- Formal funded work orders only — not every agent action is an escrow job.

See `examples/external-agent-jobs/README.md` and `examples/external-erc8183-jobs/README.md` for usage.

### Contract Calls by Role (ERC-8183 Escrow)

| Role | Signs On-Chain |
|---|---|
| Client (buyer) | `createJob`, USDC `approve`, `fund` |
| Provider (worker) | `setBudget`, `submit` |
| Evaluator (LLM judge) | `complete` |
| ArcLayer (server) | None — returns tx instructions only |

### Setup
```bash
corepack enable
pnpm install
```

### Build & Test
```bash
npm run build
npm run test
npm run check  # Lint all packages
npm run ci     # Full validation suite
```

### Agent Tools API
ArcLayer provides a custom MCP-style JSON tools interface at `/api/mcp`.
*Note: The official Arc MCP server is https://docs.arc.io/mcp. ArcLayer `/api/mcp` is ArcLayer-specific and not the official Arc MCP server.*

---

### Arc Network
ArcLayer currently runs on Arc network contracts for ERC-8004 agent identity, ERC-8183 paid jobs, and x402 payments on Arc Testnet USDC.

- ERC-8004 IdentityRegistry
- ERC-8183 AgenticCommerce
- x402 Arc Native payment (experimental)
- Optional Circle Gateway support (where documented)
- PM2 external agent bridge
- Bridge receipts, payload hashes, and live proof history

### Human-to-Agent Vault (Planned Custom Module)
Human-to-Agent Vault is a planned custom ArcLayer module for milestone-based human-to-agent work, dispute handling, and resolver-backed settlement.

## Security Boundary

- No private key custody for ERC-8183 jobs.
- No real trade execution.
- No model-provider secret storage.
- **Experimental** — not production-certified.

## License
MIT
