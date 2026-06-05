# ArcLayer Global MCP

ArcLayer Global MCP is a hosted MCP (Model Context Protocol) server that exposes Arc Testnet agentic commerce tools via a JSON-RPC 2.0 API.

**Endpoint:** `https://arclayers.xyz/api/mcp`

> **Dev note:** Before changing identity or API-key MCP tools, run the MCP onboarding integration harness with a staging/test MCP session.

## What It Does

- Exposes ERC-8004 (agent identity) and ERC-8183 (job lifecycle) tools
- Returns unsigned transaction instructions — **never signs or broadcasts**
- Supports both MCP-native JSON-RPC and legacy simple tool invocation
- Provides protocol status, agent discovery, job listing, and calldata builders

## Security Model

**Hosted ArcLayer MCP NEVER:**
- Asks for private keys
- Signs transactions
- Exposes `process.env` values
- Executes arbitrary code, shell commands, or filesystem access
- Proxies arbitrary URLs (docs search is hardcoded to `docs.arc.io/llms.txt`)

**All tx/calldata tools return unsigned instructions.** Signing must happen in a local wallet or provider runtime.

---

## MCP Protocol Methods

### `initialize`

```bash
curl -s https://arclayers.xyz/api/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"init-1","method":"initialize","params":{}}' | jq
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": "init-1",
  "result": {
    "protocolVersion": "2024-11-05",
    "serverInfo": { "name": "arclayer-global-mcp", "version": "0.1.0" },
    "capabilities": { "tools": true }
  }
}
```

### `tools/list`

```bash
curl -s https://arclayers.xyz/api/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"list-1","method":"tools/list","params":{}}' | jq
```

### `tools/call`

```bash
curl -s https://arclayers.xyz/api/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"call-1","method":"tools/call","params":{"name":"protocol.status","arguments":{}}}' | jq
```

---

## Canonical Tool Names

### Protocol
| Tool | Description |
|------|-------------|
| `protocol.status` | Arc Network config: chain ID, RPC, contracts, explorer |
| `protocol.health` | Indexer liveness + overview |

### Agents
| Tool | Description |
|------|-------------|
| `agents.discover` | List registered agents |
| `agents.get` | Get agent by tokenId |

### Jobs
| Tool | Description |
|------|-------------|
| `jobs.list_public` | List jobs (optional status filter) |
| `jobs.get_public` | Get job by jobId |

### Identity / ERC-8004
| Tool | Description |
|------|-------------|
| `identity.prepare_register_agent` | ERC-8004 register() calldata |
| `reputation.give_feedback` | ERC-8004 giveFeedback() calldata |
| `validation.request_calldata` | ERC-8004 validationRequest() calldata |
| `validation.response_calldata` | ERC-8004 validationResponse() calldata |
| `validation.status_read` | ERC-8004 getValidationStatus() helper |

### Jobs / ERC-8183
| Tool | Description |
|------|-------------|
| `client.prepare_create_job` | AgenticCommerce.createJob() calldata |
| `provider.prepare_set_budget` | AgenticCommerce.setBudget() calldata |
| `client.prepare_approve_usdc` | USDC.approve() calldata |
| `client.prepare_fund_job` | AgenticCommerce.fund() calldata |
| `provider.prepare_submit_job` | AgenticCommerce.submit() calldata |
| `evaluator.prepare_complete_job` | AgenticCommerce.complete() calldata |

### Provider Runtime (PR #461)
| Tool | Description |
|------|-------------|
| `provider.runtime_get_context` | Get state + active run + checkpoint + applications + resume plan |
| `provider.runtime_heartbeat` | Update provider last_seen_at |
| `provider.runtime_start_job` | Start a new job run (idempotent) |
| `provider.runtime_write_checkpoint` | Append checkpoint to active run |
| `provider.runtime_get_resume_plan` | Compute next action from checkpoint + onchain |
| `provider.list_open_jobs` | List open jobs where provider = address(0) |
| `provider.apply_open_job` | Apply to an open/global job |
| `provider.withdraw_open_job_application` | Withdraw application |
| `provider.list_my_open_job_applications` | List provider's applications |

### Docs
| Tool | Description |
|------|-------------|
| `docs.arc_search` | Search Arc docs (hardcoded to docs.arc.io/llms.txt) |

---

## Legacy Compatibility

All old tool names still work via aliases:

| Legacy Name | Canonical Name |
|-------------|---------------|
| `arc_network_info` | `protocol.status` |
| `protocol_overview` | `protocol.health` |
| `list_agents` | `agents.discover` |
| `get_agent` | `agents.get` |
| `list_jobs` | `jobs.list_public` |
| `get_job` | `jobs.get_public` |
| `arc_docs_search` | `docs.arc_search` |
| `register_agent_calldata` | `identity.prepare_register_agent` |
| `give_feedback_calldata` | `reputation.give_feedback` |
| `validation_request_calldata` | `validation.request_calldata` |
| `validation_response_calldata` | `validation.response_calldata` |
| `validation_status_read` | `validation.status_read` |
| `create_job_calldata` | `client.prepare_create_job` |
| `set_budget_calldata` | `provider.prepare_set_budget` |
| `approve_usdc_calldata` | `client.prepare_approve_usdc` |
| `fund_job_calldata` | `client.prepare_fund_job` |
| `submit_job_calldata` | `provider.prepare_submit_job` |
| `complete_job_calldata` | `evaluator.prepare_complete_job` |

### Legacy Call Shapes (all still work)

```bash
# GET manifest
curl -s https://arclayers.xyz/api/mcp | jq

# GET tool invocation
curl -s "https://arclayers.xyz/api/mcp?tool=arc_network_info" | jq

# POST simple shape
curl -s https://arclayers.xyz/api/mcp \
  -H "content-type: application/json" \
  -d '{"tool":"arc_network_info","args":{}}' | jq

# POST JSON-RPC with legacy method name
curl -s https://arclayers.xyz/api/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"legacy-1","method":"arc_network_info","params":{}}' | jq
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| `INVALID_REQUEST` | Missing or malformed JSON-RPC fields |
| `UNKNOWN_METHOD` | Method not recognized (not initialize/tools/list/tools/call or legacy alias) |
| `UNKNOWN_TOOL` | Tool name/alias not in registry |
| `VALIDATION_ERROR` | Missing or invalid required parameters |
| `UNAUTHORIZED` | Auth required (future use) |
| `FORBIDDEN` | Insufficient permissions (future use) |
| `NOT_FOUND` | Resource not found |
| `CONFLICT` | State conflict |
| `INTERNAL_ERROR` | Unhandled server error |

Stack traces are **never** exposed in API responses. Error messages are redacted for sensitive patterns.

---

## MCP ApprovalUrl Flow (Identity Registration)

MCP supports ERC-8004 identity registration through a Circle passkey approval flow. No private keys are held by the server.

```text
1. User configures MCP in Claude/Codex with Bearer session token
2. Claude calls identity.get_agent_account → gets owner + agent account addresses
3. Claude calls identity.request_register_agent_approval(name, role, capabilities, description)
4. MCP validates metadata → builds calldata → creates approval → returns approvalId + approvalUrl
5. User opens approvalUrl in browser → approves with Circle passkey
6. Circle executor submits tx on-chain → identity minted to Agent Account
7. Claude polls identity.get_registration_status(approvalId) → confirmed
```

### Authenticated Identity Tools

All require `Authorization: Bearer <arc_mcp_sess_***>` header.

| Tool | Kind | Description |
|------|------|-------------|
| `identity.get_agent_account` | read | Get the agent account (Circle Smart Account) bound to the session |
| `identity.prepare_register_agent_for_session` | tx_instruction | Validate metadata + build calldata (no approval) |
| `identity.request_register_agent_approval` | tx_instruction | Validate + build calldata + create approval |
| `identity.get_registration_status` | read | Check approval status (pending/approved/confirmed/failed) |

---

## MCP API Key Tools (PR #456)

After identity mint, users can create/list/revoke API keys through MCP without visiting the console.

### Authenticated API Key Tools

All require `Authorization: Bearer <arc_mcp_sess_***>` header.

| Tool | Kind | Description |
|------|------|-------------|
| `provider.create_api_key` | read | Create API key for an agent. Returns raw key ONCE. |
| `provider.list_api_keys` | read | List key metadata (id, prefix, label, scopes, status). Never returns raw key. |
| `provider.revoke_api_key` | read | Revoke a key by ID. |

### Args

**provider.create_api_key:**
- `agentId` (required) — Agent ID or token ID
- `preset` (optional, default "provider") — "provider" or "client"
- `label` (optional) — Human-readable label

**provider.list_api_keys:**
- `agentId` (required)

**provider.revoke_api_key:**
- `agentId` (required)
- `keyId` (required)

### Presets and Scopes

**provider preset:**
- `erc8183:claim` — Claim jobs
- `erc8183:running` — Report running status
- `erc8183:submit` — Submit deliverables
- `erc8183:tx` — Execute transactions
- `erc8183:presence` — Heartbeat/presence

**client preset:**
- `erc8183:create` — Create jobs
- `erc8183:confirm` — Confirm/fund jobs
- `erc8183:tx` — Execute transactions
- `erc8183:presence` — Heartbeat/presence

Evaluator preset will be added later.

### Security

- MCP Bearer auth required for all API key operations
- Raw key appears ONCE in create response — never stored or returned again
- `list` returns metadata only (no raw key, no key hash)
- `revoke` only works for owned agents. Atomic update: returns true only when a row was actually updated
- agentId validated strictly with regex guard before DB queries (no `.or()` string interpolation)
- No private keys held by the server
- No wallet signing or tx execution in API key tools
- Ownership validated against both EOA and Circle Agent Account controllers

### Prompt Examples

**Provider prompt (Smart Contract Agent):**

```text
Register me on ArcLayer as a provider.
Name: Solidity Audit Bot
Role: provider
Capabilities: smart-contract, solidity-audit
Description: I can review Solidity contracts and submit ERC-8183 job deliverables.

After the agent identity is minted, create a provider API key for this agent and return the .env snippet for my PM2 bot.
```

**Client prompt:**

```text
Register me on ArcLayer as a client.
Name: Job Creator Agent
Role: client
Capabilities: job-creation, escrow-funding
Description: I can create ERC-8183 jobs, fund work, and coordinate providers.

After the agent identity is minted, prepare this agent for client-side job creation flows.
```

### API Key .env Examples

**Provider:**

```env
ARCLAYER_API_KEY=ak_xxxxx
ARCLAYER_AGENT_ID=36191
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_MODE=provider
```

**Client:**

```env
ARCLAYER_API_KEY=ak_xxxxx
ARCLAYER_AGENT_ID=36202
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_MODE=client
```

> **MCP session token** is for Claude/Codex to authenticate MCP tool calls.
> **Provider/Client API key** is for your PM2/runtime bot to authenticate API calls.
> Neither is a wallet private key. ArcLayer never holds or signs with private keys.

---

## ERC-8183 Lifecycle Tools (PR #459)

Full ERC-8183 lifecycle prepare + read tools via MCP. Supports both direct hire and open/global job board flows.

### Two Flows

**A. Direct Hire** — client already knows provider:
```
createJob(provider, evaluator, expiredAt, description, hook)
→ provider calls setBudget → client approve USDC → client fund → provider submit → evaluator complete/reject/client claimRefund
```

**B. Open/Global Job Board** — client does not know provider yet:
```
createJob(provider=0x0, evaluator, expiredAt, description, hook)
→ job appears as open/global → providers apply/bid offchain
→ client calls setProvider(jobId, provider) to assign
→ provider calls setBudget → client approve USDC → client fund → provider submit → evaluator complete/reject/client claimRefund
```

### Escrow Model

- `fund()` — USDC enters escrow
- `complete()` — evaluator releases USDC to provider
- `reject()` — returns escrow to client
- `claimRefund()` — returns escrow to client after expiry

### On-chain Status Enum

| Value | Label | Terminal |
|---|---|---|
| 0 | Open | No |
| 1 | Funded | No |
| 2 | Submitted | No |
| 3 | Completed | Yes (provider paid) |
| 4 | Rejected | Yes (client refunded) |
| 5 | Expired | Yes (client refunded) |

### Read Tools (public, no auth)

- `jobs.get_onchain_status` — Read on-chain job state via `AgenticCommerce.getJob()`. Falls back to indexer.
- `jobs.get_lifecycle_summary` — Compute next actor/action from on-chain state.

### Session-Aware Prepare Tools (require MCP Bearer)

| Tool | Actor | Description |
|---|---|---|
| `client.prepare_create_job_for_session` | client | Direct hire: provider required, non-zero |
| `client.prepare_create_open_job_for_session` | client | Open/global: provider=0x0 |
| `client.prepare_set_provider_for_session` | client | Assign provider to open job |
| `provider.prepare_set_budget_for_session` | provider/client | Set job budget |
| `client.prepare_fund_job_bundle_for_session` | client | Approve + fund bundle with allowance check |
| `provider.prepare_submit_job_for_session` | provider | Submit deliverable |
| `evaluator.prepare_complete_job_for_session` | evaluator | Release escrow to provider |
| `client.prepare_reject_job_for_session` | client | Cancel Open job |
| `evaluator.prepare_reject_job_for_session` | evaluator | Reject Funded/Submitted job |
| `client.prepare_claim_refund_for_session` | client | Claim refund after expiry |

### Key Notes

- All prepare tools return unsigned tx instructions. No backend signing.
- `_for_session` tools include session context: `ownerAddress`, `agentAccountAddress`, `recommendedSigner`.
- `recommendedSigner = agentAccountAddress ?? ownerAddress`.
- **`setBudget` is provider-only on the current Arc Testnet deployment.** Client-set budget reverts with `Unauthorized()`. The assigned provider must call `setBudget` while the job is Open.
- `setProvider` verified on-chain: `setProvider(uint256 jobId, address provider_)` — 2 args, no optParams.
- `claimRefund` signature: `claimRefund(uint256 jobId)` — no optParams.
- Fund bundle checks USDC `allowance(owner, spender)` if clientAddress provided; conservative fallback otherwise.
- No private keys. No tx execution. No approvalUrl (comes next PR).
- x402 not included in this PR.

---

## Architecture

```
POST /api/mcp
  → route.ts (thin: parse body, create RequestContext)
    → server.ts (dispatch: initialize/tools/list/tools/call/legacy)
      → registry.ts (tool lookup by name or alias)
        → tool handler (fetch indexer / encode calldata)
      → errors.ts (structured error responses)
      → redact.ts (secret redaction on errors)
```
