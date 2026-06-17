# ArcLayer Runner MCP — Tool & Skill Inventory

Generated: 2026-06-12
Purpose: Classify all repo tools/skills/docs for Runner MCP expansion.

---

## Classification Legend

| Category | Description |
|----------|-------------|
| `ACTIVE_RUNNER_LOCAL_TOOL` | Currently implemented in Runner MCP (PR #512) |
| `ACTIVE_CONSOLE_MCP_TOOL` | Implemented in Console MCP server |
| `SAFE_SKILL_CONTEXT` | Markdown/doc file — safe to load as context |
| `ROLE_PRESET_CANDIDATE` | Tool should be enabled for specific roles |
| `LEGACY_ADVANCED` | Old path, kept for advanced users |
| `LEGACY_DEPRECATE_LATER` | Will be deprecated after UI migration |
| `DEV_TEST_ONLY` | Test files, not for production |
| `UNSAFE_DO_NOT_EXPOSE` | Must never be exposed as MCP tool |
| `UNKNOWN_NEEDS_REVIEW` | Needs manual review |

---

## A. Runner-Local Tools (PR #512 — ACTIVE_RUNNER_LOCAL_TOOL)

| Tool | File | Purpose | Risk | Role |
|------|------|---------|------|------|
| `runner.health` | mcp-schemas.ts | Health check | read-only | all |
| `runner.manifest` | mcp-schemas.ts | Capabilities manifest | read-only | all |
| `runner.skill` | mcp-schemas.ts | Global Agent Skill content | read-only | all |
| `runner.receipts` | mcp-schemas.ts | Recent receipts | read-only | all |
| `runner.ledger` | mcp-schemas.ts | Spending ledger | read-only | all |
| `runner.policy` | mcp-schemas.ts | Current policy limits | read-only | all |
| `circle.status` | mcp-schemas.ts | Circle CLI + wallet status | read-only | provider, x402-agent |
| `circle.gateway_balance` | mcp-schemas.ts | Gateway balance | read-only | provider, x402-agent |
| `circle.wallet_balance` | mcp-schemas.ts | Wallet balance | read-only | provider, x402-agent |
| `circle.wallet_budget` | mcp-schemas.ts | Wallet budget/limits | read-only | provider, x402-agent |
| `circle.wallet_policy_status` | mcp-schemas.ts | Runner vs Circle policy comparison | read-only | provider, x402-agent |
| `x402.inspect` | mcp-schemas.ts | Inspect x402 service (no payment) | read-only | all |
| `x402.pay` | mcp-schemas.ts | Pay x402 service | payment | x402-agent |
| `x402.batch_pay` | mcp-schemas.ts | Batch pay multiple x402 | payment | x402-agent |
| `x402.list_receipts` | mcp-schemas.ts | List x402 receipts | read-only | all |
| `x402.payment_policy` | mcp-schemas.ts | Current x402 policy | read-only | all |
| `erc8004.prepare_register` | mcp-schemas.ts | Prepare ERC-8004 registration | prepare-only | provider, evaluator, x402-agent |
| `erc8183.provider_run_job` | mcp-schemas.ts | Dispatch job to runtime | runtime | provider |
| `erc8183.provider_submit_deliverable` | mcp-schemas.ts | Submit deliverable on-chain | runtime | provider |
| `erc8183.provider_run_and_submit` | mcp-schemas.ts | Full lifecycle run+submit | runtime | provider |
| `erc8183.provider_runtime_status` | mcp-schemas.ts | Runtime context from hosted MCP | read-only | provider |

**Count: 21 tools**

---

## B. Console MCP Tools (ACTIVE_CONSOLE_MCP_TOOL)

Source: `apps/console/src/lib/mcp/server.ts`

### Identity (ERC-8004)
| Tool | Purpose | Safe to proxy |
|------|---------|---------------|
| `identity.prepare_register_agent` | ERC-8004 register() calldata | ✅ |
| `identity.prepare_register_agent_for_session` | Session-bound register | ✅ |
| `identity.request_register_agent_approval` | Approval URL | ✅ |
| `identity.get_registration_status` | Check registration | ✅ |
| `identity.get_agent_account` | Get agent account | ✅ |

### Reputation
| Tool | Purpose | Safe to proxy |
|------|---------|---------------|
| `reputation.give_feedback` | Submit feedback | ✅ |

### Validation
| Tool | Purpose | Safe to proxy |
|------|---------|---------------|
| `validation.request_calldata` | Request validation calldata | ✅ |
| `validation.response_calldata` | Response validation calldata | ✅ |
| `validation.status_read` | Read validation status | ✅ |

### Jobs (ERC-8183)
| Tool | Purpose | Safe to proxy |
|------|---------|---------------|
| `jobs.list_public` | List public jobs | ✅ |
| `jobs.get_public` | Get job details | ✅ |
| `jobs.get_onchain_status` | On-chain job status | ✅ |
| `jobs.get_lifecycle_summary` | Job lifecycle summary | ✅ |

### Client
| Tool | Purpose | Safe to proxy |
|------|---------|---------------|
| `client.prepare_create_job` | Create job calldata | ✅ |
| `client.prepare_create_job_for_session` | Session-bound create | ✅ |
| `client.prepare_create_open_job_for_session` | Open job create | ✅ |
| `client.prepare_set_provider_for_session` | Set provider | ✅ |
| `client.prepare_approve_usdc` | Approve USDC | ✅ |
| `client.prepare_fund_job` | Fund job calldata | ✅ |
| `client.prepare_fund_job_bundle_for_session` | Bundle fund | ✅ |
| `client.prepare_reject_job_for_session` | Reject job | ✅ |
| `client.prepare_claim_refund_for_session` | Claim refund | ✅ |
| `client.get_signing_request_status` | Signing status | ✅ |
| `client.request_*_web_sign` | Web signing requests | ✅ |

### Provider
| Tool | Purpose | Safe to proxy |
|------|---------|---------------|
| `provider.prepare_set_budget` | Set budget calldata | ✅ |
| `provider.prepare_set_budget_for_session` | Session-bound budget | ✅ |
| `provider.prepare_submit_job` | Submit job calldata | ✅ |
| `provider.prepare_submit_job_for_session` | Session-bound submit | ✅ |
| `provider.runtime_get_context` | Runtime context | ✅ |
| `provider.runtime_heartbeat` | Runtime heartbeat | ✅ |
| `provider.runtime_start_job` | Start job | ✅ |
| `provider.runtime_write_checkpoint` | Write checkpoint | ✅ |
| `provider.runtime_get_resume_plan` | Resume plan | ✅ |
| `provider.runtime_complete_run` | Complete run | ✅ |
| `provider.runtime_retry_job` | Retry job | ✅ |
| `provider.list_open_jobs` | List open jobs | ✅ |
| `provider.list_assigned_jobs` | List assigned jobs | ✅ |
| `provider.apply_open_job` | Apply for job | ✅ |
| `provider.list_my_open_job_applications` | List applications | ✅ |
| `provider.withdraw_open_job_application` | Withdraw application | ✅ |
| `provider.create_api_key` | Create API key | ⚠️ |
| `provider.list_api_keys` | List API keys | ⚠️ |
| `provider.revoke_api_key` | Revoke API key | ⚠️ |

### Evaluator
| Tool | Purpose | Safe to proxy |
|------|---------|---------------|
| `evaluator.prepare_complete_job` | Complete job calldata | ✅ |
| `evaluator.prepare_complete_job_for_session` | Session-bound complete | ✅ |
| `evaluator.prepare_reject_job` | Reject job calldata | ✅ |
| `evaluator.prepare_reject_job_for_session` | Session-bound reject | ✅ |

### Onboarding
| Tool | Purpose | Safe to proxy |
|------|---------|---------------|
| `onboarding.start_agent_bundle` | Start agent bundle | ✅ |
| `onboarding.get_agent_bundle_status` | Bundle status | ✅ |
| `onboarding.list_role_presets` | List role presets | ✅ |
| `onboarding.create_registration_draft` | Registration draft | ✅ |
| `onboarding.create_agent_runtime_key` | Runtime key | ⚠️ |

### Protocol
| Tool | Purpose | Safe to proxy |
|------|---------|---------------|
| `protocol.status` | Protocol status | ✅ |
| `protocol.health` | Protocol health | ✅ |

### Discovery
| Tool | Purpose | Safe to proxy |
|------|---------|---------------|
| `agents.discover` | Discover agents | ✅ |
| `agents.get` | Get agent details | ✅ |

### Docs
| Tool | Purpose | Safe to proxy |
|------|---------|---------------|
| `docs.arc_search` | Search Arc docs | ✅ |

**Count: 61 Console MCP tools**

---

## C. Safe Skill Context Files (SAFE_SKILL_CONTEXT)

| Path | Exists | Purpose | Roles |
|------|--------|---------|-------|
| `docs/ARCLAYER_GLOBAL_AGENT_SKILL.md` | ✅ | Canonical platform behavior rules | all |
| `docs/AUTONOMOUS_AGENT_BUSINESS_LOOP_SKILL.md` | ✅ | Business loop patterns | provider, client |
| `docs/ARCLAYER_INTEGRATION_SKILL.md` | ✅ | Integration guide | all |
| `docs/global-mcp.md` | ✅ | MCP tool reference | all |
| `AGENTS.md` | ✅ | Repo operating guide | all |
| `packages/mcp-connect/plugin/skills/arclayer-global-agent-commerce/SKILL.md` | ✅ | Packaged plugin mirror | all |
| `packages/mcp-connect/plugin/skills/arclayer-agent-bundle/SKILL.md` | ✅ | Agent bundle skill | all |
| `docs/mcp-erc8004-identity-tools.md` | ✅ | ERC-8004 MCP tools | provider, evaluator, x402-agent |
| `docs/x402-payment-flow.md` | ✅ | x402 payment flow | x402-agent |
| `docs/x402-agent-payer-binding.md` | ✅ | x402 payer binding | x402-agent |
| `docs/provider-runtime-memory.md` | ✅ | Provider runtime memory | provider |

**Count: 11 skill context files**

---

## D. Legacy / Advanced (LEGACY_ADVANCED)

| Path | Purpose | Status | Reason |
|------|---------|--------|--------|
| `packages/mcp-connect/` | MCP connect plugin | KEEP_ACTIVE | Used by arclayer-codex |
| `packages/mcp-connect/arclayer-codex-0.1.0.tgz` | Codex package | KEEP_ACTIVE | UI still uses `npx arclayer-codex@latest` |
| `packages/mcp-connect/arclayer-mcp-connect-0.1.0.tgz` | MCP connect package | KEEP_ACTIVE | Codex depends on it |

---

## E. Test / Dev Only (DEV_TEST_ONLY)

| Path | Purpose |
|------|---------|
| `apps/arclayer-runner/src/*.test.ts` | Runner unit tests |
| `apps/console/src/lib/mcp/*.test.ts` | Console MCP tests |
| `apps/console/src/lib/contracts/erc8004.test.ts` | ERC-8004 contract tests |
| `apps/console/src/lib/x402/exact/__tests__/*` | x402 integration tests |
| `packages/runner-core/src/*.test.ts` | Runner-core tests |
| `packages/circle-cli-adapter/src/*.test.ts` | Circle CLI adapter tests |

---

## F. Unsafe (UNSAFE_DO_NOT_EXPOSE)

| Item | Reason |
|------|--------|
| Shell commands from SKILL.md | Never execute markdown as code |
| `.env` files | Contains secrets |
| `process.env` | Must never be exposed |
| Private key material | Must never be stored/transmitted |
| OTP flows | Must never pass through agent |
| Circle session tokens | Must never be stored |
| `circle wallet login` | Manual only |
| `circle wallet limit set` | Manual only |

---

## Summary

| Category | Count |
|----------|-------|
| Runner-Local Tools | 21 |
| Console MCP Tools (proxyable) | 61 |
| Safe Skill Context Files | 11 |
| Legacy/Advanced | 7 |
| Dev/Test Only | 6+ |
| Unsafe | 8 rules |

---

## Recommended New Runner MCP Tools

### Skill Context Tools (Phase 3)
- `runner.skills_list` — List all manifest skills
- `runner.skill_get` — Get skill content by ID
- `runner.skills_bundle` — Bundle skills for role
- `runner.role_profile` — Role description + capabilities
- `runner.role_tools` — Tools enabled for role

### Console MCP Proxy Tools (Phase 6 — selected)
Initial proxy allowlist (safe, calldata-only):
- `identity.prepare_register_agent`
- `identity.get_registration_status`
- `identity.get_agent_account`
- `reputation.give_feedback`
- `validation.request_calldata`
- `validation.response_calldata`
- `validation.status_read`
- `jobs.list_public`
- `jobs.get_public`
- `jobs.get_onchain_status`
- `jobs.get_lifecycle_summary`
- `client.prepare_create_job`
- `client.prepare_approve_usdc`
- `client.prepare_fund_job`
- `provider.prepare_set_budget`
- `provider.prepare_submit_job`
- `provider.runtime_get_context`
- `provider.runtime_heartbeat`
- `provider.runtime_start_job`
- `provider.runtime_write_checkpoint`
- `provider.runtime_get_resume_plan`
- `provider.list_open_jobs`
- `provider.list_assigned_jobs`
- `provider.apply_open_job`
- `provider.runtime_complete_run`
- `evaluator.prepare_complete_job`
- `evaluator.prepare_reject_job`

**Total new proxy tools: 27**

**Grand total after expansion: 21 (local) + 5 (skill context) + 27 (proxy) = 53 tools**
