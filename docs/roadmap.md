# ArcLayer Roadmap

Current phase: MCP post-mint onboarding complete. Moving to E2E validation and ERC-8183 MCP surface.

---

## Completed

**PR #450 — MCP Core Registry**
Refactored /api/mcp into registry/server/errors/redact. Canonical tools + legacy aliases.

**PR #451 — MCP Sessions + Agent Account Backend**
MCP session table, Bearer-only auth, Agent Account binding, no autoApprove.

**PR #452 — Approval Engine + Policy**
mcp_action_approvals table, policy checks, no backend signing, atomic transitions.

**PR #453 — ERC-8004 Identity MCP Tools**
identity.get_agent_account, prepare_register, request_approval, get_status. approvalUrl flow.

**PR #454 — Profile + Agent Account**
/profile: Owner EOA, Circle Agent Account, balances, agent list. Dual-controller loading.

**PR #455 — Approval Deep Link + Circle Executor**
/mcp/approvals/[id] page. Circle passkey execution. Server-side receipt verification.

**PR #456 — API Key Tools + Prompt Template**
provider.create_api_key, list, revoke. /profile MCP Prompt Template selector. README/docs refresh.

---

## Next

**PR #457 — E2E Test Harness**
Prove full MCP onboarding path. Tests for identity + API key tools. Negative tests: auth, injection, ownership, revoked keys. No new product features.

**PR #458 — Agent Account Funding UX**
Improve /profile funding center. Owner/Agent balances, deposit address, clear instructions. No backend custody.

**PR #459 — MCP ERC-8183 Read + Prepare Tools v1**
jobs.list_public, client.prepare_create_job_for_session, provider.prepare_claim/submit. Tx instructions only.

**PR #460 — ERC-8183 Approval Deep Links**
Extend approvalUrl pattern to job actions. Approval summary with action, jobId, amounts. Server-side receipt confirm.

**PR #461 — x402 MCP Tools**
x402.supported, resource_requirements. Dual rails: Arc Native EIP-3009 + Circle Gateway batched. No settlement bypass.

**PR #462 — Evaluator Role + Template**
Evaluator Bot template in /profile + evaluator preset in MCP API key tools. Only after provider/client stable.
