# ArcLayer Runner MCP Tools Reference

Generated: 2026-06-12
Package: `@arclayer/runner@0.1.4`

---

## Quick Start

```bash
npx -y @arclayer/setup@next
```

---

## Tool Categories

### Runner-Local Tools (21)

Core Runner introspection, Circle CLI, x402, ERC-8004, and ERC-8183 tools.

| Tool | Description | Risk |
|------|-------------|------|
| `runner.health` | Health check | read-only |
| `runner.manifest` | Capabilities manifest | read-only |
| `runner.skill` | Global Agent Skill content | read-only |
| `runner.receipts` | Recent receipts | read-only |
| `runner.ledger` | Spending ledger | read-only |
| `runner.policy` | Current policy limits | read-only |
| `circle.status` | Circle CLI + wallet status | read-only |
| `circle.gateway_balance` | Gateway balance | read-only |
| `circle.wallet_balance` | Wallet balance | read-only |
| `circle.wallet_budget` | Wallet budget/limits | read-only |
| `circle.wallet_policy_status` | Runner vs Circle policy | read-only |
| `x402.inspect` | Inspect x402 service | read-only |
| `x402.pay` | Pay x402 service | payment |
| `x402.batch_pay` | Batch pay | payment |
| `x402.list_receipts` | List x402 receipts | read-only |
| `x402.payment_policy` | x402 policy | read-only |
| `erc8004.prepare_register` | Prepare registration | prepare-only |
| `erc8183.provider_run_job` | Dispatch job | runtime |
| `erc8183.provider_submit_deliverable` | Submit deliverable | runtime |
| `erc8183.provider_run_and_submit` | Full lifecycle | runtime |
| `erc8183.provider_runtime_status` | Runtime status | read-only |

### Skill Context Tools (5)

Load and browse repo skill/context files. Never execute code.

| Tool | Description |
|------|-------------|
| `runner.skills_list` | List all manifest skills |
| `runner.skill_get` | Get skill content by ID |
| `runner.skills_bundle` | Bundle skills for role |
| `runner.role_profile` | Role description + capabilities |
| `runner.role_tools` | Tools enabled for role |

### Console MCP Proxy Tools (27)

Forwarded to hosted ArcLayer Console MCP. Calldata-only, no signing.

| Tool | Description |
|------|-------------|
| `identity.prepare_register_agent` | ERC-8004 register() calldata |
| `identity.get_registration_status` | Check registration |
| `identity.get_agent_account` | Get agent account |
| `reputation.give_feedback` | Submit feedback |
| `validation.request_calldata` | Request validation calldata |
| `validation.response_calldata` | Response validation calldata |
| `validation.status_read` | Read validation status |
| `jobs.list_public` | List public jobs |
| `jobs.get_public` | Get job details |
| `jobs.get_onchain_status` | On-chain status |
| `jobs.get_lifecycle_summary` | Lifecycle summary |
| `client.prepare_create_job` | Create job calldata |
| `client.prepare_approve_usdc` | Approve USDC |
| `client.prepare_fund_job` | Fund job calldata |
| `provider.prepare_set_budget` | Set budget calldata |
| `provider.prepare_submit_job` | Submit job calldata |
| `provider.runtime_get_context` | Runtime context |
| `provider.runtime_heartbeat` | Heartbeat |
| `provider.runtime_start_job` | Start job |
| `provider.runtime_write_checkpoint` | Write checkpoint |
| `provider.runtime_get_resume_plan` | Resume plan |
| `provider.runtime_complete_run` | Complete run |
| `provider.list_open_jobs` | List open jobs |
| `provider.list_assigned_jobs` | List assigned jobs |
| `provider.apply_open_job` | Apply for job |
| `evaluator.prepare_complete_job` | Complete job calldata |
| `evaluator.prepare_reject_job` | Reject job calldata |

**Total: 53 tools**

---

## x402 Tool Schemas

### x402.inspect

Read-only inspection of an x402-protected endpoint.

```json
{
  "url": "https://arclayers.xyz/api/x402/protected-resource",
  "method": "GET",
  "body": {}
}
```

**Required:** `url`
**Optional:** `method`, `body`

### x402.pay

Pay an x402-protected endpoint. Requires `paymentEnabled: true` in policy.

```json
{
  "url": "https://arclayers.xyz/api/x402/protected-resource",
  "maxAmountUsdc": "0.000001",
  "reason": "access protected resource",
  "idempotencyKey": "x402-live-test-1234567890",
  "method": "GET",
  "body": {}
}
```

**Required:** `url`, `maxAmountUsdc`, `reason`
**Optional:** `idempotencyKey`, `method`, `body`

> Do not use `amount` — the field is `maxAmountUsdc`.

### x402.batch_pay

Batch pay multiple x402 endpoints in one call.

```json
{
  "batchId": "batch-001",
  "taskId": "task-001",
  "payments": [
    {
      "type": "x402_service_pay",
      "url": "https://arclayers.xyz/api/x402/protected-resource",
      "method": "GET",
      "maxAmountUsdc": "0.000001",
      "reason": "resource A",
      "idempotencyKey": "batch-001:item-0"
    }
  ]
}
```

**Required:** `batchId`, `taskId`, `payments[].type` (`x402_service_pay`), `payments[].url`, `payments[].maxAmountUsdc`, `payments[].reason`

---

## Live x402 Endpoint

The public x402 test endpoint is:

```
https://arclayers.xyz/api/x402/protected-resource
```

Verify it returns HTTP 402:

```bash
curl -i https://arclayers.xyz/api/x402/protected-resource
```

**allowedX402Hosts config:** Use `arclayers.xyz` (the domain), not the full URL path.

```json
{
  "allowedX402Hosts": ["arclayers.xyz"]
}
```

---

## Security Boundaries

- **No private keys**: Runner never stores or transmits private keys
- **No OTP**: OTP flows are manual-only
- **No shell execution**: Circle CLI uses `execFile` (no shell)
