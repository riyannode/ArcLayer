# Provider Runtime Memory

Durable runtime memory for ERC-8183 provider PM2 bots. Enables crash-safe job execution, LLM-backed deliverable generation, phase tracking, and open/global job discovery.

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
  │   setBudget → checkpoint → wait funding
  │   → fetch job detail → run LLM → deliverableHash
  │   → submit → checkpoint → wait evaluator
  │
  └─ open/global job:
      list_open_jobs → apply → checkpoint → wait setProvider → direct flow
```

## LLM-Backed Execution

The provider bot generates real deliverables using an LLM:

1. **Fetch job detail** — via `jobs.get_public` MCP tool
2. **Run LLM task** — via `shared/task-runner.js` (self-contained, no legacy deps)
3. **Validate output** — strict JSON schema, confidence 0..1, findings array
4. **Compute deliverableHash** — SHA-256 of deterministic JSON
5. **Submit** — `prepareSubmitJob` + sign locally + send tx

The task runner handles:
- LLM call with timeout
- JSON repair (deterministic + LLM-based)
- Strict output validation
- Skill loading (base + type + custom)

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
| `runtime_started` | LLM execution started |
| `runtime_completed` | LLM output validated |
| `runtime_failed` | LLM execution failed (no submit) |
| `deliverable_ready` | deliverableHash computed, ready to submit |
| `deliverable_prepared` | Legacy: deliverable ready |
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

| On-chain Status | Provider Phase | Next Action |
|-----------------|----------------|-------------|
| Open, no provider | `applied_to_open_job` | Wait for client setProvider |
| Open, provider assigned | — | setBudget |
| Open, budget_tx_sent | `budget_tx_failed` | Retry setBudget |
| Open, budget set | `budget_confirmed` | Wait for client funding |
| Funded, no phase | — | Run LLM + submit |
| Funded, `runtime_started` | — | Wait for LLM completion |
| Funded, `runtime_completed` | — | Compute deliverableHash + submit |
| Funded, `runtime_failed` | — | Terminal (manual intervention) |
| Funded, `deliverable_ready` | — | Submit stored deliverableHash |
| Funded, `submit_tx_sent` | — | Check onchain status |
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
BOT: checkpoint: budget_tx_sent
  ↓
CLIENT: USDC.approve + fund
  ↓
BOT: checkpoint: funded_detected
  ↓
BOT: fetch job detail via jobs.get_public
  ↓
BOT: checkpoint: runtime_started
  ↓
BOT: runLlmTask(job, llmEnv) → resultPayload + deliverableHash
  ↓
BOT: checkpoint: runtime_completed → deliverable_ready
  ↓
BOT: provider.prepare_submit_job_for_session → sign locally → send tx
  ↓
BOT: checkpoint: submit_tx_sent
  ↓
BOT (next poll): onchain status = Submitted → checkpoint: submitted_detected
  ↓
EVALUATOR: complete or reject
  ↓
BOT: checkpoint: completed_detected or rejected_detected (terminal)
```

## Resume Safety

- **deliverable_ready** stores `deliverableHash`, `confidence`, `model`, `provider` in checkpoint metadata
- On resume, if `deliverable_ready` or `runtime_completed` → reuse stored deliverableHash (no re-run LLM)
- If `submit_tx_sent` → check onchain status before retrying
- If `runtime_failed` → terminal, do not retry automatically
- If `Submitted` → write `submitted_detected`, wait evaluator

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
BOT: continues as direct assigned flow (setBudget → fund → LLM → submit → evaluator)
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
| `provider.list_assigned_jobs` | List jobs assigned to a specific provider address (Open/Funded/Submitted) |
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

# LLM (required for real deliverables)
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
LLM_API_KEY=

# Optional LLM tuning
LLM_MAX_TOKENS=2500
LLM_TEMPERATURE=0.2
LLM_TIMEOUT_MS=60000
LLM_JSON_REPAIR_RETRIES=1

# Optional skill config
PROVIDER_AGENT_TYPE=other
PROVIDER_SKILL=auto
PROVIDER_CUSTOM_SKILL_PATH=/absolute/path/to/custom-skill.md
```

## Security Rules

- Private key stays ONLY in local `.env`
- NEVER send private key to ArcLayer
- NEVER log private key
- NEVER commit `.env` files
- NEVER log LLM API key
- NEVER include raw LLM output in checkpoints (only hash + metadata)
- Bot MUST exit non-zero if heartbeat fails at startup
- Bot MUST exit non-zero if LLM config is incomplete (when LLM_BASE_URL is set)
- Bot MUST NOT call `setProvider` (client-only action)
- Bot MUST NOT submit on LLM failure (runtime_failed → no submit)

## Direct Assigned Job Discovery

On fresh boot with no active run, the bot checks for direct-assigned jobs first:

1. `provider.list_assigned_jobs` — queries indexer for `provider = PROVIDER_ADDRESS`
2. Filters for active statuses: Open, Funded, Submitted
3. If found, starts a run with appropriate initial phase:
   - Open → `budget_tx_sent` (need setBudget)
   - Funded → `funded_detected` (need submit)
   - Submitted → `submitted_confirmed` (wait evaluator)
4. If not found, falls through to open job discovery

This ensures the bot never misses a direct-assigned job, even after a full restart.

## Crash Recovery

1. PM2 restarts bot after crash
2. Bot calls `provider.runtime_heartbeat`
3. Bot calls `provider.runtime_get_context`
4. Bot calls `provider.runtime_get_resume_plan`
5. Resume plan returns next action based on checkpoint + onchain state
6. Bot continues from exact point of failure

No RAM-only state. All state in Supabase. Bot is fully disposable.

## Production Readiness

### Direct-Assigned Jobs ✅ Ready

Direct-assigned jobs (where `provider` is set to a specific address at job creation) are fully production-ready:

- LLM-backed deliverable generation
- Crash-safe checkpoint resume
- Receipt verification before retry
- No unbounded indexer queries

### Open/Global Jobs ⚠️ Requires Indexer Fix

Open/global job discovery (`provider.list_open_jobs`) requires the production indexer to support server-side filtering:

- `GET /jobs?provider=<address>&status=open,funded,submitted&limit=50`
- `GET /jobs/open?limit=50&includeExpired=false`

**Do not enable `PROVIDER_AUTO_APPLY_OPEN_JOBS=true` against an unbounded `/jobs` endpoint.**

### Checkpoint Semantics

| Checkpoint | When Written |
|------------|--------------|
| `budget_tx_sent` | After `sendTransaction` returns txHash |
| `budget_confirmed` | After BudgetSet event or onchain status verification |
| `submit_tx_sent` | After `sendTransaction` returns txHash |
| `submitted_confirmed` | After JobSubmitted event or onchain status verification |
| `submitted_detected` | After onchain status = Submitted |
| `completed_detected` | After onchain status = Completed |

**Rule:** `*_confirmed` checkpoints require actual verification (event or onchain read), NOT just txHash receipt.
