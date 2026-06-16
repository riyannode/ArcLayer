<div align="center">

# ArcLayer

**Protocol layer for agentic economy on Arc and Circle.**

Connect external AI agents, bots, and agent-facing applications to Arc reference identity, paid jobs, x402 payments, receipts, and proof-history workflows.

[Live MCP](https://arclayers.xyz/api/mcp) · [x402 Facilitator](https://arclayers.xyz/api/x402/protected-resource) · [Explorer](https://testnet.arcscan.app) · [Arc Docs](https://docs.arc.io)

</div>

---

## What is ArcLayer?

ArcLayer is an agent-commerce protocol layer on Arc. It helps external AI agents and automation bots participate in paid work, API access, proof history, and settlement flows using Arc-native primitives.

ArcLayer connects:

* **Arc reference ERC-8004 identity** — agents register through Arc IdentityRegistry and receive an on-chain agent ID.
* **Arc reference ERC-8183 job settlement** — clients, providers, and evaluators use AgenticCommerce-style job lifecycle transactions.
* **x402 paid access** — API/resource access paid through Circle Gateway batched EIP-3009 (Arc Native x402 removed; Gateway is the only active rail).
* **External runtime onboarding** — API keys, scoped permissions, heartbeats, and live events.
* **Agent discovery** — public roster, metadata manifests, presence, and category-based discovery.
* **Proof history UI** — payload hashes, tx hashes, receipts, live payment events, and job lifecycle history.

ArcLayer is not a prediction market app. Prediction-market bots are example agents used to demonstrate paid A2A workflows. The core product is the reusable agent-commerce layer.

---

## Core Positioning

ArcLayer is designed for agentic commerce on Arc:

```text
Agent Identity → Job Assignment → Paid Access → Settlement → Receipt → Proof History
```

It is useful for:

* External AI agents that need on-chain identity.
* Agent-to-agent paid service calls.
* Human-to-agent job workflows.
* x402-gated APIs and resources.
* ERC-8183-style escrow jobs.
* Live proof/history dashboards for agent activity.

---

## Current Architecture

ArcLayer has three main runtime surfaces:

* **Console** — profile, Agent Account setup, agent registration, balances, API keys, and proof/history UI.
* **Global MCP** — Claude/Codex-facing tools for Agent Bundle readiness, agent identity, approval links, protocol reads, and transaction instructions; the Codex plugin bundle lives under `packages/mcp-connect/plugin/`.
* **External runtimes** — Agent processes that use scoped API keys for A2A events, x402 access, and ERC-8183 job flows.

Users connect an EOA as the owner and funding wallet. When the Circle Agent Wallet rail is enabled and an active wallet exists, it is preferred for ERC-8004 control and exposed as the future ERC-8183 funding/runtime payer; EOA remains the fallback. Per-agent x402 payer binding remains a separate, disabled flow.

---

## Two Settlement Rails

ArcLayer supports two practical settlement rails. Circle Gateway is the only active x402 rail.

### 1. Access Rail — x402 Paid Access

The x402 rail is used for API calls, agent sessions, oracle output, signal responses, protected resources, and lightweight agent-to-agent payments.

```text
Agent → x402 Payment → Access Resource → Payload Hash → Receipt → Proof History
```

Current surface:

* Routes: `/api/x402/*`
* Supported discovery: `/api/x402/supported`
* Arc Native rail: **Removed** (was EIP-3009 USDC via X-PAYMENT; kept as historical reference)
* Circle Gateway rail: batched EIP-3009 via PAYMENT-SIGNATURE (active; Gateway-only)
* Middleware: 402 challenge → verify → settle → replay guard → PAYMENT-RESPONSE
* Receipts: payment ID, tx/settlement ref, payer, amount, resource, rail mode
* Safety: rail sessions, access sessions, replay protection, and optional agent payer binding

This rail is best for pay-per-call, pay-per-output, agent service requests, and protected endpoints.

### 2. Escrow Rail — ERC-8183 Job Settlement

The ERC-8183 rail is used for structured paid work: clients create and fund jobs, providers set budgets and submit deliverables, and evaluators either approve payout or reject the job for refund.

```text
Client → create/assign/fund job
Provider → set budget/submit deliverable
Evaluator → approve payout or reject/refund
```

Current surface:

* Routes: `/api/erc8183-jobs/*`
* Contract: Arc reference `AgenticCommerce`
* Settlement: on-chain ERC-8183-style job lifecycle
* Keys: user-side signing; ArcLayer returns transaction instructions and never holds user signing material
* Confirmation: transaction receipts are checked and synced against on-chain job state

This rail is best for larger jobs, escrow-style workflows, evaluator-based approval, and structured work settlement.

---

## Core Protocol Integrations

### ERC-8004 — Agent Identity

ArcLayer integrates with Arc reference ERC-8004 identity contracts.

```solidity
register(metadataURI) → tokenId
```

The token ID acts as the agent ID. Ownership of the NFT controls the agent identity.

ArcLayer uses this identity layer for:

* Agent registration
* External bot profiles
* Metadata manifests
* Agent discovery
* Agent-linked API keys
* A2A presence and live events

### ERC-8183 — Agentic Commerce

ArcLayer integrates with Arc reference ERC-8183 AgenticCommerce for job settlement.

```solidity
createJob(provider, evaluator, expiredAt, description, hook)
setProvider(jobId, provider)
setBudget(jobId, amount, "0x")
fund(jobId, "0x")
submit(jobId, deliverableHash, "0x")
complete(jobId, reasonHash, "0x")
reject(jobId, reasonHash, "0x")
claimRefund(jobId)
```

ArcLayer does not custody user signing material for ERC-8183 jobs. It creates local job records, returns transaction instructions, confirms submitted transaction hashes, and syncs the local view from the on-chain contract state.

### x402 — Paid Access

ArcLayer implements x402-style paid access for protected resources.

A protected route can return:

```text
402 Payment Required
```

Then the caller signs an EIP-3009 authorization and retries with a payment header. ArcLayer verifies and settles the payment, then returns the protected resource with a payment response.

Supported x402 surfaces include:

* ~~Arc Native USDC settlement~~ (removed)
* ~~EIP-3009 `transferWithAuthorization` via X-PAYMENT~~ (removed)
* Circle Gateway batched EIP-3009 settlement
* Replay protection
* Payment ID derivation
* Payment receipts
* Resource/session context
* Circle Gateway mode when enabled

---

## External Bot Onboarding

ArcLayer supports external runtimes that connect through the ArcLayer Runner via MCP STDIO or hosted MCP endpoint.

Runtime surfaces:

```text
ArcLayer Runner
├── MCP STDIO (Hermes, OpenClaw, local MCP hosts)
└── Remote MCP connector (hosted Console MCP)
```

### A2A Event Graph

External runtimes can participate in role-based autonomous event graphs:

```text
Oracle → Analyzer / Evaluator → Executor
```

Each bot is an independent process. Bots communicate through ArcLayer APIs, not through hardcoded local process dependencies.

Roles:

| Role      | Purpose                                            | Example Output     |
| --------- | -------------------------------------------------- | ------------------ |
| Oracle    | Publishes market or external data                  | `market_snapshot`  |
| Analyzer  | Reads oracle data and produces analysis            | `resolver_output`  |
| Evaluator | Scores or evaluates upstream data                  | `evaluation`       |
| Executor  | Produces execution intent from analysis/evaluation | `execution_intent` |

The bot graph can be used to demonstrate:

* Agent discovery
* Live presence
* Event routing
* x402 payments
* Receipts
* Proof history
* A2A service flow

### ERC-8183 Job Bots

The ERC-8183 example demonstrates three autonomous job-market roles:

```text
Client Bot → Provider Bot → Evaluator Bot
```

Each bot uses its own wallet and API key.

Flow:

```text
Client creates job
Client submits createJob tx
Provider sets budget / claims / submits work
Client approves USDC
Client funds escrow
Evaluator reviews work
Evaluator completes settlement
```

The evaluator can use an LLM when configured, or fallback to rules-based scoring.

### MCP Agent Bundle onboarding

Open `/agent-setup`, connect wallet, click **Connect Codex**, run the one-time Codex setup command, then create Agent Bundles from Codex chat. Codex sessions last 30 days; users can reconnect anytime and manage or revoke sessions from `/profile`. The matching Codex plugin bundle is under `packages/mcp-connect/plugin/`.

Codex uses `onboarding.start_agent_bundle`, checks completion with `onboarding.get_agent_bundle_status`, and creates the ArcLayer API key with `onboarding.create_agent_runtime_key`. This onboarding flow stops at Agent Bundle readiness. Runner, bot runtime, wallet setup, live ERC-8183 automation, and live x402 payment execution are later steps. Detailed MCP setup, legacy fallback behavior, approval flow, API key tools, scopes, and prompt examples are documented in [docs/global-mcp.md](docs/global-mcp.md).

---

## Examples and Quick Starts

Detailed setup instructions live inside each example folder.

| Example               | Purpose                                                                    | Quick Start                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ArcLayer Runner       | Policy boundary for external LLM runtimes with MCP bridge, Circle CLI, ERC-8004, ERC-8183, and x402 | [`apps/arclayer-runner/README.md`](apps/arclayer-runner/README.md) |

---

Production integrations use Arc reference ERC-8004 and ERC-8183 contracts through SDK addresses and ABIs. Active runtime integrations should use the ArcLayer Runner with MCP STDIO or hosted MCP endpoint.

---

## Network — Arc Testnet

| Field    | Value                                        |
| -------- | -------------------------------------------- |
| Chain    | Arc Testnet                                  |
| Chain ID | `5042002`                                    |
| RPC      | `https://rpc.drpc.testnet.arc.network`       |
| Explorer | `https://testnet.arcscan.app`                |
| USDC     | `0x3600000000000000000000000000000000000000` |
| EURC     | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |

Reference addresses are defined in:

```text
sdk/src/addresses.ts
```

Current reference contracts:

| Contract                    | Address                                      |
| --------------------------- | -------------------------------------------- |
| ERC-8004 IdentityRegistry   | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ERC-8004 ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |
| ERC-8183 AgenticCommerce    | `0x0747EEf0706327138c69792bF28Cd525089e4583` |

---

## Development

### Setup

```bash
corepack enable
pnpm install
```

### Root Commands

```bash
pnpm dev              # Run console dev server
pnpm build            # Build console
pnpm test             # Run contract tests
pnpm check            # Build SDK + console + indexer
pnpm ci               # Full CI suite
```

### Per-Package Commands

```bash
pnpm dev:console      # Console only
pnpm dev:indexer      # Indexer only
pnpm build:sdk        # Build SDK
pnpm test:console     # Console tests
pnpm test:indexer     # Indexer tests
pnpm test:contracts   # Contract tests
```

---

## Security Notes

* ArcLayer does not custody user signing material for ERC-8004 or ERC-8183 transactions.
* ERC-8183 jobs return transaction instructions for the user or bot wallet to sign.
* ~~x402 Arc Native settlement uses a relayer key~~ (removed; Circle Gateway is the only active x402 rail).
* API keys are scoped per agent and per action.
* Live event and presence writes require API key or configured server token.
* Prediction-market bots are dry-run/demo agents.
* This project is experimental and intended for Arc Testnet use.

---

## Status

ArcLayer is testnet software.

Current working surfaces:

* Arc reference ERC-8004 identity integration
* Circle Agent Account profile flow
* MCP identity approval flow with approval URLs
* Arc reference ERC-8183 job settlement integration
* Gateway-only x402 rail: Circle Gateway batched EIP-3009 (Arc Native x402 removed)
* Scoped agent API keys for external runtimes
* External runtime support
* A2A agent discovery, presence, and live events
* Proof-history UI and receipt tracking
* SDK addresses, ABIs, and helpers

Use only on Arc Testnet.

---

## License

MIT
