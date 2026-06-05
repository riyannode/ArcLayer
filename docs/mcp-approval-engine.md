# MCP Approval Engine

## Overview

PR 452 adds the approval state machine for MCP tx actions. Every on-chain action from an MCP session must go through an approval before execution.

## Status Transitions

```
awaiting_approval → approved → submitted → confirmed
                  → cancelled              → failed
                  → expired (computed)
```

- **awaiting_approval**: Initial state. Created with policy snapshot.
- **approved**: User approved the action. Ready for signing.
- **submitted**: Tx broadcast. txHash recorded.
- **confirmed**: Tx confirmed on-chain. Success or failure.
- **cancelled**: User cancelled. Cannot be submitted.
- **expired**: TTL expired (10–15 min). Cannot be approved/submitted.
- **failed**: Tx reverted on-chain.

## Rules

| Rule | Enforcement |
|------|-------------|
| Approval must be from valid MCP session | Auth middleware checks Bearer token |
| autoApprove=false means no execution without approval | Policy check before create |
| Approval is single-use | Status transitions are atomic (`.eq('status', current)`) |
| Expires after 10–15 minutes | `expires_at` column, checked in `getEffectiveStatus()` |
| Wrong session cannot read/update | All queries scoped to `session_id` |
| Cancelled cannot be submitted | `submitApproval` checks effective status |
| Expired cannot be approved/submitted | `getEffectiveStatus()` returns 'expired' |
| Submitted cannot be resubmitted | Only 'approved' status can transition to 'submitted' |

## Policy v1

Only ERC-8004 identity.register on Arc Testnet:

| Check | Value |
|-------|-------|
| chainId | 5042002 |
| contract | ERC8004_IDENTITY_REGISTRY |
| action | identity.register |
| value | 0x0 |
| session | active (not expired/revoked) |
| permissions | non-empty, allows contract + action |

Empty permissions = deny all.

## API Routes

### GET /api/mcp/approvals/[id]

Auth: MCP Bearer token. Returns approval only if it belongs to the session.

### POST /api/mcp/approvals/[id]/approve

Auth: MCP Bearer token. Transition: awaiting_approval → approved.

### POST /api/mcp/approvals/[id]/cancel

Auth: MCP Bearer token. Transition: awaiting_approval or approved → cancelled. Idempotent if already cancelled.

### POST /api/mcp/approvals/[id]/submitted

Auth: MCP Bearer token. Body: `{ txHash }` (required). Transition: approved → submitted.

### POST /api/mcp/approvals/[id]/confirmed

Auth: MCP Bearer token. Body: `{ txHash?, blockNumber?, receiptStatus? }`. Transition: submitted → confirmed or failed.

## File Structure

```
apps/console/src/lib/mcp/
  approvals.ts    — Store + state machine (create, approve, cancel, submit, confirm)
  policy.ts       — Policy v1 checks (chain, contract, action, value, permissions)

apps/console/src/app/api/mcp/approvals/
  _helpers.ts     — Auth + fetch + response helpers (shared)
  [id]/route.ts   — GET approval
  [id]/approve/route.ts   — POST approve
  [id]/cancel/route.ts    — POST cancel
  [id]/submitted/route.ts — POST submitted
  [id]/confirmed/route.ts — POST confirmed

supabase/migrations/
  0024_mcp_action_approvals.sql — Table + indexes + RLS

docs/
  mcp-approval-engine.md — This file
```

## Security

- No private keys stored or referenced
- No tx execution (caller signs and broadcasts)
- No Circle backend signing
- No token in query string
- No raw MCP token returned
- No stack traces in responses
- No cross-session approval access (all queries scoped to session_id)
- Policy snapshot stored for audit trail

## Known Limitations

- No tx execution yet (frontend/executor handles signing)
- No frontend executor yet (PR 454)
- No ERC-8004 prepare tool yet (PR 453)
- No indexer integration for confirmation (caller provides receiptStatus)
