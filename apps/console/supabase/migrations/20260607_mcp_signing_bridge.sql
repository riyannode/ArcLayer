-- MCP Web Signing Bridge — Supabase migration
-- Creates tables for MCP-to-Web live signing sessions and requests.
-- PR 1: polling-based, Arc Testnet only, no private keys.

-- ── Sessions ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mcp_signing_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pairing_code  TEXT UNIQUE NOT NULL,
  owner_wallet  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | expired | revoked
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by pairing code (for display/debug)
CREATE INDEX IF NOT EXISTS idx_signing_sessions_pairing
  ON mcp_signing_sessions (pairing_code);

-- Fast lookup by owner wallet
CREATE INDEX IF NOT EXISTS idx_signing_sessions_owner
  ON mcp_signing_sessions (owner_wallet, status);

-- ── Requests ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mcp_signing_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              UUID NOT NULL REFERENCES mcp_signing_sessions(id),
  action_type             TEXT NOT NULL,           -- create_job | fund_job | complete_job | reject_job | claim_refund
  chain_id                INT NOT NULL DEFAULT 5042002,
  expected_client_wallet  TEXT NOT NULL,
  transactions            JSONB NOT NULL,          -- array of { kind, to, data, value, summary? }
  summary                 JSONB,                   -- human-readable summary for modal display
  result                  JSONB,                   -- { txHashes, receipts, jobId? } after execution
  status                  TEXT NOT NULL DEFAULT 'pending',  -- pending | signing | submitted | confirmed | cancelled | expired
  claimed_by_session      UUID,
  tx_hash                 TEXT,                    -- primary tx hash (first or createJob tx)
  expires_at              TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Poll pending requests for a session
CREATE INDEX IF NOT EXISTS idx_signing_requests_session_status
  ON mcp_signing_requests (session_id, status);

-- Partial index for pending requests (used by polling)
CREATE INDEX IF NOT EXISTS idx_signing_requests_pending
  ON mcp_signing_requests (session_id, created_at)
  WHERE status = 'pending';

-- Lookup by primary tx hash
CREATE INDEX IF NOT EXISTS idx_signing_requests_tx_hash
  ON mcp_signing_requests (tx_hash)
  WHERE tx_hash IS NOT NULL;
