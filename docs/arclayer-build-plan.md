# ArcLayer Build Plan

## Goal

Refactor `ArcWork` from a single-app milestone escrow demo into `ArcLayer`, a protocol-oriented monorepo for agent-to-agent work settlement on Arc.

Target shape:

```text
arcwork/
├── contracts/
├── sdk/
├── indexer/
├── apps/
│   └── console/
└── docs/
```

This plan is based on the current repository state on May 12, 2026, not on an abstract greenfield design.

## Current State Audit

### What already exists

- `contracts/src/MilestoneEscrow.sol`
  - working V1 escrow flow: `createProject -> fundProject -> submitMilestone -> approveMilestone`
  - reusable owner/fee/funding/storage patterns
- `contracts/test/MilestoneEscrow.t.sol`
  - baseline Foundry coverage for create, fund, submit, release
- `contracts/script/DeployArcWork.s.sol`
  - working deployment entrypoint for Arc testnet
- `frontend/src/lib/contracts.ts`
  - contract addresses, ABIs, chain constants, formatter helpers
- `frontend/src/lib/escrow-indexer.ts`
  - event-fetching logic that can seed a standalone indexer
- `frontend/src/lib/wagmi.ts`
  - Arc testnet wagmi config that should survive with minimal change
- `frontend/src/app/*`
  - app shell, dashboard, detail, and workflow pages that can be repurposed into a protocol console
- `docs/indexing.md`
  - source-of-truth rule and cache/indexer direction already documented

### What is shallow or legacy

- `contracts/src/Achievement.sol`
  - not soulbound yet
  - badge model does not encode protocol work proof semantics
- `contracts/src/Invoice.sol`
  - legacy naming and wrong product surface for protocol direction
- `contracts/src/Subscription.sol`
  - out of scope and already called buggy
- `frontend/src/app/invoice/page.tsx`
  - tightly coupled to V1 project creation flow
- `frontend/src/lib/contracts.ts`
  - currently mixes config, ABI literals, chain metadata, and UI helpers in one module
- `frontend/src/lib/escrow-indexer.ts`
  - not an indexer service yet, only a client-side event reader

### Architectural reading

The deepest existing module is `MilestoneEscrow.sol`. The shallowest modules are the product-specific wrappers around it: page routes, inline ABI/config bundles, and legacy contracts. The migration should keep contract and protocol semantics centralized while moving UI and indexing concerns outward into separate packages.

## Decision

Do not do a big-bang rename of the whole repo first.

Instead, perform a staged monorepo migration:

1. deepen the contract layer around job settlement
2. extract a reusable SDK from frontend contract utilities
3. extract indexing into its own runtime
4. move the frontend into `apps/console` and repurpose it as a protocol explorer
5. update docs and deployment artifacts last

This minimizes breakage and preserves a working testnet path throughout the pivot.

## Target Monorepo Layout

```text
arcwork/
├── package.json
├── pnpm-workspace.yaml
├── contracts/
│   ├── src/
│   │   ├── JobEscrow.sol
│   │   ├── AgentRegistry.sol
│   │   ├── WorkProof.sol
│   │   └── ReputationOracle.sol
│   ├── script/
│   ├── test/
│   └── broadcast/
├── sdk/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── client.ts
│   │   ├── agent.ts
│   │   ├── job.ts
│   │   ├── reputation.ts
│   │   ├── addresses.ts
│   │   ├── abi/
│   │   └── types.ts
│   └── index.ts
├── indexer/
│   ├── package.json
│   ├── src/
│   │   ├── config.ts
│   │   ├── db.ts
│   │   ├── ingest.ts
│   │   ├── projections/
│   │   └── server.ts
├── apps/
│   └── console/
│       ├── package.json
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   └── lib/
└── docs/
```

## Package Strategy

### Root

Add workspace management at the root:

- `pnpm-workspace.yaml`
- root `package.json` scripts for `build`, `test`, `lint`, `dev:console`, `dev:indexer`

Recommended workspace globs:

```yaml
packages:
  - "sdk"
  - "indexer"
  - "apps/*"
```

`contracts/` can remain a Foundry package outside pnpm workspaces and still be orchestrated from root scripts.

### apps/console

Move `frontend/` to `apps/console/` only after the SDK surface exists. If done earlier, imports will churn twice.

## Phase Plan

## Phase 1: Contract Layer

### 1.1 Refactor `MilestoneEscrow.sol` into `JobEscrow.sol`

Keep:

- owner and fee controls
- budget/funding flow
- project storage pattern
- milestone accounting pattern

Change:

- rename domain terms from project/milestone freelancer workflow to job/agent workflow where needed
- add `jobSpecHash`
- add `agentId`
- add `evaluator`
- align external interface to ERC-8183-style operations:
  - `createJob`
  - `setBudget`
  - `fund`
  - `submitDeliverable`
  - `evaluate`
  - `settle`

Compatibility rule:

- keep old flow behavior intact internally wherever possible
- implement compatibility wrappers only if needed for testnet continuity during migration

Recommended internal shape:

- keep one core state machine module
- split validation and payout logic into internal functions instead of new helper contracts
- avoid adding a router contract in this phase

Files:

- refactor [contracts/src/MilestoneEscrow.sol](/C:/Users/kikoi/OneDrive/Desktop/PENTING/arcwork/contracts/src/MilestoneEscrow.sol)
- add `contracts/src/JobEscrow.sol`
- update deploy script
- add or rename tests

### 1.2 Add `AgentRegistry.sol`

Purpose:

- canonical onchain record for agent capability declarations

Initial interface:

- `registerAgent(agentId, skillHash, metadataURI)`
- `getAgent(agentId)`
- optional update methods if your identity model requires agent-controlled mutation

Storage guidance:

- start simple: one primary record plus append-only capability entries
- do not build matching logic onchain in V1

Why:

- this gives the protocol a clean seam between identity and settlement without prematurely adding a job router

### 1.3 Refactor `Achievement.sol` into `WorkProof.sol`

Required changes:

- enforce soulbound transfers by reverting transfer/approval paths
- replace badge taxonomy with payment-coupled proof semantics
- mint only from `JobEscrow.settle()`
- bind proof to `jobId`, `agentId`, `payer`, `amountPaid`

Important note:

Current `Achievement.sol` is not a deep reusable module. Reusing the ERC721 base is fine, but the data model should be replaced rather than incrementally patched.

### 1.4 Add `ReputationOracle.sol`

Purpose:

- derive score from `WorkProof` history

V1 guidance:

- make the score deterministic and queryable
- prefer recomputable or checkpointed aggregation over offchain-signed opinionated scores

Suggested formula:

- completed jobs count
- average or total paid value
- time decay or recency bucket multiplier

Pragmatic choice:

- start with view-based aggregation if state size stays manageable
- move to cached checkpoints only if gas or read complexity becomes a problem

### 1.5 Archive legacy contracts

Move out of primary path:

- `contracts/src/Invoice.sol`
- `contracts/src/Subscription.sol`

Recommended action:

- relocate to `contracts/archive/`
- remove from deploy script
- remove from docs as active protocol modules

### 1.6 Tests and deploy

Add:

- contract rename migration tests
- fuzz tests for funding, settlement ordering, and unauthorized calls
- invariant tests for escrow accounting
- WorkProof mint-once guarantees
- registry and oracle reads

Keep:

- existing Foundry setup
- existing Arc testnet chain target `5042002`

Update:

- broadcast artifacts
- deployment script output names
- README deploy table

## Phase 2: SDK Layer

This phase converts frontend contract glue into a reusable developer package.

### 2.1 Create `sdk/`

Extract from current frontend:

- chain constants from `frontend/src/lib/wagmi.ts`
- contract addresses and ABIs from `frontend/src/lib/contracts.ts`
- formatting-free contract read/write helpers from `frontend/src/lib/escrow.ts` and route usage

Target modules:

- `src/client.ts`
  - `ArcWorkClient` or `ArcLayerClient`
- `src/agent.ts`
  - registry reads/writes
- `src/job.ts`
  - job lifecycle actions
- `src/reputation.ts`
  - score and proof queries
- `src/types.ts`
  - shared tuples, DTOs, response shapes

Do not carry UI helpers into the SDK:

- `formatUSDC`
- route presentation helpers
- address shortening helpers

Those belong in the console app, not the package interface.

### 2.2 Generate typed bindings

Preferred input:

- generated ABI JSON from Foundry artifacts

Choose one:

- `wagmi generate`
- `typechain`

Recommendation:

- use `wagmi generate` if the console app remains wagmi-first
- use `typechain` if you want the SDK to stay wallet-library agnostic

Current repo bias suggests `wagmi generate` is the lower-friction path.

### 2.3 Publish path

NPM target:

- `@arcwork/sdk`

Release preconditions:

- package exports stable
- addresses separated per network
- contract method names no longer tied to old milestone terminology

## Phase 3: Indexer

### 3.1 Extract a standalone service

Current reuse source:

- [frontend/src/lib/escrow-indexer.ts](/C:/Users/kikoi/OneDrive/Desktop/PENTING/arcwork/frontend/src/lib/escrow-indexer.ts)

Keep:

- event list
- event fetch pattern

Replace:

- frontend-coupled imports
- client-side execution assumptions

New service responsibilities:

- poll or backfill blocks
- persist normalized events
- build agent, job, and proof projections
- expose REST endpoints:
  - `GET /agents`
  - `GET /jobs`
  - `GET /agent/:id/reputation`

Recommended implementation order:

1. SQLite first for speed
2. Postgres adapter second if public deployment or concurrent writers are needed

### 3.2 Data model

Tables or collections:

- `events`
- `jobs`
- `agents`
- `work_proofs`
- `reputation_snapshots`

Invariant:

- chain remains source of truth
- projections are rebuildable from events

## Phase 4: Protocol Console

Refactor the frontend from operator workflow to protocol explorer.

### 4.1 App move

- move `frontend/` to `apps/console/`

### 4.2 Route plan

Refactor:

- `/` -> protocol landing
- `/dashboard` -> network-wide agent/job overview
- `/project/[id]` -> `/job/[id]`
- `/achievements` -> merge into `/agent/[id]`

Delete:

- `/invoice`
- `/subscription`

Add:

- `/agent/[id]`
- `/job/[id]`
- `/docs`

### 4.3 Component reuse

Keep:

- `Navbar.tsx`
- `Footer.tsx`
- `WebGLBackground.tsx` if it still fits the protocol brand
- `wagmi.ts` with small relocation changes

Refactor:

- `contracts.ts` into SDK consumption plus app-local formatting helpers
- current dashboard from wallet-centric to network-centric
- current project page from project/milestone to job/proof/reputation view

### 4.4 Design direction

Use the existing frontend only as a shell, not as the final language. Current home page is dark and effect-heavy. For `ArcLayer`, use a calmer protocol-explorer presentation:

- cleaner information density
- stronger documentation posture
- less hero spectacle
- neutral trust infrastructure branding

That aligns with a developer-facing console better than the current product-marketing treatment.

## Phase Dependencies

Order matters:

1. Contract names and events must stabilize before typed SDK generation.
2. SDK exports must stabilize before `apps/console` imports are migrated.
3. Event names and payloads must stabilize before indexer persistence is finalized.
4. Docs and deployment tables should be updated after addresses and package surfaces are real.

## Reuse Scorecard

### Keep with minor edits

- `contracts/foundry.toml`
- `contracts/test/` structure
- `frontend/src/lib/wagmi.ts`
- `frontend/src/components/Navbar.tsx`
- `frontend/src/components/Footer.tsx`
- `frontend/src/components/WebGLBackground.tsx`
- deploy chain target and broadcast workflow

### Refactor heavily

- `contracts/src/MilestoneEscrow.sol`
- `contracts/src/Achievement.sol`
- `frontend/src/lib/contracts.ts`
- `frontend/src/lib/escrow-indexer.ts`
- `frontend/src/app/dashboard/page.tsx`
- `frontend/src/app/project/[id]/page.tsx`
- root packaging

### Archive or delete

- `contracts/src/Invoice.sol`
- `contracts/src/Subscription.sol`
- `frontend/src/app/invoice/page.tsx`
- `frontend/src/app/subscription/page.tsx`

## Concrete Execution Checklist

### Week 1

1. Add workspace root files.
2. Refactor `MilestoneEscrow` into `JobEscrow`.
3. Add `AgentRegistry`.
4. Replace `Achievement` with `WorkProof`.
5. Add `ReputationOracle`.
6. Update deploy script and tests.

### Week 2

1. Create `sdk/`.
2. Generate typed bindings.
3. Move ABI/address ownership out of frontend.
4. Make console consume SDK instead of inline contract definitions.

### Week 3

1. Create `indexer/` service.
2. Port event ingestion from frontend utility.
3. Add SQLite persistence and REST API.
4. Begin moving `frontend/` to `apps/console/`.

### Week 4

1. Finish route refactors and deletions.
2. Rewrite landing and docs surfaces.
3. Update README and protocol docs.
4. Deploy refreshed contracts and update artifacts.

## Main Risks

1. Event churn risk
   Renaming project and milestone events too late will force repeated SDK and indexer rewrites.

2. Interface mixing risk
   If UI formatters and wallet assumptions leak into `sdk/`, the package will stay app-shaped instead of protocol-shaped.

3. Overbuilding risk
   Adding onchain matching, routing, or complex oracle logic in Phase 1 will slow the pivot and reduce deploy confidence.

4. Migration churn risk
   Moving `frontend/` before the SDK exists will duplicate import rewrites.

## Recommended Next Deliverable

Implement the refactor in this order:

1. root workspace scaffolding
2. contract-layer rename and new contracts
3. Foundry tests
4. SDK extraction

That is the smallest path that turns the repo into a real protocol monorepo without breaking the existing Arc testnet narrative too early.
