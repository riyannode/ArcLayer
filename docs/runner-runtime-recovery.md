# Runner Runtime Recovery

Durable runtime patterns for ArcLayer Runner. Checkpoint phase tracking, operation journal, and resume after restart.

> **Status:** Partially implemented. Current recovery uses local SQLite operation journal. Hosted runtime-context reconciliation is planned but not yet wired into startup.

## Current Implementation

### Local State

Runner maintains a **persistent `dataDir`** that must survive process restarts:

- `operations.db` — SQLite operation journal (idempotency keys, locks, result cache, reconciliation hooks)
- Local receipts and ledger entries
- Operation metadata for non-terminal operation recovery

**Runner process is disposable. `dataDir` is NOT disposable.** Deleting the data directory loses operation journal, idempotency state, and pending operation recovery context.

### Operation Journal

The ExecutionGateway writes an append-only operation journal to SQLite:

| Table | Purpose |
|-------|---------|
| `operations` | One row per operation (idempotent key, status, result, timestamps) |
| `locks` | Per-operation locks to prevent concurrent execution |
| `result_cache` | Cached results for idempotent reads |

On startup, `ExecutionGateway` recovers non-terminal operations from the journal. This is **local recovery only** — it does not call hosted MCP tools or reconcile on-chain state.

### What Runner Does on Startup

1. Loads config, resolves skill manifest
2. Creates MCP connector (remote) + services + broker
3. Opens HTTP server (or STDIO transport)
4. ExecutionGateway recovers non-terminal operations from local SQLite journal

**What Runner does NOT do on startup:**

- Does not call `provider.runtime_heartbeat`
- Does not call `provider.runtime_get_context`
- Does not call `provider.runtime_get_resume_plan`
- Does not reconcile on-chain job state
- Does not discover assigned jobs automatically

These operations are exposed as callable MCP tools. The connected LLM host (Hermes, OpenClaw) must invoke them explicitly.

## Hosted Checkpoint Phases

The following phases are used by the hosted `provider.runtime_*` MCP tools. They are stored in Supabase via the Console API, not in local SQLite.

| Phase | Meaning |
|-------|---------|
| `open_job_found` | Detected an open job |
| `applied_to_open_job` | Submitted application |
| `selected_for_open_job` | Client assigned provider via setProvider |
| `quoted_budget` | Budget amount decided |
| `budget_tx_sent` | setBudget tx submitted |
| `budget_confirmed` | setBudget confirmed onchain |
| `waiting_for_funding` | Waiting for client to fund |
| `funded_detected` | Job funded onchain |
| `runtime_started` | Execution started |
| `runtime_completed` | Output validated |
| `runtime_failed` | Execution failed (no submit) |
| `deliverable_ready` | deliverableHash computed, ready to submit |
| `submit_tx_sent` | Submit tx submitted |
| `submitted_confirmed` | Submit confirmed onchain |
| `submitted_detected` | Onchain status is Submitted (next poll) |
| `completed_detected` | Job completed (terminal) |
| `rejected_detected` | Job rejected (terminal) |
| `expired_detected` | Job expired (terminal) |
| `budget_tx_failed` | setBudget tx failed |
| `submit_tx_failed` | Submit tx failed |
| `failed` | Generic failure |

## Resume Mapping

| On-chain Status | Runner Phase | Next Action |
|-----------------|--------------|-------------|
| Open, no provider | `applied_to_open_job` | Wait for client setProvider |
| Open, provider assigned | — | setBudget |
| Open, budget_tx_sent | `budget_tx_failed` | Retry setBudget |
| Open, budget set | `budget_confirmed` | Wait for client funding |
| Funded, no phase | — | Run task + submit |
| Funded, `runtime_started` | — | Wait for completion |
| Funded, `runtime_completed` | — | Compute deliverableHash + submit |
| Funded, `runtime_failed` | — | Terminal (manual intervention) |
| Funded, `deliverable_ready` | — | Submit stored deliverableHash |
| Funded, `submit_tx_sent` | — | Check onchain status |
| Submitted | — | Wait for evaluator |
| Completed | — | Terminal (paid) |
| Rejected | — | Terminal (not paid) |
| Expired | — | Terminal (refund) |

## Resume Safety

- **deliverable_ready** stores `deliverableHash`, `confidence`, `model`, `provider` in checkpoint metadata
- On resume, if `deliverable_ready` or `runtime_completed` → reuse stored deliverableHash (no re-run)
- If `submit_tx_sent` → check onchain status before retrying
- If `runtime_failed` → terminal, do not retry automatically
- If `Submitted` → write `submitted_detected`, wait evaluator

## Checkpoint Semantics

| Checkpoint | When Written |
|------------|--------------|
| `budget_tx_sent` | After `sendTransaction` returns txHash |
| `budget_confirmed` | After BudgetSet event or onchain status verification |
| `submit_tx_sent` | After `sendTransaction` returns txHash |
| `submitted_confirmed` | After JobSubmitted event or onchain status verification |
| `submitted_detected` | After onchain status = Submitted |
| `completed_detected` | After onchain status = Completed |

**Rule:** `*_confirmed` checkpoints require actual verification (event or onchain read), NOT just txHash receipt.

## Ambiguous Transaction State

When a transaction hash is stored in a checkpoint but the onchain status is unclear:

1. Read transaction receipt via `publicClient.getTransactionReceipt(txHash)`
2. If receipt exists and status === 'success' → proceed to next phase
3. If receipt exists and status === 'reverted' → mark failed, do not retry
4. If receipt is null (pending) → wait and re-check on next poll
5. If receipt is null after extended period → mark `*_tx_failed`, allow manual intervention

## Planned Production Gate

The following features are designed but **not yet wired into Runner startup**:

- **Hosted runtime-context reconciliation** — on startup, call `provider.runtime_get_context` and `provider.runtime_get_resume_plan` via hosted MCP to reconcile local state with on-chain state
- **Automatic heartbeat on startup** — call `provider.runtime_heartbeat` before processing any work; fail-fast if heartbeat fails
- **On-chain receipt reconciliation** — compare local operation journal with on-chain job status; detect and resolve divergences
- **Assigned job discovery on startup** — call `provider.list_assigned_jobs` to detect jobs assigned while Runner was offline
- **Fail-fast startup health gate** — if critical dependencies (MCP connector, wallet adapter, RPC endpoint) are unavailable, exit non-zero immediately

When implemented, these will make the Runner truly disposable — the data directory holds local optimization state, but the authoritative state lives in Supabase + on-chain.
