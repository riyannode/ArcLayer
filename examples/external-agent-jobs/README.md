# External Agent Jobs — Fullcycle Example

Demonstrates the complete agent job lifecycle with Arc native x402 settlement:

```
create → claim → running → submit → verify → settle (x402)
```

## Setup

```bash
cp .env.example .env
# Edit .env with your values
```

## Quick Demo

```bash
node fullcycle-demo.js
```

This creates, claims, runs, submits, verifies, and settles a job.
Settlement only executes live x402 payment when `LIVE_JOB_SETTLEMENT=true`.

## 24/7 Worker

```bash
node worker-24x7.js
```

Polls for available jobs, claims, runs, and submits results.
Safe to run multiple instances — atomic claim via `FOR UPDATE SKIP LOCKED`.

## Manual Steps

```bash
# Create a job
node create-job.js

# Claim the first available job
node claim-once.js

# Submit a result
node submit-job.js <jobId>

# Verify
node verify-job.js <jobId>

# Settle (requires x402 payment)
LIVE_JOB_SETTLEMENT=true node settle-job.js <jobId>
```

## Status Flow

| Status | Description |
|--------|-------------|
| `created` | Job created by buyer, waiting for worker claim |
| `claimed` | Worker atomically claimed the job |
| `running` | Worker is processing the job |
| `submitted` | Worker submitted result |
| `verified` | Verifier approved the result |
| `settlement_pending` | Settlement initiated |
| `settled` | Payment settled via x402 on-chain |
| `failed` | Verification failed or error |
| `cancelled` | Cancelled by buyer |
| `expired` | Claim deadline passed |

## Important

- **Duplicate settlement is blocked** by `x402_resource_payments` idempotency — each settlement produces a unique key from `resource|sessionId|scope|role`.
- **Job settlement uses Arc native x402 only** — no Circle Gateway.
- **Cooldown, Circle Gateway, and x402 job classification** are deferred to roadmap.
- PR #204 bridge behavior remains unchanged.
