# MCP Session + Agent Account Backend

## Overview

PR 451 adds the data layer for MCP sessions and agent account bindings.

- **Agent accounts** bind an owner wallet (user/passkey) to a Circle Smart Account (the agent account/controller).
- **MCP sessions** authenticate Claude/Codex callers against ArcLayer's MCP tools with scoped permissions.
- **No tx execution** — this PR is data-only. Approval engine comes in PR 452.

## Architecture

```
User (wallet session cookie)
  → POST /api/mcp/sessions/create { agentAccountAddress }
  → Upserts agent account binding (owner → Circle Smart Account)
  → Creates MCP session (autoApprove forced false)
  → Returns raw token ONCE + Claude config
  → User pastes token into Claude Desktop config
  → Claude calls /api/mcp with Authorization: Bearer token
  → session-auth.ts resolves token → McpSession
  → Tool handler checks permissions
```

## Tables

### arclayer_agent_accounts

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| owner_address | text | EIP-55 checksum, lowercase in DB |
| agent_account_address | text | Circle Smart Account address |
| wallet_provider | text | Default: 'circle_modular' |
| account_type | text | Default: 'circle_smart_account' |
| chain_id | integer | Default: 5042002 (Arc Testnet) |
| status | text | 'active' or 'disabled' |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Partial unique index: one active binding per owner.

### mcp_sessions

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| token_hash | text | sha256(raw_token), unique |
| owner_address | text | Owner wallet |
| agent_account_address | text | Bound agent account |
| permissions_json | jsonb | `{ allowedContracts: [...], allowedActions: [...] }` |
| auto_approve | boolean | Default: false (forced in PR 451) |
| expires_at | timestamptz | Max 30 days from creation |
| revoked_at | timestamptz | Null = not revoked |
| created_at | timestamptz | |
| last_used_at | timestamptz | Updated on each resolution |

## API Routes

### POST /api/mcp/sessions/create

Auth: wallet session cookie.

```json
// Request
{ "agentAccountAddress": "0x...", "permissions": { "allowedContracts": ["*"] }, "expiresInDays": 30 }

// Response
{
  "ok": true,
  "token": "arc_mcp_sess_a1b2c3...",
  "session": { "id": "...", "ownerAddress": "0x...", "agentAccountAddress": "0x...", "permissions": {...}, "autoApprove": false, "expiresAt": "...", "createdAt": "..." },
  "claudeConfig": { "ARCLAYER_MCP_URL": "https://arclayers.xyz/api/mcp", "ARCLAYER_MCP_TOKEN": "arc_mcp_sess_...", "MCP_TRANSPORT": "http" },
  "warning": "Save this token now — it will not be shown again."
}
```

**Constraints:**
- `agentAccountAddress` is required (valid EVM address)
- `autoApprove=true` is rejected (400) — approval engine doesn't exist until PR 452
- `expiresInDays` defaults to 30, max 30. Clamped if exceeded.
- `permissions` defaults to `{ allowedContracts: ["ERC8004_IDENTITY_REGISTRY"], allowedActions: ["identity.register"] }`

### GET /api/mcp/sessions/list

Auth: wallet session cookie.

```json
{ "ok": true, "sessions": [{ "id": "...", "status": "active", "expiresAt": "...", ... }], "total": 3 }
```

Each session includes a computed `status` field: `active` | `expired` | `revoked`.
No `token_hash` is ever returned.

### POST /api/mcp/sessions/revoke

Auth: wallet session cookie.

```json
// Revoke specific
{ "sessionId": "uuid" }

// Revoke all
{}

// Response
{ "ok": true, "revoked": 1 }
```

Returns 404 if session doesn't exist, is already revoked, or belongs to a different owner.

## Auth

**MCP token extraction** — Bearer header only:
```
Authorization: Bearer arc_mcp_sess_xxx
```

Query param auth (`?token=...`) is NOT allowed. Tokens must not leak in URLs, server logs, or referer headers.

## Token Security

- Raw token: `arc_mcp_sess_` + 32 random bytes (hex) = 79 chars
- Stored: `sha256(raw_token)` only
- Returned: once on creation, never again
- Same pattern as `wallet_sessions` (wallet-session.ts)

## File Structure

```
apps/console/src/lib/agent-accounts/
  types.ts          — AgentAccount, McpSession types (with computed status)
  store.ts          — Supabase CRUD for both tables

apps/console/src/lib/mcp/
  sessions.ts       — Session lifecycle helpers
  session-auth.ts   — Auth middleware (Bearer header only)

apps/console/src/app/api/mcp/sessions/
  create/route.ts   — POST: upsert agent account + create session
  list/route.ts     — GET: list all sessions with status
  revoke/route.ts   — POST: revoke session(s)

supabase/migrations/
  0023_mcp_sessions_agent_accounts.sql — Table + index + RLS
```

## Migration

Run on Supabase:
```bash
psql $SUPABASE_URL -f supabase/migrations/0023_mcp_sessions_agent_accounts.sql
```

Or via Supabase Dashboard → SQL Editor.
