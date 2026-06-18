# LangChain Provider Tools

Full provider tool surface for `@arclayer/langchain-adapter`.

## Overview

Provider agents interact with ERC-8183 jobs through ArcLayer Runner. All tools use the `arclayer_*` naming convention. Raw MCP names (`provider.runtime_*`, `erc8183.provider_*`, `jobs.get_*`) are **not** part of the LangChain public interface — they are internal MCP mappings handled by the Runner.

## Tool Inventory (26 tools)

### Shared Read Tools (all roles)

| Tool | Runner Endpoint | Description |
|------|----------------|-------------|
| `arclayer_x402_inspect` | `POST /x402/inspect` | Inspect x402-protected resource (read-only) |
| `arclayer_receipts` | `GET /receipts` | List recent receipts |
| `arclayer_spend_ledger` | `GET /ledger` | List spending ledger records |
| `arclayer_job_status` | `POST /jobs/onchain-status` | On-chain ERC-8183 job status |
| `arclayer_job_lifecycle_summary` | `POST /jobs/lifecycle-summary` | Job lifecycle summary (next actor/action) |

### Provider Runtime Tools (provider role default)

| Tool | Runner Endpoint | Description |
|------|----------------|-------------|
| `arclayer_provider_get_context` | `POST /provider/context` | Runtime context: state, active run, checkpoint, applications, resume plan |
| `arclayer_provider_get_resume_plan` | `POST /provider/resume-plan` | Compute next action from checkpoint + on-chain state |
| `arclayer_provider_heartbeat` | `POST /provider/heartbeat` | Update last_seen_at (liveness signal) |
| `arclayer_provider_start_job` | `POST /provider/start-job` | Start a durable runtime entry for a job |
| `arclayer_provider_write_checkpoint` | `POST /provider/write-checkpoint` | Append-only progress checkpoint |
| `arclayer_provider_retry_job` | `POST /provider/retry-job` | Retry failed run (max 3, phase must be runtime_failed/submit_tx_failed) |
| `arclayer_provider_complete_run` | `POST /provider/complete-run` | Mark run as completed (terminal cleanup) |

### Provider Marketplace Tools (provider role default)

| Tool | Runner Endpoint | Description |
|------|----------------|-------------|
| `arclayer_provider_list_assigned_jobs` | `POST /provider/list-assigned-jobs` | Jobs assigned to provider address |
| `arclayer_provider_list_assigned_jobs_extended` | `POST /provider/list-assigned-jobs-extended` | Assigned jobs with status filter (Open/Funded/Submitted) |
| `arclayer_provider_list_open_jobs` | `POST /provider/list-open-jobs` | Open/global jobs (provider = address(0)) |
| `arclayer_provider_list_my_open_job_applications` | `POST /provider/list-my-open-job-applications` | Provider's open job applications |
| `arclayer_provider_apply_open_job` | `POST /provider/apply-open-job` | Apply for an open/global job |
| `arclayer_provider_withdraw_open_job_application` | `POST /provider/withdraw-open-job-application` | Withdraw an application |

### Provider Execution Tools (provider role default)

| Tool | Runner Endpoint | Description |
|------|----------------|-------------|
| `arclayer_provider_run_only` | `POST /erc8183/provider/run-only` | Runtime only — dispatches to LLM, returns deliverableHash. No on-chain submit. |
| `arclayer_provider_quote_job` | *(adapter-only)* | Estimate complexity and suggest budget. No Runner call. |

### Provider On-Chain Write Tools (opt-in required)

| Tool | Runner Endpoint | Opt-in Flag | Description |
|------|----------------|-------------|-------------|
| `arclayer_provider_run_and_submit` | `POST /erc8183/provider/run-and-submit` | `enableProviderRunAndSubmit` | Full lifecycle: run + submit deliverable on-chain |
| `arclayer_provider_set_budget` | `POST /erc8183/provider/set-budget` | `enableProviderSetBudget` | Set job budget on-chain (reason encoded into calldata) |
| `arclayer_provider_publish_deliverable` | `POST /provider/publish-deliverable` | `enableProviderPublishDeliverable` | Publish canonical deliverable for a funded job |
| `arclayer_provider_submit_deliverable` | `POST /erc8183/provider/submit-deliverable` | `enableProviderSubmitDeliverable` | Submit deliverable on-chain via wallet adapter |

## Role Tool Matrix

| Tool | read-only | x402-agent | provider | evaluator | client |
|------|:---------:|:----------:|:--------:|:---------:|:------:|
| `arclayer_x402_inspect` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `arclayer_receipts` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `arclayer_spend_ledger` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `arclayer_job_status` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `arclayer_job_lifecycle_summary` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `arclayer_x402_pay` | ❌ | ✅ | ❌ | ❌ | ❌ |
| `arclayer_x402_batch_pay` | ❌ | ✅ | ❌ | ❌ | ❌ |
| `arclayer_provider_get_context` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_get_resume_plan` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_heartbeat` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_start_job` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_write_checkpoint` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_retry_job` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_complete_run` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_list_assigned_jobs` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_list_assigned_jobs_extended` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_list_open_jobs` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_list_my_open_job_applications` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_apply_open_job` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_withdraw_open_job_application` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_run_only` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_quote_job` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `arclayer_provider_run_and_submit` | ❌ | ❌ | ⚙️ | ❌ | ❌ |
| `arclayer_provider_set_budget` | ❌ | ❌ | ⚙️ | ❌ | ❌ |
| `arclayer_provider_publish_deliverable` | ❌ | ❌ | ⚙️ | ❌ | ❌ |
| `arclayer_provider_submit_deliverable` | ❌ | ❌ | ⚙️ | ❌ | ❌ |

✅ = default | ⚙️ = requires explicit opt-in

## Safety Grouping

```
read (no side effects):
  - context, resume plan, job status, lifecycle summary
  - list assigned jobs, list open jobs, list applications
  - receipts, ledger

runtime mutation (Runner-scoped, no on-chain):
  - heartbeat, start job, checkpoint, retry, complete run
  - apply/withdraw open job

onchain write (policy-gated, opt-in):
  - set budget, submit deliverable, publish deliverable
  - run and submit (runtime + on-chain)
```

On-chain writes go through Runner policy enforcement. The LangChain adapter never calls wallet, contract, Supabase, or Console directly.

## Opt-In Flags

```ts
const tools = createArcLayerLangChainTools({
  role: "provider",
  runnerUrl: "...",
  runnerSecret: "...",
  // Default tools (no flag needed):
  // - all runtime tools, marketplace tools, run_only, quote_job

  // Opt-in on-chain writes:
  enableProviderRunAndSubmit: true,
  enableProviderSetBudget: true,
  enableProviderPublishDeliverable: true,
  enableProviderSubmitDeliverable: true,
});
```

`deniedTools` always wins over any `enable*` flag.

## Architecture

```
LangChain Agent
  → arclayer_provider_* tool
    → ArcLayerRunnerClient (HMAC-signed HTTP)
      → ArcLayer Runner
        → Console MCP proxy (runtime/marketplace tools)
        → services.* (runner-local tools: run, submit, set-budget)
          → wallet adapter → ERC-8183 on-chain
```

The adapter never imports `apps/arclayer-runner/src/*`. All calls go through HMAC-authenticated HTTP. The Runner is the wallet/payment/policy boundary.

## Provider Complexity Pricing

| Complexity | Budget (USDC) |
|-----------|--------------|
| `low`     | 1.00         |
| `medium`  | 3.00         |
| `high`    | 5.00         |

Hard cap: 5.00 USDC. Use `arclayer_provider_quote_job` before `arclayer_provider_set_budget`.

## Usage

```ts
import { createArcLayerLangChainAgent } from "@arclayer/langchain-adapter";

// Default provider: runtime + marketplace + run_only + quote
const agent = createArcLayerLangChainAgent({
  role: "provider",
  model: "openai:gpt-4o",
  runnerUrl: process.env.ARCLAYER_RUNNER_URL!,
  runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
});

// Full autonomous: all on-chain writes enabled
const agent = createArcLayerLangChainAgent({
  role: "provider",
  model: "openai:gpt-4o",
  runnerUrl: process.env.ARCLAYER_RUNNER_URL!,
  runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
  enableProviderRunAndSubmit: true,
  enableProviderSetBudget: true,
  enableProviderPublishDeliverable: true,
  enableProviderSubmitDeliverable: true,
});
```

See `agents/examples/langchain-provider-agent` for a complete PM2-compatible example.

## Naming Convention

All LangChain-facing provider tools use `arclayer_*` prefix with snake_case:

- `arclayer_provider_*` — provider-specific tools
- `arclayer_job_*` — job status/lifecycle
- `arclayer_receipts`, `arclayer_spend_ledger` — shared read tools

Raw MCP names are **not** public LangChain interface:

- `provider.runtime_*` — internal Console MCP names
- `erc8183.provider_*` — internal Runner MCP names
- `jobs.get_*` — internal Console MCP names

The Runner's `tool-map.ts` maps `arclayer_*` names to internal MCP names. The mapping is transparent to LangChain agents.
