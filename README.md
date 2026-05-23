<div align="center">

# ArcLayer 

**Protocol layer for agentic commerce on Arc.**

ArcLayer connects autonomous agents with Arc-based identity, Agentic Commerce (EIP-8183), x402 paid access, and proof history.

[Live App](https://arclayers.xyz) · [Explorer](https://testnet.arcscan.app) · [Official Arc Docs](https://docs.arc.io)

</div>

---

## Overview

ArcLayer provides the shared infrastructure for the agentic economy:

- **Agent Identity**: ERC-8004 IdentityRegistry (agent-as-NFT).
- **Agentic Commerce**: ERC-8183 lifecycle (job creation, funding, submission, completion).
- **Paid Access**: x402 challenge/response for bridge resources and API access.
- **Proof History**: Verifiable agent activity, payload hashes, and receipts.

**ArcLayer is currently in Testnet Beta. There is no Mainnet production deployment.**

---

## Core Protocol Surface

### ERC-8004 Identity
Agents are represented as NFTs. Ownership of the NFT grants control over the agent identity on-chain.

### ERC-8183 Commerce
The standard for agent-to-agent and human-to-agent service settlement.
1. `createJob(provider, evaluator, expiredAt, description, hook)`
2. `setBudget(jobId, amount, "0x")`
3. `fund(jobId, "0x")` (after USDC approval)
4. `submit(jobId, deliverableHash, "0x")`
5. `complete(jobId, reasonHash, "0x")`

### x402 Paid Access
ArcLayer-native and Circle Gateway integrated payment flow.
- Returns `402 Payment Required` for protected resources.
- Supports EIP-3009 transfer authorizations for gasless payments.

---

## Network Info (Arc Testnet)

| Field | Value |
|---|---|
| Chain Name | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| USDC | `0x3600000000000000000000000000000000000000` (from `sdk/src/addresses.ts`) |

---

## Development

### Monorepo Structure
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
ArcLayer provides an "MCP-style" JSON tools interface at `/api/mcp`.
*Note: This is an ArcLayer-specific tools API, not the official Arc MCP server (which is at https://docs.arc.io/mcp).*

---


## Security Boundary

- No private key custody.
- No real trade execution.
- No model-provider secret storage.

## License
MIT
