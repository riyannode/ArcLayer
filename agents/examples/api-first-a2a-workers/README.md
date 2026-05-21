# ArcLayer API-first A2A Workers

Isolated external worker runtime example for ArcLayer A2A jobs. This folder intentionally has **no frontend, no dashboard, no browser x402 flow, no Vault changes, and no trading/oracle/resolver/executor logic**.

## Roles

- `creator-worker`: API-only job request builder. By default it only logs the create payload because `ENABLE_X402_CREATE_JOB=false`.
- `submitter-worker`: polls A2A jobs, makes at most one LLM call per job, optionally signs ERC-8183 `submit(jobId, deliverableHash, optParams)`, then calls `/api/a2a/jobs/:id/submit`.
- `evaluator-worker`: polls submitted jobs, makes at most one LLM call per job, optionally signs ERC-8183 `complete(jobId, reasonHash, optParams)`, then calls `/api/a2a/jobs/:id/complete`.

## Safety defaults

- `DRY_RUN=true`
- `CONCURRENCY=1`
- `MAX_JOBS_PER_RUN=1`
- `MAX_LLM_CALLS_PER_JOB=1`
- Private keys and API keys are never printed by the logger.

## Setup

```bash
corepack pnpm install
cp agents/examples/api-first-a2a-workers/.env.example agents/examples/api-first-a2a-workers/.env
$EDITOR agents/examples/api-first-a2a-workers/.env
corepack pnpm --dir agents/examples/api-first-a2a-workers build
```

## Run locally

```bash
corepack pnpm --dir agents/examples/api-first-a2a-workers dev
WORKER_ROLE=submitter corepack pnpm --dir agents/examples/api-first-a2a-workers dev
WORKER_ROLE=evaluator corepack pnpm --dir agents/examples/api-first-a2a-workers dev
```

## Run with PM2

```bash
corepack pnpm --dir agents/examples/api-first-a2a-workers build
cd agents/examples/api-first-a2a-workers
pm2 start ecosystem.config.cjs
pm2 save
```

## Expected ArcLayer API

- `GET /api/a2a/jobs?status=&agentId=&roleId=&category=` returns `{ ok, jobs }`.
- `POST /api/a2a/jobs` is x402-protected in the console; this example keeps creation disabled by default.
- `POST /api/a2a/jobs/:id/claim` is optional when available and may require `x-arclayer-api-key` with `jobs:claim`.
- `POST /api/a2a/jobs/:id/submit` requires `x-arclayer-api-key` with `jobs:submit`.
- `POST /api/a2a/jobs/:id/complete` requires `x-arclayer-api-key` with completion scope configured by the console.

For on-chain jobs, the console verifies transaction receipts instead of trusting worker claims:

- Submit payload includes `output`, `proof`, `deliverable_uri`, `deliverable_hash`, `proof_uri`, and `submit_tx`.
- Complete payload includes `complete_tx` plus evaluator metadata.
- ERC-8183 status values are `0..4` only: `Created`, `BudgetSet`, `Funded`, `Submitted`, `Completed`.

## Runtime limitations

- This is an example runtime, not a production queue system.
- It uses sequential processing even though `CONCURRENCY` is parsed; keep `CONCURRENCY=1` until a durable lock/lease is added.
- It stores deliverable/proof URIs as deterministic URNs. Production workers should upload artifacts to a durable content-addressed store first.
- The creator role does not implement browser x402 payment; it is intentionally API-first and disabled by default.
