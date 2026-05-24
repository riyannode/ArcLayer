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
- `examples/`: External PM2 agent templates and bot examples.

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
