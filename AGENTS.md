# AGENTS.md

This file is the operating guide for AI coding agents working on ArcLayer.

ArcLayer is an Arc/Circle reference-first protocol layer for the agentic economy. It connects external AI agents, MCP clients, and agent-facing applications to Arc Testnet identity, paid jobs, x402 payments, receipts, and proof-history workflows.

ArcLayer is infrastructure. It is not a prediction market app, not a trading bot, and not a private-key custody service.

## Core rule

Do not invent protocol addresses, token addresses, contract ABIs, job flows, payment rails, or new standards.

Use the existing Arc/Circle reference surfaces already wired in this repository.

The canonical source of truth for Arc Testnet constants is:

```txt
sdk/src/addresses.ts
```

The canonical source of truth for exported SDK helpers is:

```txt
sdk/src/index.ts
```

The canonical source of truth for write transaction builders is:

```txt
sdk/src/writes.ts
```

## Repository structure

```txt
.
├── apps/
│   └── console/                  # Next.js app, UI, API routes, MCP, x402, vault, runtime APIs
├── docs/                         # Protocol docs, MCP docs, integration notes
├── indexer/                      # Node indexer for Arc reference events and projection APIs
├── sdk/                          # Shared SDK: addresses, ABIs, chain config, tx builders, types
├── supabase/
│   └── migrations/                # Database migrations
├── AGENTS.md
├── README.md
├── package.json
└── pnpm-workspace.yaml
```

If a script references a folder that is not present in the current tree, do not recreate that folder blindly. First align the script, docs, and actual runtime surface.

## Platform-level Agent Behavior

The canonical platform-level behavior policy for agents lives at:

`docs/ARCLAYER_GLOBAL_AGENT_SKILL.md`

Packaged plugin mirror:

`packages/mcp-connect/plugin/skills/arclayer-global-agent-commerce/SKILL.md`

Use this policy for ERC-8004, ERC-8183, x402, MCP, Circle Gateway, Circle Agent Wallet/CLI, Runner, Hermes, OpenClaw, receipts, and proof history.

## Runtime surfaces

ArcLayer has five main runtime surfaces:

1. Console web app

   * Path: `apps/console`
   * Next.js app router
   * Handles wallet connection, agent registration UX, job UX, proof/history UI, live A2A UI, and docs UI.

2. API routes

   * Path: `apps/console/src/app/api`
   * Handles x402 routes, MCP endpoint, A2A runtime APIs, rail preferences, vault/session APIs, indexer proxy, and job-related APIs.

3. SDK

   * Path: `sdk`
   * Exposes constants, ABIs, chain config, clients, types, Arc reference helpers, A2A helpers, and transaction config builders.
   * All protocol write helpers should be added here first when reusable.

4. Indexer

   * Path: `indexer`
   * Reads Arc reference ERC-8004, ERC-8183, and reputation events.
   * Maintains local projections for agents, jobs, proofs, reputation, and overview endpoints.
   * Must stay attribution-filtered in production.

5. ArcLayer Runner

   * Path: `apps/arclayer-runner`
   * Policy boundary for external LLM runtimes with MCP bridge, Circle CLI, ERC-8004, ERC-8183, and x402.
   * Connects via MCP STDIO (Hermes, OpenClaw) or remote MCP connector (hosted Console MCP).

## Protocol positioning

ArcLayer supports this protocol path:

```txt
Agent Identity -> Job Assignment -> Paid Access -> Settlement -> Receipt -> Proof History
```

Supported standards/surfaces:

```txt
ERC-8004 identity
ERC-8004 reputation
ERC-8004 validation
ERC-8183 agentic job settlement
x402 paid access
Circle Gateway batched EIP-3009
Arc Native EIP-3009
External runtime support
Global MCP tooling
Proof/history UI
```

Do not describe ArcLayer as a trading strategy product. Prediction-market bots or market-data bots are example agents only.

## Arc Testnet constants

Use the SDK constants. Do not duplicate these values outside SDK unless the code is a display-only read from the SDK.

Current canonical values live in:

```txt
sdk/src/addresses.ts
```

Important constants:

```txt
ARC_CHAIN_ID = 5042002
ARC_EXPLORER = https://testnet.arcscan.app
USDC = 0x3600000000000000000000000000000000000000
EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
ERC8004_IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e
ERC8004_REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713
ERC8004_VALIDATION_REGISTRY = 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
ERC8183_AGENTIC_COMMERCE = 0x0747EEf0706327138c69792bF28Cd525089e4583
```

## ERC-8004 identity rules

Canonical registration flow:

```txt
register(metadataURI) -> tokenId
```

The ERC-8004 token ID is the agent ID.

When building identity registration:

* Use `buildRegisterAgentConfig(metadataURI)` from `sdk/src/writes.ts`.
* Do not create a custom registry contract.
* Do not mint local-only fake identity as the canonical identity.
* Do not store private keys.
* Treat metadata URI as the long-lived public agent descriptor.
* Ownership/controller semantics must follow the Arc reference IdentityRegistry.

For MCP identity registration:

* Use the hosted MCP flow.
* Return unsigned transaction instructions or approval URLs.
* Signing/execution happens in the user's wallet/Circle passkey flow.
* Never ask for private keys.

## ERC-8183 job settlement rules

Canonical ERC-8183 job lifecycle:

```txt
createJob(provider, evaluator, expiredAt, description, hook)
setBudget(jobId, amount, "0x")
USDC approve(AgenticCommerce, amount)
fund(jobId, "0x")
submit(jobId, deliverableHash, "0x")
complete(jobId, reasonHash, "0x")
```

Use SDK helpers:

```txt
buildCreateJobConfig
buildSetBudgetConfig
buildApproveUsdcConfig
buildFundJobConfig
buildSubmitDeliverableConfig
buildCompleteJobConfig
```

Rules:

* The runtime contract target is `CONTRACTS.ERC8183_AGENTIC_COMMERCE`.
* Treat it as the only runtime target for reads, writes, and event listeners.
* Do not call a separate implementation address directly.
* Do not replace ERC-8183 with a custom escrow unless the user explicitly asks for a new experimental flow.
* For larger jobs, use ERC-8183 escrow/job lifecycle.
* For lightweight API/resource access, use x402.

## x402 payment rules

ArcLayer supports two practical payment rails:

```txt
Arc Native EIP-3009
Circle Gateway batched EIP-3009
```

Use x402 for:

* protected API access
* pay-per-call resources
* oracle/signal/output requests
* lightweight A2A service calls
* protected resource unlocks
* agent session access

Do not use x402 as a replacement for formal ERC-8183 escrow jobs unless the task is explicitly a lightweight paid access/session task.

Important rules:

* `payTo` must come from environment configuration such as `X402_RECEIVER_ADDRESS` or `X402_PAY_TO`.
* Never hardcode a receiver wallet in production code.
* Preserve replay protection.
* Preserve payment ID derivation.
* Preserve rail/session binding where it already exists.
* Preserve `PAYMENT-RESPONSE` behavior for successful protected access.
* Keep Arc Native and Circle Gateway behavior separate and explicit.

## MCP rules

Main MCP endpoint:

```txt
apps/console/src/app/api/mcp
```

Core MCP implementation:

```txt
apps/console/src/lib/mcp
```

MCP documentation:

```txt
docs/global-mcp.md
```

Security rules:

* MCP must never ask for private keys.
* MCP must never sign transactions.
* MCP must never broadcast transactions unless a dedicated approved executor flow already exists.
* MCP must never expose `process.env`.
* MCP must never execute arbitrary shell commands.
* MCP must never proxy arbitrary URLs.
* Transaction tools should return unsigned instructions, calldata, or approval URLs.

When adding MCP tools:

* Register tools through the existing registry pattern.
* Prefer canonical names like `domain.action`.
* Add legacy aliases only when needed for backward compatibility.
* Validate all inputs.
* Return structured JSON.
* Redact sensitive errors.
* Document new tools in `docs/global-mcp.md`.

## Indexer rules

Indexer path:

```txt
indexer
```

The indexer reads and projects:

```txt
ERC-8004 identity events
ERC-8004 reputation events
ERC-8183 job events
A2A lifecycle/proof data
```

Rules:

* Keep production attribution filters active.
* Do not index all global Arc reference events in production without filters.
* Preserve independent cursors for jobs, agents, and reputation.
* Preserve public-safe error redaction.
* Do not expose private Supabase credentials or raw server errors.
* Keep `/health` useful for debugging sync status.
* Keep `/agents`, `/jobs`, `/proofs`, `/overview`, and `/reputation` stable for console and MCP consumers.

## Console app rules

Console path:

```txt
apps/console
```

Use it for:

* user-facing protocol UI
* agent registration
* job creation/funding/settlement UI
* x402 demo/protected access UI
* A2A discovery and live events
* proof/history display
* MCP approval UX
* wallet/passkey flows

Rules:

* Prefer server-side code for secrets.
* Use `server-only` patterns where applicable.
* Do not expose env secrets to client components.
* Keep UI copy clear that ArcLayer is infrastructure/protocol, not a trading product.
* Keep prediction-market content framed as demo agent data, not investment advice.
* Avoid polling too aggressively. Pause or reduce polling when the document is hidden.
* Do not break existing dark UI readability.

## External runtime rules

External runtimes connect through ArcLayer Runner via MCP STDIO or hosted MCP endpoint.

Rules:

* External bots should use scoped API keys.
* Bots should use role-scoped permissions.
* Bots should heartbeat.
* Bots should write checkpoints/resume state where supported.
* Bots should interact through ArcLayer APIs/MCP/SDK, not through manual local database edits.
* Bots should use separate wallets when testing real multi-agent accounting.
* Shared payer is acceptable for MVP/platform-managed agents, but do not hardcode that assumption.

## API key and vault/session rules

When touching API keys, vault, runtime secrets, or session tools:

* Do not log secrets.
* Do not return full secret values after creation unless the current flow already requires one-time reveal.
* Redact tokens in errors and logs.
* Scope permissions narrowly.
* Prefer revocation over deletion when audit history matters.
* Keep key ownership bound to wallet/session/agent context.

## Database and Supabase rules

Supabase migrations live in:

```txt
supabase/migrations
```

Rules:

* Add migrations instead of mutating historical migrations.
* Keep schema changes backward-compatible where possible.
* Do not store raw private keys.
* Do not expose service-role keys to frontend.
* Keep local records synced with on-chain state; do not present local state as final when on-chain confirmation is missing.

## Coding standards

General:

* TypeScript first.
* Keep domain logic in `src/lib` or `sdk`, not buried inside UI components.
* Keep API route handlers thin when possible.
* Validate external inputs.
* Return structured errors.
* Preserve idempotency for payment/job/runtime operations.
* Avoid broad `any` unless boundary parsing requires it.
* Keep public API response shapes stable.

For SDK:

* Export reusable helpers from `sdk/src/index.ts`.
* Do not add app-specific dependencies to SDK.
* Keep SDK chain/ABI/address logic framework-neutral.

For UI:

* Do not hardcode protocol constants in components.
* Use SDK/config helpers.
* Keep copy concise.
* Preserve accessibility and readable contrast.

For tests:

* Add or update tests when changing payment verification, settlement, replay protection, MCP tools, indexer projections, or runtime API state transitions.
* Prefer deterministic tests for state-machine logic.
* Do not rely on live private credentials in tests.

## Commands

Install:

```bash
corepack enable
pnpm install
```

Run console:

```bash
pnpm dev
```

Build console:

```bash
pnpm build
```

Build SDK:

```bash
pnpm build:sdk
```

Build indexer as part of root check:

```bash
pnpm check
```

Run full CI:

```bash
pnpm ci
```

If a command references a missing folder, do not patch by inventing new protocol code. Fix the script or restore the intended folder only after confirming the current repo structure.

## Environment rules

Use `.env.example` as the template.

Never commit:

```txt
private keys
mnemonics
Circle API secrets
Supabase service role keys
Pinata/JWT secrets
wallet secrets
production bearer tokens
runtime API keys
```

For x402 receiver/pay-to configuration, use environment variables.

For RPC configuration, prefer configured env RPC first, then safe public fallback.

## Do not do

Do not:

* invent new deployed contract addresses
* replace Arc reference ERC-8004/ ERC-8183 with fake local contracts
* call ERC-8183 implementation contracts directly
* hardcode production payment receiver addresses
* bypass x402 replay protection
* bypass rail/session enforcement
* expose private keys or env secrets
* add broad unauthenticated write endpoints
* turn prediction-market examples into the core product narrative
* make indexer production mode scan unrelated global events without filters
* create new folders or package entries just because stale scripts reference them

## Preferred implementation approach

When implementing a change:

1. Identify the relevant surface:

   * UI: `apps/console/src/app` or `apps/console/src/components`
   * API: `apps/console/src/app/api`
   * domain logic: `apps/console/src/lib`
   * protocol constants/helpers: `sdk/src`
   * indexing/projections: `indexer/src`
   * runner: `apps/arclayer-runner`
   * docs: `docs`

2. Reuse existing SDK constants and helpers.

3. Preserve current Arc/Circle reference flows.

4. Add validation and error redaction.

5. Update docs if behavior changes.

6. Run the narrowest relevant check first, then the broader check.

## Product narrative

Use this positioning when writing docs or UI copy:

```txt
ArcLayer is a protocol layer for agentic commerce on Arc. It lets external AI agents create on-chain identities, access paid resources, execute structured jobs, settle with USDC, and build verifiable proof/history.
```

Avoid this positioning:

```txt
ArcLayer is a prediction market bot.
ArcLayer is a trading strategy.
ArcLayer is a private-key managed agent wallet.
ArcLayer is a custom escrow replacing Arc reference standards.
```

Prediction-market agents, oracle agents, analyzer agents, evaluator agents, and executor agents are examples that demonstrate paid A2A workflows. The reusable product is the agent-commerce protocol layer.
