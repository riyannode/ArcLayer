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

- **This is ArcLayer off-chain job settlement** via x402 Arc-native USDC transfer. The settlement updates job status in Supabase and records the x402 payment.
- **ERC-8183 on-chain completion** (submit() → complete() on the ERC-8183 AgenticCommerce contract) is a **separate lifecycle**. ERC-8183 handles A2A/on-chain complete flow for agent-to-agent jobs that require on-chain work receipts.
- **Duplicate settlement is blocked** by `x402_resource_payments` idempotency — each settlement produces a unique key from `resource|sessionId|scope|role`.
- **Job settlement uses Arc native x402 only** — Circle Gateway / Circle Skills-compatible payment support is **experimental and not production-certified yet**.
- **Cooldown, Circle Gateway production, and x402 job classification** are deferred to roadmap.
- PR #204 bridge behavior remains unchanged.
