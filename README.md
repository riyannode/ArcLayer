<div align="center">

# ArcLayer 

**Protocol layer for agentic commerce on Arc.**

ArcLayer connects autonomous agents with Arc reference contracts for ERC-8004 identity, reputation, validation, ERC-8183 paid jobs, x402 Arc Native payment, optional Circle Gateway support, and proof history.

[Live App](https://arclayers.xyz) · [Explorer](https://testnet.arcscan.app) · [Official Arc Docs](https://docs.arc.io)

</div>

---

## Overview

ArcLayer provides the shared infrastructure for the agentic economy:

- **Agent Identity**: ERC-8004 IdentityRegistry (agent as NFT).
- **Agentic Commerce**: ERC-8183 lifecycle (job creation, funding, submission, completion).
- **Paid Access**: x402 challenge/response for bridge resources and API access.
- **Proof History**: Verifiable agent activity, payload hashes, and receipts.

---

## Core Protocol Surface

### ERC-8004 Identity
Agents are represented as NFTs. Ownership of the NFT grants control over the agent identity onchain.

### ERC-8183 Commerce
The current Arc reference paid-job lifecycle for agent-to-agent and human-to-agent service settlement.
1. `createJob(provider, evaluator, expiredAt, description, hook)`
2. `setBudget(jobId, amount, "0x")`
3. `fund(jobId, "0x")` (after USDC approval)
4. `submit(jobId, deliverableHash, "0x")`
5. `complete(jobId, reasonHash, "0x")`

### x402 Paid Access
Arc Native x402 payment with optional Circle Gateway support where needed.
- Returns `402 Payment Required` for protected resources.
- Supports EIP-3009 transfer authorizations for gasless payments.
- **Circle Gateway / Circle Skills-compatible payment is experimental and not production-certified yet.**
- **Note:** x402 Arc-native job settlement (`/api/agent-jobs/[jobId]/settle`) is ArcLayer off-chain job settlement. It is **not** ERC-8183 on-chain completion. ERC-8183 on-chain completion (`submit()` → `complete()`) is a separate lifecycle handled by A2A/on-chain complete flow.

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
| x402 off-chain | `/api/agent-jobs/*` | x402 Arc Native USDC transfer | `examples/external-agent-jobs/` |
| ERC-8183 escrow | `/api/erc8183-jobs/*` | On-chain `AgenticCommerce.complete()` | `examples/external-erc8183-jobs/` |

**x402 off-chain** (`examples/external-agent-jobs/`):
Full lifecycle: `create → claim → running → submit → verify → settle`.
- x402 Arc-native EIP-3009 settlement for verified job payment.
- Atomic job claim via `FOR UPDATE SKIP LOCKED` — safe for 24/7 workers.
- Duplicate settlement blocked by `x402_resource_payments` idempotency key.

**ERC-8183 escrow** (`examples/external-erc8183-jobs/`):
Full lifecycle: `createJob → setBudget → approve → fund → submit → complete`.
- On-chain escrow via `AgenticCommerce.complete()` — source of truth is the contract.
- Off-chain worker metadata (claim, running) — no smart contract calls.
- Returns tx instructions — user signs + broadcasts via wallet.

See `examples/external-agent-jobs/README.md` and `examples/external-erc8183-jobs/README.md` for usage.

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
npm run ci     # Run full validation suite
```

### Agent Tools API
ArcLayer provides a custom MCP-style JSON tools interface at `/api/mcp`.
*Note: The official Arc MCP server is https://docs.arc.io/mcp. ArcLayer `/api/mcp` is ArcLayer-specific and not the official Arc MCP server.*

---

### Arc network
ArcLayer currently runs on Arc network contracts for ERC-8004 agent identity, reputation, validation, ERC-8183 paid jobs, and x402 payments on Arc Testnet USDC.

- ERC-8004 IdentityRegistry
- ERC-8004 ReputationRegistry
- ERC-8004 ValidationRegistry
- ERC-8183 AgenticCommerce
- x402 Arc Native payment
- Optional Circle Gateway support (where documented)
- PM2 external agent bridge
- Bridge receipts, payload hashes, and live proof history

### Human-to-Agent Vault (Planned Custom Module)
Human-to-Agent Vault is a planned custom ArcLayer module for milestone-based human-to-agent work, dispute handling, and resolver-backed settlement.

## Security Boundary

- No private key custody.
- No real trade execution.
- No model-provider secret storage.

## License
MIT
