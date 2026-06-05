-- 0024_mcp_action_approvals.sql
-- Approval state machine for MCP tx actions.
-- Every on-chain action from an MCP session must go through an approval.

CREATE TABLE IF NOT EXISTS mcp_action_approvals (
  id                     text PRIMARY KEY,
  session_id             uuid NOT NULL,
  owner_address          text NOT NULL,
  agent_account_address  text NOT NULL,
  action                 text NOT NULL,
  chain_id               integer NOT NULL DEFAULT 5042002,
  to_address             text NOT NULL,
  data                   text NOT NULL,
  value                  text NOT NULL DEFAULT '0x0',
  summary_json           jsonb NOT NULL DEFAULT '{}',
  policy_snapshot_json   jsonb NOT NULL DEFAULT '{}',
  status                 text NOT NULL DEFAULT 'awaiting_approval',
  tx_hash                text,
  error                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  approved_at            timestamptz,
  cancelled_at           timestamptz,
  submitted_at           timestamptz,
  confirmed_at           timestamptz
);

-- Lookup by id (primary read path)
CREATE INDEX IF NOT EXISTS idx_action_approvals_id
  ON mcp_action_approvals (id);

-- Lookup by session (list approvals for a session)
CREATE INDEX IF NOT EXISTS idx_action_approvals_session
  ON mcp_action_approvals (session_id);

-- Lookup by owner (list approvals for a wallet)
CREATE INDEX IF NOT EXISTS idx_action_approvals_owner
  ON mcp_action_approvals (owner_address);

-- Lookup by agent account
CREATE INDEX IF NOT EXISTS idx_action_approvals_agent_account
  ON mcp_action_approvals (agent_account_address);

-- Expiry sweep
CREATE INDEX IF NOT EXISTS idx_action_approvals_expires_at
  ON mcp_action_approvals (expires_at);

-- Status filter
CREATE INDEX IF NOT EXISTS idx_action_approvals_status
  ON mcp_action_approvals (status);

-- ── RLS: service role only ──────────────────────────────────────────────────

ALTER TABLE mcp_action_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS action_approvals_service_role ON mcp_action_approvals;
CREATE POLICY action_approvals_service_role
  ON mcp_action_approvals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
