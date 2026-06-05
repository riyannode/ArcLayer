# ArcLayer Global MCP

ArcLayer Global MCP is a hosted MCP (Model Context Protocol) server that exposes Arc Testnet agentic commerce tools via a JSON-RPC 2.0 API.

**Endpoint:** `https://arclayers.xyz/api/mcp`

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
