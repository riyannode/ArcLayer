# MCP ERC-8004 Identity Tools

## Overview

PR 453 adds 4 authenticated MCP tools for ERC-8004 identity registration via Claude/Codex.

## Product Model

- **Owner wallet/passkey** = user/admin
- **Agent Account** = Circle Smart Account / controller
- **ERC-8004 identity** minted TO Agent Account, NOT owner wallet
- MCP only prepares approval/calldata/status
- Actual signing/execution happens via frontend Circle passkey bridge (PR 454)

## Tools

### Existing (untouched)

| Tool | Auth | Description |
|------|------|-------------|
| `identity.prepare_register_agent` | No | Original calldata-only builder. `register_agent_calldata` alias stays here. |

### New (PR 453)

| Tool | Kind | Auth | Description |
|------|------|------|-------------|
| `identity.get_agent_account` | read | Bearer | Get agent account for session. Validates binding still active. |
| `identity.prepare_register_agent_for_session` | tx_instruction | Bearer | Validate metadata + build calldata. Validates binding active. |
| `identity.request_register_agent_approval` | tx_instruction | Bearer | Prepare + create approval in one call. Validates binding active. |
| `identity.get_registration_status` | read | Bearer | Get approval status by approvalId. Read-only, no binding check. |

### Aliases

| Alias | Points to |
|-------|-----------|
| `register_agent_calldata` | `identity.prepare_register_agent` (old, unauthenticated) |
| `register_agent_approval` | `identity.request_register_agent_approval` (new, authenticated) |

## Agent Account Source of Truth

- `session.agentAccountAddress` — set at session creation time, used in all tools
- `validateAgentAccountActive()` — confirms binding still active in DB (owner + address + status)
- Called in all tx tools (`prepare_for_session`, `request_approval`) and `get_agent_account`
- NOT called in `get_registration_status` (read-only, session-scoped)

## Metadata Validation

| Field | Rule |
|-------|------|
| name | required, max 128 chars |
| role | required: provider/client/evaluator/agent/oracle/analyzer/executor/worker/buyer/settler |
| capabilities | required, non-empty array, max 20 items |
| description | required, max 1024 chars |
| endpoint | optional, must be valid URL |
| payload | max 8192 chars total |

## Metadata URI

- Scheme: `arclayer://mcp/identity/<keccak256_hash>`
- JSON stored in approval `summary_json`
- **Limitation:** Not durably stored (no IPFS/HTTPS). PR 454+ should add durable storage.

## Security

- All new tools require MCP Bearer token
- `validateAgentAccountActive()` checks owner + address + status before tx tools
- Policy enforced internally by `createApproval()`
- Calldata selector verified: `0x46d7c549`
- toAddress from `CONTRACTS.ERC8004_IDENTITY_REGISTRY`
- No tx execution, no private keys, no backend signing
- controllerAddress = session.agentAccountAddress in all outputs

## File Structure

```
apps/console/src/lib/mcp/
  identity-tools.ts  — 4 tool implementations + metadata validation + calldata builder
  registry.ts        — RequestContext extended with authorization field
  server.ts          — 4 new tools registered, existing tools preserved

apps/console/src/lib/agent-accounts/
  store.ts           — getActiveAgentAccountForOwnerAndAddress() helper added

apps/console/src/app/api/mcp/
  route.ts           — authorization header passed to RequestContext
```
