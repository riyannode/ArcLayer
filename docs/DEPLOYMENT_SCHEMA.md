# Deployment Schema

Canonical migration apply order, required tables/columns/RPC functions, and health check for ArcLayer production.

## Apply Order

Migrations live in `supabase/migrations/`. Apply in timestamp order:

```
supabase/migrations/
├── 20250101000000_initial_schema.sql
├── 20250201000000_erc8183_jobs.sql
├── 20250301000000_x402_native_payments.sql
├── 20250302000000_x402_gateway_payments.sql
├── 20250303000000_x402_gateway_rpc_functions.sql
├── 20250304000000_bridge_session_summary.sql   (if applicable)
└── ...
```

Run:
```bash
supabase migration up --linked
```

## Required Tables

| Table | Purpose |
|-------|---------|
| `agent_jobs` | Core job table (dual-rail: x402_offchain + erc8183_escrow) |
| `agent_bridge_events` | Bridge event log |
| `agent_bridge_receipts` | Bridge payment receipts |
| `external_agent_runtimes` | External PM2 agent registration |
| `x402_resource_payments` | x402 resource-based payments |
| `x402_native_payments` | x402 native (exact) payments |
| `x402_gateway_payments` | x402 Circle Gateway payments |

## Required Additional Columns

On `agent_jobs`:

| Column | Type | Purpose |
|--------|------|---------|
| `settlement_mode` | `text NOT NULL DEFAULT 'x402_offchain'` | Rail selector |
| `erc8183_job_id` | `text` | On-chain ERC-8183 job ID |
| `erc8183_status` | `text` | Escrow lifecycle status |
| `client_address` | `text` | Buyer on-chain address |
| `provider_address` | `text` | Provider on-chain address |
| `evaluator_address` | `text` | Evaluator on-chain address |
| `hook_address` | `text` | Hook contract address |
| `expired_at_unix` | `text` | Job expiry |
| `price_atomic` | `text` | Price in atomic units |
| `description` | `text` | Job description |
| `result_payload` | `jsonb` | Worker result |
| `result_payload_hash` | `text` | Hash of result |
| `proof_payload` | `jsonb` | Proof data |
| `proof_payload_hash` | `text` | Hash of proof |
| `deliverable_hash` | `text` | Deliverable hash |
| `reason_hash` | `text` | Completion reason hash |
| `create_tx_hash` | `text` | createJob tx hash |
| `set_budget_tx_hash` | `text` | setBudget tx hash |
| `approve_tx_hash` | `text` | USDC approve tx hash |
| `fund_tx_hash` | `text` | fund tx hash |
| `submit_tx_hash` | `text` | submit tx hash |
| `complete_tx_hash` | `text` | complete tx hash |

## Required RPC Functions

These are SQL functions (not tables), called via `supabase.rpc()`:

| Function | Purpose |
|----------|---------|
| `x402_native_claim_payment` | Reserve native x402 payment before on-chain check |
| `x402_native_consume_payment` | Finalize native x402 payment |
| `x402_gateway_claim_settlement` | Reserve gateway settlement |
| `x402_gateway_consume_payment` | Finalize gateway payment |

## Verification

### Via API

```bash
curl https://www.arclayers.xyz/api/health/schema
```

Expected healthy response:
```json
{
  "ok": true,
  "status": "healthy",
  "columns": { "checked": ..., "passed": ..., "missing": [] },
  "rpcFunctions": { "checked": 4, "passed": 4, "missing": [] }
}
```

### Via CLI

```bash
SUPABASE_PROJECT_REF=<ref> SUPABASE_SERVICE_ROLE_KEY=<key> npm run check:schema
```

Expected: exits 0 with all ✅.

## Failure Remediation

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Column missing | Migration not applied | Run missing migration |
| RPC function missing | Migration not applied | Run RPC migration SQL |
| Management API unavailable | Wrong SUPABASE_PROJECT_REF or key | Verify env vars |
| 500 response | Service key missing from env | Set SUPABASE_SERVICE_ROLE_KEY |

## Bridge Session Summary (optional)

If high-volume agent bridge traffic requires efficient session listing, create:

```sql
CREATE OR REPLACE VIEW bridge_session_summary AS
SELECT
  session_id,
  COUNT(*) AS event_count,
  MIN(created_at) AS first_event_at,
  MAX(created_at) AS last_event_at
FROM agent_bridge_events
GROUP BY session_id;
```
