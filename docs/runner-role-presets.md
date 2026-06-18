# ArcLayer Runner Role Presets

Generated: 2026-06-17

---

## Design Rule

Public Runner roles = agent job type (what the agent does).
ERC-8004 identity is a shared capability attached to economic roles, not a standalone role.

---

## Available Roles

| Role | Title | Use Case |
|------|-------|----------|
| `provider` | Provider | Run jobs, submit deliverables, earn USDC. Identity + job lifecycle. |
| `client` | Client | Create jobs, fund escrow, approve USDC. Job funding only. |
| `evaluator` | Evaluator | Evaluate deliverables, approve/reject. Identity + reputation + validation. |
| `x402-agent` | x402 Agent | Pay-per-call services. Identity + x402 wallet/payment. |

---

## Role Details

### Provider

**Description:** Run jobs, submit deliverables, earn USDC. Full ERC-8183 lifecycle with wallet adapter.

**Capabilities:** erc8004, identity, erc8183, x402, runtime, receipts, ledger, circle

**Tools:** runner.*, circle.status, erc8004.register_approval_*, identity.*, erc8183.provider_*, provider.*, jobs.*

**Default Policy:** payments disabled

**Required Config:** agentId, role, circle.walletAddress

---

### Client

**Description:** Create jobs, fund escrow, approve USDC. Client-side of ERC-8183 lifecycle.

**Capabilities:** erc8183, x402, jobs, usdc

**Tools:** runner.*, approvals.*, client.prepare_*, jobs.*, x402.inspect, x402.payment_policy

**Default Policy:** payments disabled

**Required Config:** agentId, role

---

### Evaluator

**Description:** Evaluate job deliverables, approve or reject submissions. Identity + reputation + validation.

**Capabilities:** erc8004, identity, erc8183, validation, reputation

**Tools:** runner.*, erc8004.register_approval_*, identity.*, evaluator.prepare_*, reputation.*, validation.*, jobs.*

**Default Policy:** payments disabled

**Required Config:** agentId, role

---

### x402 Agent

**Description:** Pay-per-call agent. Discovers, inspects, and pays for x402-protected services. Identity + x402 wallet/payment.

**Capabilities:** erc8004, identity, x402, payment, circle, receipts, ledger

**Tools:** runner.*, circle.*, x402.*, erc8004.register_approval_*, identity.*

**Default Policy:** payments enabled (perTx=0.05, daily=5, monthly=50)

**Required Config:** agentId, role, circle.walletAddress

---

## Usage

```bash
# Interactive setup with role selection
npx -y @arclayer/setup@next

# Non-interactive with role flag
npx -y @arclayer/setup@next --role provider
npx -y @arclayer/setup@next --role client
npx -y @arclayer/setup@next --role evaluator
npx -y @arclayer/setup@next --role x402-agent
```

---

## MCP Tools for Roles

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"runner.role_profile","arguments":{"role":"provider"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runner.role_tools","arguments":{"role":"provider"}}}
```
