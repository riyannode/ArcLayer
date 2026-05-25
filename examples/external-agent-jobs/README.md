# External Agent Jobs — Fullcycle Example

Demonstrates complete agent job lifecycle with Arc native x402 settlement:

```
create → claim → running → submit → verify → settle (x402)
```

## Setup

```bash
cp .env.example .env
# Edit .env with your values
# Install dependencies
npm install
```

## Quick Demo

```bash
node fullcycle-demo.js
```

Creates, claims, runs, submits, verifies, and settles a job.
Settlement dry-run unless `LIVE_JOB_SETTLEMENT=true`.

## 24/7 Worker

```bash
node worker-24x7.js
```

Polls for available jobs, claims, runs, submits results.
Safe multi-process — atomic claim via `FOR UPDATE SKIP LOCKED`.

## Manual Steps

```bash
node create-job.js
node claim-once.js
node submit-job.js <jobId>
node verify-job.js <jobId>
# Dry-run settlement:
node settle-job.js <jobId>
# Live settlement:
LIVE_JOB_SETTLEMENT=true X402_PAYER_PRIVATE_KEY=0x... node settle-job.js <jobId>
```

## Live Settlement Env Vars

| Var | Required | Purpose |
|-----|----------|---------|
| `LIVE_JOB_SETTLEMENT=true` | yes | Activates live x402 payment |
| `X402_PAYER_PRIVATE_KEY` | yes | EOA private key for signing EIP-3009 |
| `ARCLAYER_API_KEY` | yes | Bearer token for API auth (required in live mode) |
| `BUYER_AGENT_ID` | optional | Override job.buyer_agent_id (defaults to loaded job) |
| `ARCLAYER_BASE_URL` | optional | Server URL (default: `http://localhost:3000`) |

### Live settlement flow

1. POST to `/api/agent-jobs/{jobId}/settle` without payment → 402 with `accepts`
2. Select Arc Native EIP-3009 requirement (`scheme: "exact"`, `network: "eip155:5042002"`)
3. Sign `TransferWithAuthorization` using `X402_PAYER_PRIVATE_KEY`
4. Second POST with `X-PAYMENT` header (base64 JSON payload)
5. Decode `PAYMENT-RESPONSE` base64url header → print `paymentId` + `txHash`
6. Exit non-zero if settlement fails or payment is rejected

## Status Flow

- `created` → `claimed` → `running` → `submitted` → `verified` → `settlement_pending` → `settled`
- `verified` → `failed` | `created` → `cancelled` | `created` → `expired`

## x402 Client

`shared/x402-client.js` provides reusable EIP-3009 signing and payment header construction (bounded logic from PM2 bot's x402-client.js). Used by `settle-job.js` for live settlements.

## Important

- Off-chain job settlement via x402 Arc-native USDC transfer. Updates Supabase job status + payment record.
- ERC-8183 on-chain completion is a separate lifecycle (A2A/on-chain work receipts).
- Duplicate settlement blocked by `x402_resource_payments` idempotency key.
- Arc native only — Circle Gateway support is experimental.
- X402_RECEIVER_ADDRESS must be set server-side (deployer responsibility).
- PR #204 bridge behavior unchanged.
