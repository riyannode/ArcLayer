# Provider Runtime Memory

Durable runtime memory for ERC-8183 provider PM2 bots. Enables crash-safe job execution, phase tracking, and open/global job discovery.

## Core Concept

**PM2/LLM bots are disposable. ArcLayer runtime memory is the second brain.**

Every phase transition, transaction hash, and job state is persisted in Supabase. If the bot crashes, restarts, or the LLM loses context, the bot reads its checkpoint and on-chain state to resume exactly where it left off.

## Architecture

```
Provider Bot (PM2)
  │
  ├─ startup: heartbeat → context → resume_plan
  │
  ├─ direct assigned job:
  │   setBudget → checkpoint → wait funding → submit → checkpoint → wait evaluator
  │
  └─ open/global job:
      list_open_jobs → apply → checkpoint → wait setProvider → direct flow
```

## Database Tables

| Table | Purpose |
|-------|---------|
| `agent_runtime_state` | Heartbeat, active job/run, last checkpoint |
| `agent_job_runs` | One run per agent+job (idempotent) |
| `agent_job_checkpoints` | Append-only phase transitions |
| `provider_open_job_applications` | Provider applications to open jobs |

## Checkpoint Phases

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
| `deliverable_prepared` | Deliverable ready |
| `submit_tx_sent` | Submit tx submitted |
| `submitted_confirmed` | Submit confirmed onchain |
| `completed_detected` | Job completed (terminal) |
| `rejected_detected` | Job rejected (terminal) |
| `expired_detected` | Job expired (terminal) |
| `budget_tx_failed` | setBudget tx failed |
| `submit_tx_failed` | Submit tx failed |
| `failed` | Generic failure |

## Resume Mapping

| On-chain Status | Provider Phase | Next Action |
|-----------------|----------------|-------------|
| Open, no provider | `applied_to_open_job` | Wait for client setProvider |
| Open, provider assigned | — | setBudget |
| Open, budget_tx_sent | `budget_tx_failed` | Retry setBudget |
| Open, budget set | `budget_confirmed` | Wait for client funding |
| Funded | — | Submit deliverable |
| Submitted | — | Wait for evaluator |
| Completed | — | Terminal (paid) |
| Rejected | — | Terminal (not paid) |
| Expired | — | Terminal (refund) |

## Direct Assigned Job Flow

```
CLIENT: createJob(provider=PROVIDER_ADDRESS)
  ↓
BOT: detect assigned job (provider = my address, status = Open)
  ↓
BOT: provider.prepare_set_budget_for_session → sign locally → send tx
  ↓
BOT: checkpoint: budget_tx_sent → budget_confirmed
  ↓
CLIENT: USDC.approve + fund
  ↓
BOT: checkpoint: funded_detected
  ↓
BOT: provider.prepare_submit_job_for_session → sign locally → send tx
  ↓
BOT: checkpoint: submit_tx_sent → submitted_confirmed
  ↓
EVALUATOR: complete or reject
  ↓
BOT: checkpoint: completed_detected or rejected_detected (terminal)
```

## Open/Global Job Flow

```
CLIENT: createJob(provider=0x0)  ← open job
  ↓
BOT: provider.list_open_jobs → find job
  ↓
BOT: provider.apply_open_job → checkpoint: applied_to_open_job
  ↓
CLIENT: provider.prepare_set_provider_for_session → setProvider(jobId, PROVIDER_ADDRESS)
  ↓
BOT: detect provider assigned → checkpoint: selected_for_open_job
  ↓
BOT: continues as direct assigned flow (setBudget → fund → submit → evaluator)
```

**IMPORTANT:** Provider bot must NEVER call `setProvider`. Only the client can assign provider onchain.

## MCP Tools

### Runtime Tools

| Tool | Description |
|------|-------------|
| `provider.runtime_get_context` | Get state + active run + checkpoint + applications + resume plan |
| `provider.runtime_heartbeat` | Update last_seen_at |
| `provider.runtime_start_job` | Start a new job run (idempotent) |
| `provider.runtime_write_checkpoint` | Append checkpoint to active run |
| `provider.runtime_get_resume_plan` | Compute next action from checkpoint + onchain |

### Open Job Tools

| Tool | Description |
|------|-------------|
| `provider.list_open_jobs` | List open jobs where provider = address(0) |
| `provider.apply_open_job` | Apply to an open job |
| `provider.withdraw_open_job_application` | Withdraw application |
| `provider.list_my_open_job_applications` | List provider's applications |

## Bot Environment

```bash
# Required
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_MCP_TOKEN=arc_mcp_sess_your_token
ARCLAYER_AGENT_ID=your_agent_id
PROVIDER_ADDRESS=0xYourProviderAddress

# Local signing (never sent to ArcLayer)
PROVIDER_PRIVATE_KEY=0xYourPrivateKey

# Optional
PROVIDER_AUTO_APPLY_OPEN_JOBS=false
PROVIDER_MAX_QUOTE_USDC=10.0
PROVIDER_CAPABILITIES=data-analysis,market-summary
POLL_INTERVAL_MS=15000
```

## Security Rules

- Private key stays ONLY in local `.env`
- NEVER send private key to ArcLayer
- NEVER log private key
- NEVER commit `.env` files
- Bot MUST exit non-zero if heartbeat fails at startup
- Bot MUST NOT call `setProvider` (client-only action)

## Crash Recovery

1. PM2 restarts bot after crash
2. Bot calls `provider.runtime_heartbeat`
3. Bot calls `provider.runtime_get_context`
4. Bot calls `provider.runtime_get_resume_plan`
5. Resume plan returns next action based on checkpoint + onchain state
6. Bot continues from exact point of failure

No RAM-only state. All state in Supabase. Bot is fully disposable.
