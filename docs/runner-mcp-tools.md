# ArcLayer Runner MCP Tools Reference

Generated: 2026-06-12
Package: `@arclayer/runner@0.1.2-beta.0`

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

## Security Boundaries

- **No private keys**: Runner never stores or transmits private keys
- **No OTP**: OTP flows are manual-only
- **No shell execution**: Circle CLI uses `execFile` (no shell)
- **Policy-gated payments**: x402.pay requires `paymentEnabled + wallet + limits`
- **Proxy allowlist**: Only 27 Console MCP tools are proxied
- **Arc/Circle separation**: Contract addresses from SDK constants only

---

## Arc/Circle Separation

```
circle.chain → Circle CLI wallet/payment operations only
CONTRACTS.ERC8183_AGENTIC_COMMERCE → Arc contract target (SDK constant)
```

`circle.chain` does NOT select Arc contract addresses.
