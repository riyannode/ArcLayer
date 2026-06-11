# ArcLayer Runner Role Presets

Generated: 2026-06-12

---

## Available Roles

| Role | Title | Use Case |
|------|-------|----------|
| `provider` | Provider | Run jobs, submit deliverables, earn USDC |
| `client` | Client | Create jobs, fund escrow, approve USDC |
| `evaluator` | Evaluator | Evaluate deliverables, approve/reject |
| `x402-agent` | x402 Agent | Pay-per-call services |
| `identity-agent` | Identity Agent | ERC-8004 identity management |
| `validation-agent` | Validation Agent | Validate agent work |
| `devops-admin` | DevOps Admin | Infrastructure management |
| `full-stack-agent` | Full-Stack Agent | All capabilities |

---

## Role Details

### Provider

**Description:** Run jobs, submit deliverables, earn USDC. Full ERC-8183 lifecycle with Circle CLI adapter.

**Capabilities:** erc8183, erc8004, x402, runtime, receipts, ledger, circle

**Tools:** 40+ tools including runner.*, circle.*, erc8183.*, provider.*, jobs.*

**Default Policy:** payments disabled

**Required Config:** agentId, role, circle.walletAddress

---

### Client

**Description:** Create jobs, fund escrow, approve USDC. Client-side of ERC-8183 lifecycle.

**Capabilities:** erc8183, x402, jobs, usdc

**Tools:** runner.*, client.prepare_*, jobs.*

**Default Policy:** payments disabled

**Required Config:** agentId, role

---

### Evaluator

**Description:** Evaluate job deliverables, approve or reject submissions.

**Capabilities:** erc8183, validation, reputation

**Tools:** runner.*, evaluator.prepare_*, validation.status_read, jobs.*

**Default Policy:** payments disabled

**Required Config:** agentId, role

---

### x402 Agent

**Description:** Pay-per-call agent. Discovers, inspects, and pays for x402-protected services.

**Capabilities:** x402, payment, circle, receipts, ledger

**Tools:** runner.*, circle.*, x402.*

**Default Policy:** payments enabled (perTx=0.05, daily=5, monthly=50)

**Required Config:** agentId, role, circle.walletAddress

---

### Identity Agent

**Description:** Manage ERC-8004 agent identity, registration, reputation, and validation.

**Capabilities:** erc8004, identity, reputation, validation

**Tools:** runner.*, erc8004.prepare_register, identity.*, reputation.*, validation.*

**Default Policy:** payments disabled

**Required Config:** agentId, role

---

### Validation Agent

**Description:** Validate agent work, submit validation results.

**Capabilities:** validation, erc8004

**Tools:** runner.*, validation.*

**Default Policy:** payments disabled

**Required Config:** agentId, role

---

### DevOps Admin

**Description:** Infrastructure management, health checks, policy inspection.

**Capabilities:** health, policy, skills, doctor, install

**Tools:** runner.health, runner.manifest, runner.policy, runner.skills_*, circle.status

**Default Policy:** payments disabled

**Required Config:** agentId, role

---

### Full-Stack Agent

**Description:** All capabilities enabled. For advanced users.

**Capabilities:** all

**Tools:** * (wildcard)

**Default Policy:** payments enabled (perTx=0.10, daily=10, monthly=100)

**Required Config:** agentId, role, circle.walletAddress

---

## Usage

```bash
# Interactive setup with role selection
npx -y @arclayer/setup@next

# Non-interactive with role flag
npx -y @arclayer/setup@next --role provider
npx -y @arclayer/setup@next --role evaluator
npx -y @arclayer/setup@next --role x402-agent
npx -y @arclayer/setup@next --role identity-agent
npx -y @arclayer/setup@next --role devops-admin
```

---

## MCP Tools for Roles

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"runner.role_profile","arguments":{"role":"provider"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runner.role_tools","arguments":{"role":"provider"}}}
```
