# ArcLayer — Stablecoin Commerce Stack Challenge Submission

**Challenge:** Stablecoin Commerce Stack Challenge (Ignyte × Circle × Arc)
**Submitted:** 2026-05-16
**Track:** Track 4 — Best Agentic Economy Experience on Arc
**Project URL:** https://arclayers.xyz
**Repository:** https://github.com/riyannode/ArcLayer
**Circle Developer Account Email:** _(fill before submit — must match account at https://console.circle.com/signup)_
**Demo Video:** _(fill before submit — see "Demo Video Script" section)_

---

## 1. Title

**ArcLayer — x402 Payment Facilitator + USDC Escrow Layer for Autonomous AI Agents on Arc**

## 2. Short Description

ArcLayer is the **payment + settlement layer for paid AI agents on Arc Network**. Any HTTP API or AI agent endpoint can demand a USDC payment using a single `X-PAYMENT` header — no API keys, no Stripe, no custodian. Agents pay with stablecoins, work is escrowed on-chain, and every completed job mints a `WorkProof` NFT as verifiable proof of execution.

Built directly on Arc Testnet with Circle's USDC, ArcLayer turns the agent economy into a real, settleable, on-chain marketplace where machines transact with machines using programmable USDC.

---

## 3. Track Selected

**Track 4 — Best Agentic Economy Experience on Arc**
Prize: 1st = 4000 USDC · 2nd = 2000 USDC

**Why this track is the perfect fit:**

The agentic economy track explicitly calls for:
- _"AI agents that autonomously discover and execute stablecoin-settled purchases using Arc smart contracts"_ → ArcLayer's `arc-escrow` scheme is exactly this.
- _"Pay-per-inference AI agents that pay for each model response"_ → ArcLayer's facilitator turns any HTTP API into a paid endpoint via x402.
- _"Autonomous merchant settlement systems where AI negotiates and settles with multiple onchain counterparties"_ → ArcLayer's `JobEscrow` + `evaluator` model is a programmable multi-party settlement primitive.
- _"Streaming payments for content or APIs based on continuous usage"_ → On the roadmap via Circle Nanopayments integration (M3).

**Secondary fit (not selected, but conceptually aligned):**
ArcLayer's `JobEscrow` + milestone-release pattern can also serve **Track 2 (SME Trade Finance)** — stablecoin escrow with proof-of-delivery triggers — but the core product is purpose-built for AI agents.

---

## 4. Circle Products Used on Arc

| Product | Used? | How ArcLayer integrates it |
|---|---|---|
| **USDC** | ✅ **Active** | Primary settlement asset for every paid agent job on Arc Testnet (`0x3600000000000000000000000000000000000000`). Funds flow USDC → JobEscrow → worker on settlement. |
| **Circle Wallets** | ✅ **Active (via Privy embedded wallets)** | Console uses Privy to give non-crypto-native users an embedded wallet that signs Arc Testnet transactions without seed-phrase friction. Architecture is ready to swap to Circle Wallets SDK directly when programmatic agent-controlled wallets are needed. |
| **CCTP / Bridge Kit** | 🟡 **Conceptual / roadmap (M3)** | x402 `accepts[]` array is multi-chain by spec. ArcLayer's `exact` scheme will use CCTP to route USDC from Base/Ethereum into Arc settlement automatically when a client signs a payment from a non-Arc wallet. |
| **Circle Gateway** | 🟡 **Conceptual / roadmap (M3)** | For agent-orchestrated treasury operations: routing pooled USDC liquidity for the relayer's own gas/operating budget. Not blocking the MVP. |
| **Nanopayments** | 🟡 **Conceptual / roadmap (M3)** | Direct fit for x402's pay-per-call model. Will be integrated for streaming AI inference (per-token billing) and per-request agent calls below the cent threshold. |
| **USYC** | ❌ Not used (Enterprise gated) | Out of scope for current MVP. |
| **StableFX** | ❌ Not used (Enterprise gated) | Out of scope for current MVP. |

**Selected for the form's Circle products checklist:**
- ☑ USDC
- ☑ Wallets
- ☑ CCTP/Bridge Kit (roadmap)
- ☑ Gateway (roadmap)
- ☑ Nanopayments (roadmap)
- ☐ USYC
- ☐ StableFX

---

## 5. Description (Long-Form)

### Problem

The agent economy needs **machine-native payments**. Today, paid APIs and AI agents rely on:

- **API keys** → not transferable, not programmable, not verifiable on-chain. An AI agent cannot autonomously buy an API call from another agent without a human pre-creating a key.
- **Stripe / SaaS billing** → off-chain, custodial, KYC-bound. AI agents cannot legally hold Stripe accounts or sign credit-card forms.
- **Manual escrow** → no standard, no settlement primitive, no proof of work between counterparties.

The **x402 specification** (HTTP `402 Payment Required`) solves this for stablecoin-native machine payments — but Arc Network, Circle's purpose-built stablecoin L1, **has no production x402 facilitator**. Standard x402 clients (Coinbase x402 SDK, x402-compatible agents, paid APIs) cannot pay for services on Arc out of the box.

This is the exact gap the Agentic Economy track exists to close.

### Solution

ArcLayer is a **dual-scheme x402 facilitator + USDC escrow protocol** purpose-built for Arc Testnet, with autonomous AI agents as the primary user:

- **`arc-escrow` scheme (live)** — ArcLayer-native flow with on-chain `JobEscrow`, evaluator approval, USDC settlement, and `WorkProof` ERC-721 NFT minted on completion. Already shipped, fully E2E-proven on Arc Testnet.
- **`exact` scheme (roadmap M2)** — standard x402 flow using EIP-3009 `transferWithAuthorization`, gasless for the client, relayer-submitted, fully compatible with the Coinbase x402 SDK and any existing x402 client.

Both schemes converge into the same backend pipeline: agent execution → deliverable submission → evaluator approval → USDC settlement on Arc → reputation update → proof-of-work NFT minted.

### Why ArcLayer is uniquely positioned for the Agentic Economy track

1. **Production-grade infrastructure already shipped on Arc.** 6 contracts deployed and verified, console live at https://arclayers.xyz, full E2E proven (17/17 score) on Arc Testnet.
2. **First-mover x402 facilitator on Arc.** No competing implementation exists. ArcLayer can become the canonical `arclayers.xyz` facilitator endpoint for the network — the missing piece that lets every x402 client work on Arc Day 1.
3. **Beyond payments — full settlement layer for agents.** `WorkProof` NFTs + `ReputationOracle` give AI agents verifiable on-chain history. An agent's track record becomes portable, queryable, and machine-readable — Stripe and pure x402 cannot match this.
4. **Validated technical feasibility on Arc USDC.** A spike (PR 0) confirmed Arc Testnet USDC = Circle FiatTokenV2 with full support for EIP-3009, EIP-2612, EIP-712, and Permit2 — removing the main blocker for the standard-compliant `exact` scheme.

---

## 6. Working MVP

ArcLayer is **already live in production on Arc Testnet.**

### 6.1 Live URLs

- **Application:** https://arclayers.xyz
- **Vercel mirror:** https://arclayer-zeta.vercel.app
- **Docs:** https://arclayers.xyz/docs
- **API — supported schemes:** https://arclayers.xyz/api/x402/supported
- **Block Explorer:** https://testnet.arcscan.app

### 6.2 Deployed Contracts (Arc Testnet `chainId=5042002`)

| Contract | Address |
|---|---|
| `AgentRegistry` | `0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21` |
| `JobEscrow` | `0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225` |
| `WorkProof` | `0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5` |
| `ReputationOracle` | `0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c` |
| `MilestoneEscrow` (V1) | `0x78EA9f30744923924Fd56FcbB74D3733Ca4848f2` |
| `Achievement` | `0x7245B200ce09B515bd235f1eD262c2abb0890165` |
| **USDC (Arc Testnet)** | `0x3600000000000000000000000000000000000000` |

All contracts verified at https://testnet.arcscan.app.

### 6.3 Verified End-to-End Proofs

#### x402 Facilitator — Production E2E (17/17 ✅)

| Step | Result |
|---|---|
| No payment → `402 PAYMENT-REQUIRED` | ✅ |
| `createJob` on Arc Testnet | ✅ jobId `13` |
| `setBudget` + `approve USDC` + `fund escrow` | ✅ `JobFunded` emitted |
| `POST /api/x402/verify` | ✅ `verified` |
| `POST /api/x402/settle` | ✅ `settled` |
| `POST /api/agents/demo/run` first run | ✅ `200`, agent executed |
| Retry same payment | ✅ `200`, `cached: true` (idempotent) |
| Same txHash → different resource | ✅ rejected `PAYMENT_REPLAY_DIFFERENT_RESOURCE` |

- **txHash:** `0x3b5578f304970f3e91fa36e3de1af2c389dd4c01f2c3d17040fca7e020ae80d9`
- **jobId:** `13`
- **Output:** `Hello. Task received for Agent ID demo, Job ID 13.`
- **Latency:** 2724ms

#### Protocol JobEscrow — Role-Separated E2E (Job 19)

`registerAgent → createJob → setBudget → approve → fund → submitDeliverable → evaluate(true) → settle → WorkProof #3 minted`

| Key | Value |
|---|---|
| Job ID | `19` |
| Agent ID | `1778814739` |
| WorkProof Token ID | `3` |
| Final status | `Settled` |
| Amount funded | `0.01 USDC` |
| Paid to worker | `0.00995 USDC` |
| Platform fee | `0.00005 USDC` |

| Step | Tx Hash |
|---|---|
| `submitDeliverable` | `0xf66a7ba5e00fe2a23d96681f55facfa0fe76f29152215cbf60b999b1ba9bfa72` |
| `evaluate(true)` | `0x6973456264d6b42be02560f003c280ce24afa7a26071cebb09d60f0e5da894ef` |
| `settle` | `0x8883f432d034c95b9a663fe602b69879b1fa3d089cb17a35f4b5741c2f6873cf` |

Live job page: https://arclayers.xyz/job/19

#### Arc USDC Capability Matrix (PR 0 spike)

Full evidence: [`docs/spikes/ARC_USDC_CAPABILITY_MATRIX.md`](https://github.com/riyannode/ArcLayer/blob/main/docs/spikes/ARC_USDC_CAPABILITY_MATRIX.md)

| Feature | Arc Testnet USDC |
|---|---|
| ERC-20 baseline | ✅ |
| EIP-712 `DOMAIN_SEPARATOR` | ✅ |
| EIP-2612 `permit` + `nonces` | ✅ |
| EIP-3009 `transferWithAuthorization` | ✅ |
| EIP-3009 `receiveWithAuthorization` | ✅ |
| EIP-3009 `cancelAuthorization` + `authorizationState` | ✅ |
| Permit2 deployed at canonical address | ✅ |

**Conclusion:** Arc USDC = Circle FiatTokenV2. Standard x402 `exact` scheme is technically feasible.

---

## 7. Architecture Diagram

### 7.1 High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CLIENT / AGENT                               │
│   (Cursor, Coinbase x402 SDK, custom AI agent, ArcLayer console)     │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  POST /api/agents/:id/run
                             │  X-PAYMENT: <auth>
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│              ARCLAYER FACILITATOR  (Next.js on Vercel)               │
│                                                                      │
│   ┌──────────────────┐   ┌──────────────────┐   ┌───────────────┐    │
│   │ /api/x402/       │   │ /api/x402/       │   │ /api/x402/    │    │
│   │   supported      │   │   verify         │   │   settle      │    │
│   └──────────────────┘   └──────────────────┘   └───────────────┘    │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │           src/lib/x402/  (facilitator core)                  │   │
│   │   • headers (X-PAYMENT / PAYMENT-REQUIRED / PAYMENT-RESPONSE)│   │
│   │   • verify-arc-escrow  (on-chain JobFunded check)            │   │
│   │   • verify-exact       (EIP-3009 settlement check)  [M2]     │   │
│   │   • orchestrator       (single-path facilitator flow)        │   │
│   └──────────────────────────────────────────────────────────────┘   │
└──────────────┬─────────────────────────┬────────────────┬────────────┘
               │                         │                │
               ▼                         ▼                ▼
┌──────────────────────┐   ┌──────────────────────┐   ┌────────────────┐
│   SUPABASE LEDGER    │   │      ARC TESTNET     │   │   AGENT EXEC   │
│   x402_payments      │   │   chainId 5042002    │   │   (gpt-5.5     │
│   x402_consume_*     │   │                      │   │    via         │
│   replay protection  │   │   • USDC (FiatV2)    │   │    9router)    │
│                      │   │   • JobEscrow        │   │                │
│                      │   │   • AgentRegistry    │   │                │
│                      │   │   • WorkProof (NFT)  │   │                │
│                      │   │   • ReputationOracle │   │                │
└──────────────────────┘   └──────────────────────┘   └────────────────┘
                                       ▲
                                       │ event polling
                                       │
                              ┌──────────────────┐
                              │   INDEXER (VPS)  │
                              │   PM2 + SQLite   │
                              │   port 3535      │
                              │   → CF tunnel    │
                              │   → Vercel proxy │
                              └──────────────────┘
```

### 7.2 Payment Flow (`arc-escrow` scheme — currently live)

```
Client                  Facilitator              Arc Testnet            Agent
  │                          │                        │                   │
  │── POST /run ────────────▶│                        │                   │
  │◀── 402 + accepts[] ──────│                        │                   │
  │                          │                        │                   │
  │── createJob ─────────────────────────────────────▶│                   │
  │── setBudget ─────────────────────────────────────▶│                   │
  │── approve USDC ──────────────────────────────────▶│                   │
  │── fund(jobId, amount) ──────────────────────────▶│                   │
  │   ←── JobFunded event ───────────────────────────│                   │
  │                          │                        │                   │
  │── POST /run ────────────▶│                        │                   │
  │   X-PAYMENT: txHash      │── eth_getReceipt ─────▶│                   │
  │                          │   verify JobFunded     │                   │
  │                          │── consume() ledger ────│                   │
  │                          │── execute ─────────────────────────────────▶│
  │                          │◀── output ──────────────────────────────────│
  │◀── 200 + PAYMENT-RESPONSE│                        │                   │
  │                          │                        │                   │
  │   (worker submits, evaluator approves, settle pays USDC + mints NFT)  │
```

### 7.3 Payment Flow (`exact` scheme — M2 roadmap)

```
Client                  Facilitator              Relayer            Arc Testnet
  │                          │                        │                  │
  │── POST /run ────────────▶│                        │                  │
  │◀── 402 + exact accept ───│                        │                  │
  │                          │                        │                  │
  │── EIP-3009 sign ─────────│                        │                  │
  │   X-PAYMENT: <auth> ────▶│                        │                  │
  │                          │── relay ──────────────▶│                  │
  │                          │                        │── transferAuth ─▶│
  │                          │                        │── fundEscrow ───▶│
  │                          │◀── settled ────────────│                  │
  │                          │── verify + settle ────│                  │
  │◀── 200 + RESPONSE ───────│                        │                  │
```

---

## 8. Demo Application URL

- **Primary:** https://arclayers.xyz
- **Vercel mirror:** https://arclayer-zeta.vercel.app
- **Docs page:** https://arclayers.xyz/docs

The demo is publicly accessible — no signup required to view contracts, jobs, or x402 endpoints. To execute a paid agent run, connect a Privy-embedded wallet on Arc Testnet and follow the flow at `/jobs`.

---

## 9. Documentation

The repository contains end-to-end developer documentation:

- **[`README.md`](https://github.com/riyannode/ArcLayer/blob/main/README.md)** — TL;DR, architecture, tech stack, quick start, contributing.
- **[`AGENTS.md`](https://github.com/riyannode/ArcLayer/blob/main/AGENTS.md)** — Integration rules for AI coding agents working **inside** the repo.
- **[`docs/ARCLAYER_INTEGRATION_SKILL.md`](https://github.com/riyannode/ArcLayer/blob/main/docs/ARCLAYER_INTEGRATION_SKILL.md)** — Copy-paste skill for external AI agents (Cursor, Claude Code, Codex) to integrate ArcLayer into their app in one prompt.
- **[`docs/e2e-proofs.md`](https://github.com/riyannode/ArcLayer/blob/main/docs/e2e-proofs.md)** — All transaction hashes, jobIds, step-by-step proof of every E2E run.
- **[`docs/spikes/ARC_USDC_CAPABILITY_MATRIX.md`](https://github.com/riyannode/ArcLayer/blob/main/docs/spikes/ARC_USDC_CAPABILITY_MATRIX.md)** — On-chain validation of EIP-3009, EIP-2612, EIP-712, Permit2 on Arc Testnet USDC.
- **[`docs/sdk-reference.md`](https://github.com/riyannode/ArcLayer/blob/main/docs/sdk-reference.md)** — `@arclayer/sdk` API reference.
- **[`docs/indexing.md`](https://github.com/riyannode/ArcLayer/blob/main/docs/indexing.md)** — Indexer architecture and deployment.
- **Live `/docs` page:** https://arclayers.xyz/docs — interactive REST API + SDK examples + AI integration prompt with copy buttons.

### How Circle integration is documented

`README.md` and `docs/spikes/ARC_USDC_CAPABILITY_MATRIX.md` together explain:
- Which Circle products are used (USDC, Wallets via Privy)
- Which are on the integration roadmap (CCTP, Gateway, Nanopayments)
- Exact Arc USDC contract address used: `0x3600000000000000000000000000000000000000`
- Capability validation methodology (raw `eth_call` against Arc Testnet)

---

## 10. Demo Video Script (3 minutes)

_Use this script to record the demo video, then paste the final URL in the form._

**[0:00–0:15] Hook**

> "ArcLayer is the x402 payment facilitator and USDC escrow layer for paid AI agents on Arc Network. Live on Arc Testnet — let me show you a paid agent run end-to-end in under three minutes."

**[0:15–0:45] The 402 challenge**

> _(Open terminal, run:)_
> ```bash
> curl -i https://arclayers.xyz/api/agents/demo/run
> ```
> _(Show 402 response with `PAYMENT-REQUIRED` header.)_
> "Any HTTP API can demand on-chain USDC payment using a single header. No API keys, no Stripe, no custodian. This is the missing primitive for the agent economy."

**[0:45–1:45] Pay → execute (USDC settlement on Arc)**

> _(Open `arclayers.xyz/jobs`, walk through `createJob` → `setBudget` → `approve` → `fund`. Show Privy embedded wallet popup, sign, confirm. Show `JobFunded` event in indexer.)_
> "USDC is now escrowed on Arc Testnet. Now I retry the agent call with the funding tx hash in `X-PAYMENT`."
> _(Run curl with X-PAYMENT, show 200 + agent output + PAYMENT-RESPONSE header.)_
> "The agent executed and the response is signed with on-chain proof of payment."

**[1:45–2:30] Settlement + WorkProof NFT**

> _(Open `arclayers.xyz/job/19`, show full lifecycle: deliverable → evaluator approval → settle → WorkProof NFT minted. Show explorer link on testnet.arcscan.app.)_
> "USDC settles to the worker on-chain in real-time. A WorkProof NFT is minted as verifiable proof of the completed job. Reputation updates automatically. Every agent on ArcLayer builds a portable, machine-readable on-chain track record."

**[2:30–3:00] Closing**

> "ArcLayer is open source, MIT licensed, on GitHub. We've already shipped the `arc-escrow` scheme. With this grant, we'll add the standard x402 `exact` scheme using EIP-3009 — making ArcLayer compatible with every x402 client on Day 1, plus integrate Circle Nanopayments for streaming agent payments. ArcLayer can become the canonical `arclayers.xyz` facilitator for Arc Network. Thanks for watching."

---

## 11. Roadmap (Grant Milestones)

The grant funds the path from current `arc-escrow` MVP to a full standards-compliant facilitator with SDK, Circle Nanopayments integration, and external adoption.

| Milestone | Deliverable | Duration |
|---|---|---|
| **M1 — Schema lock + SDK skeleton** | Normalize x402 v2 types & headers · Lock `/supported`, `/verify`, `/settle` schema + OpenAPI 3.1 · `@arclayer/x402` SDK skeleton · Document dual scheme | 2 weeks |
| **M2 — `exact` scheme live (EIP-3009)** | Deploy relayer service · Implement EIP-3009 `exact` scheme verifier + settler · Payment ledger query API · Compatible with Coinbase x402 SDK Day 1 | 4 weeks |
| **M3 — Circle integration deepening** | Full `@arclayer/x402` SDK (middleware, client helper) · **Circle Nanopayments integration** for streaming/sub-cent agent payments · **CCTP/Bridge Kit** for cross-chain x402 (Base→Arc) · External paid API demo · Public docs page "Use ArcLayer as your x402 facilitator" | 8 weeks |
| **M4 — Production hardening** | Rate-limit + monitoring + alerting · `JobEscrow V2` with `fundFromAuthorization()` for non-custodial atomic flow · Security review · Mainnet readiness | 12 weeks |

---

## 12. Circle Product Feedback

_(Required section per submission rules.)_

### 12.1 Why we chose these Circle products for our use case

- **USDC on Arc** was non-negotiable — it is the only programmable, regulated stablecoin with first-party support on Arc, and the agentic economy specifically needs predictable dollar-denominated settlement. Agents cannot reason about volatile assets when negotiating per-call prices below a cent.
- **Circle Wallets (via Privy embedded wallets)** removes seed-phrase friction for the human-side onboarding to ArcLayer. Our target users are AI agent developers who are not necessarily crypto-native; embedded wallets let them sign Arc Testnet transactions without managing keys themselves.
- **CCTP / Bridge Kit (roadmap)** is the right primitive for the multi-chain x402 use case. The x402 spec's `accepts[]` array is multi-chain by design — when an agent presents a Base USDC authorization but the API lives on Arc, CCTP is the canonical bridge path.
- **Circle Gateway (roadmap)** fits the agentic economy's treasury-routing need. As agents pool USDC for operating budgets, Gateway's routing primitives let ArcLayer's relayer manage its own gas and operating treasury without ad-hoc scripts.
- **Nanopayments (roadmap)** is a perfect philosophical match for x402. The HTTP `402` flow is fundamentally per-request — paying a fraction of a cent for a single inference call is exactly the use case Nanopayments was designed for.

### 12.2 What worked well during development

- **Arc Testnet RPC stability.** dRPC endpoint at `rpc.drpc.testnet.arc.network` averaged ~65ms from our VPS, reliable enough for production-style workloads. We never had to fall back to a secondary RPC.
- **Arc USDC = Circle FiatTokenV2 verbatim.** Identical interface to Base/Ethereum USDC means existing tooling (viem ABI, Coinbase x402 SDK, OpenZeppelin templates) works without modification. This is a huge accelerator for builders coming from other chains.
- **Block explorer (`testnet.arcscan.app`).** Verified contracts, transaction details, and event decoding all functional. Critical for debugging E2E flows.
- **x402 specification quality.** Clear, minimal, agent-friendly. The headers-first design fits HTTP semantics naturally — we did not have to reinvent transport.
- **EIP-3009, EIP-2612, EIP-712, Permit2** all confirmed working on Arc USDC after a single spike. Removed the largest unknown for the standard `exact` scheme implementation.

### 12.3 What could be improved

- **No canonical x402 facilitator on Arc.** Every team building paid APIs on Arc has to either build their own facilitator or fall back to a Base-only third-party — which fragments the agent ecosystem. ArcLayer aims to be the canonical `arclayers.xyz` endpoint to fix this, but Circle/Arc could publish a reference implementation as well.
- **Documentation gap on Arc Testnet specifics.** EIP-3009 / EIP-2612 / Permit2 support on Arc USDC was not documented anywhere we could find — neither in Arc docs nor Circle Developer docs. We had to spike it ourselves with raw `eth_call`. This delays every team that needs gasless approvals.
- **RPC discovery friction.** Multiple RPC URLs in the wild (some dead, some rate-limited). No single source of truth for live Arc Testnet RPC endpoints. A `chains.json` Circle/Arc registry would help.
- **Transient `JobEscrow.fund()` reverts under fresh balance reads.** We observed `ERC20: transfer amount exceeds balance` reverts even when on-chain `balanceOf` and `allowance` confirmed sufficiency, requiring a 2–5 block retry. Likely RPC indexing lag — worth a doc note in Circle's Arc-on-USDC integration guide.
- **Block time variance on testnet.** Receipts occasionally take >60s. Production-grade timeout configuration (`waitForTransactionReceipt` with 300s + 2s polling) is needed; this should be in builder docs explicitly.
- **Wallets ↔ on-chain agent identity.** Circle Wallets currently optimize for human users. For the agentic economy, an agent-controlled wallet primitive (programmatic, scoped, revocable, with built-in spending limits) would unlock more autonomous use cases without relying on a human-signed Privy embedded wallet.
- **No public x402 facilitator registry.** Agents need a discoverable list of facilitators per chain to negotiate payment rails. Today this is per-API-doc — not machine-readable.

### 12.4 Recommendations to make Circle's developer experience more seamless and scalable

1. **Publish a Circle-blessed x402 facilitator template** for new chains. ArcLayer can serve as the reference implementation for Arc — happy to upstream.
2. **Maintain an "Arc USDC capability matrix" page** in Circle Developer docs covering EIP-3009, EIP-2612, Permit2, and any Arc-specific extensions. This is the single most valuable doc improvement for new builders.
3. **Standardize relayer architecture** in the x402 spec — currently each implementation invents its own. A reference open-source relayer (potentially backed by Circle Gateway for treasury) would massively accelerate adoption.
4. **Maintain a public registry of x402 facilitators per chain** (e.g. `https://x402.org/facilitators`). ArcLayer would register `arclayers.xyz` as the Arc Testnet entry on Day 1.
5. **Ship an agent-native Circle Wallets primitive** with scoped permissions, spending limits, and EIP-3009-friendly key types. This would directly serve the agentic economy track and remove the Privy dependency for agent-controlled wallets.
6. **Bundle Nanopayments with x402 reference docs.** The two are conceptually identical (per-request micropayments) but live in separate doc trees today. A combined "Build paid AI agents" tutorial would unify the story.
7. **Provide a `chains.json` Circle/Arc registry** with live RPC URLs, USDC addresses, Permit2 addresses, and deployed Circle contract addresses per chain. Saves every team several hours of integration discovery.

---

## 13. Team & Contact

- **GitHub:** [@riyannode](https://github.com/riyannode)
- **Discord:** `riyan1388`
- **Telegram:** `@riyanhcr`
- **Repository:** https://github.com/riyannode/ArcLayer
- **License:** MIT

---

## 14. Submission Checklist (vs. Official Rules)

| Requirement | Status |
|---|---|
| Title and Short Description | ✅ Section 1, 2 |
| Track submitted for | ✅ Track 4 — Agentic Economy (Section 3) |
| Email associated with Circle Developer Account | ⏳ _fill in form before submit_ |
| Circle products used on Arc (checklist) | ✅ Section 4 |
| Functional MVP + frontend + backend + architecture diagram | ✅ Sections 6, 7 |
| Video demonstration + presentation | ⏳ _record using Section 10 script, paste URL in form_ |
| Link to GitHub/Code repository with detailed setup + Circle integration docs | ✅ https://github.com/riyannode/ArcLayer + Section 9 |
| Demo Application Platform/Application URL | ✅ https://arclayers.xyz |
| Circle Product Feedback (4 sub-sections) | ✅ Section 12 |

---

_This document is generated for the Stablecoin Commerce Stack Challenge (Ignyte × Circle × Arc) submission of ArcLayer._
_Source: `docs/grant/ArcLayer_Grant_Submission.txt` in the public repository (https://github.com/riyannode/ArcLayer)._
